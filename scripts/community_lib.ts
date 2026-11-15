// Pure logic for the community → catalog path (docs/community/DESIGN.md §8). No network here;
// scripts/community.ts does the Supabase I/O and calls these functions.
//
// The output is a CANDIDATE catalog for a person to validate, simulate and commit. Nothing here
// publishes anything, and the shipped catalogs in src/data/ are never written by this module.

import { makeConfig, type EngineConfig } from "../src/engine/config.ts";
import {
  compileCatalog,
  type Catalog,
  type CatalogBook,
  type CatalogFeature,
} from "../src/engine/model.ts";
import { isAllowedPYes } from "../src/community/consensus.ts";
import { mulberry32, playGame, type Scenario } from "./simulate.ts";

/** A feature_consensus row a reviewer accepted (latest review action for it was accept_consensus). */
export interface AcceptedConsensus {
  consensus_id: number;
  algorithm_version: string;
  target_id: string;
  question_id: string;
  proposed_p_yes: number;
  contributors: number;
}

/** A new-book submission approved by a reviewer and not yet published. */
export interface ApprovedSubmission {
  id: string;
  title: string;
  author: string;
  title_ko: string | null;
  aliases: string[];
  original_language: string | null;
  first_publication_year: number | null;
  series_title: string | null;
  series_number: number | null;
  isbn13: string | null;
  openlibrary_work_id: string | null;
}

export type CellDecision =
  | "applied"
  | "kept_source_checked"
  | "kept_reviewed"
  | "unknown_target"
  | "unknown_question"
  | "not_a_label";

export interface CandidateReport {
  base_version: string;
  candidate_version: string;
  cells: Record<CellDecision, number>;
  /** Cells where the community disagrees with a published source-checked or reviewed label. */
  conflicts: { book_id: string; question_id: string; published: number; community: number; consensus_id: number }[];
  new_books: { id: string; title: string; playable: boolean; reason: string | null }[];
  /** Existing books that the engine stopped finding from their own labels after the change. */
  regressions: string[];
}

/** Book id used for a published submission, so the release can be traced back to it. */
export const submissionBookId = (submissionId: string) => `tb:${submissionId}`;
const submissionTarget = (submissionId: string) => `submission:${submissionId}`;

function slug(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

export function submissionToBook(s: ApprovedSubmission): CatalogBook | { error: string } {
  if (!s.original_language) return { error: "original_language is missing (a reviewer can add it with an edit)" };
  if (!s.author) return { error: "author is missing (a reviewer can add it with an edit)" };
  return {
    id: submissionBookId(s.id),
    title_en: s.title,
    title_ko: s.title_ko,
    aliases: s.aliases,
    author: s.author,
    original_language: s.original_language,
    first_publication_year: s.first_publication_year,
    series_id: s.series_title ? `series:${slug(s.series_title)}` : null,
    series_number: s.series_title ? s.series_number : null,
    openlibrary_work_id: s.openlibrary_work_id,
    editions: s.isbn13 ? [{ isbn: s.isbn13, language: null, title: null, source_id: null }] : [],
    sources: [],
  };
}

const PERFECT: Scenario = { name: "own_labels", description: "answers exactly the labels", unknownRate: 0, wrongRate: 0, hedgeRate: 0 };

/** Same necessary condition as scripts/gate_catalog.ts: answering from its own labels finds it first. */
export function playableIds(catalog: Catalog, config: EngineConfig = makeConfig()): Set<string> {
  const cc = compileCatalog(catalog, config.channel, config.unknownPYes);
  const ok = new Set<string>();
  cc.books.forEach((b, i) => {
    if (playGame(cc, config, cc.x, i, PERFECT, mulberry32(1), false, true, true).outcome === "first_guess") ok.add(b.id);
  });
  return ok;
}

/**
 * Applies accepted consensus to a base catalog and adds approved books that the engine can find.
 *
 * Cell policy (DECISION D6, default shown): community values fill cells that are missing, 0.5,
 * or unreviewed fixture/AI labels; they never overwrite a source-checked ("supported") or
 * human-reviewed cell — those become conflicts for a reviewer to look at.
 */
export function buildCandidate(
  base: Catalog,
  accepted: readonly AcceptedConsensus[],
  approved: readonly ApprovedSubmission[],
  candidateVersion: string,
  config: EngineConfig = makeConfig(),
): { catalog: Catalog; report: CandidateReport } {
  const report: CandidateReport = {
    base_version: base.catalog_version,
    candidate_version: candidateVersion,
    cells: { applied: 0, kept_source_checked: 0, kept_reviewed: 0, unknown_target: 0, unknown_question: 0, not_a_label: 0 },
    conflicts: [],
    new_books: [],
    regressions: [],
  };
  const questionIds = new Set(base.questions.map((q) => q.id));
  const books: CatalogBook[] = base.books.map((b) => ({ ...b }));
  const targetToBook = new Map<string, string>(books.map((b) => [b.id, b.id]));

  const newBookIds = new Set<string>();
  for (const s of approved) {
    const b = submissionToBook(s);
    if ("error" in b) {
      report.new_books.push({ id: submissionBookId(s.id), title: s.title, playable: false, reason: b.error });
      continue;
    }
    books.push(b);
    newBookIds.add(b.id);
    targetToBook.set(submissionTarget(s.id), b.id);
  }

  const features = new Map<string, CatalogFeature>(base.features.map((f) => [`${f.book_id}/${f.question_id}`, { ...f }]));
  // Latest consensus row wins per cell when a reviewer accepted more than one.
  const latest = new Map<string, AcceptedConsensus>();
  for (const a of accepted) {
    const k = `${a.target_id}/${a.question_id}`;
    const prev = latest.get(k);
    if (!prev || a.consensus_id > prev.consensus_id) latest.set(k, a);
  }
  for (const a of latest.values()) {
    const bookId = targetToBook.get(a.target_id);
    if (!bookId) { report.cells.unknown_target++; continue; }
    if (!questionIds.has(a.question_id)) { report.cells.unknown_question++; continue; }
    if (!isAllowedPYes(a.proposed_p_yes) || a.proposed_p_yes === 0.5) { report.cells.not_a_label++; continue; }
    const key = `${bookId}/${a.question_id}`;
    const cur = features.get(key);
    const conflict = cur && cur.p_yes !== 0.5 && (cur.p_yes > 0.5) !== (a.proposed_p_yes > 0.5);
    if (cur && cur.p_yes !== 0.5 && (cur.status === "supported" || cur.reviewed)) {
      report.cells[cur.status === "supported" ? "kept_source_checked" : "kept_reviewed"]++;
      if (conflict) {
        report.conflicts.push({ book_id: bookId, question_id: a.question_id, published: cur.p_yes, community: a.proposed_p_yes, consensus_id: a.consensus_id });
      }
      continue;
    }
    features.set(key, {
      book_id: bookId,
      question_id: a.question_id,
      p_yes: a.proposed_p_yes,
      status: "community_consensus",
      source_ids: [],
      reviewed: true,
      consensus: { algorithm_version: a.algorithm_version, consensus_id: a.consensus_id, contributors: a.contributors },
    });
    report.cells.applied++;
  }

  let catalog: Catalog = { ...base, catalog_version: candidateVersion, books, features: [...features.values()] };

  // New books join only if the engine can find them without breaking any existing book.
  const before = playableIds(base, config);
  let ok = playableIds(catalog, config);
  const dropped = new Map<string, string>();
  for (const id of newBookIds) {
    if (!ok.has(id)) dropped.set(id, "the engine cannot find it from its own labels yet (keep collecting answers)");
  }
  if (dropped.size) {
    catalog = { ...catalog, books: catalog.books.filter((b) => !dropped.has(b.id)), features: catalog.features.filter((f) => !dropped.has(f.book_id)) };
    ok = playableIds(catalog, config);
  }
  report.regressions = [...before].filter((id) => !ok.has(id));
  for (const s of approved) {
    const id = submissionBookId(s.id);
    if (!newBookIds.has(id)) continue;
    report.new_books.push({ id, title: s.title, playable: !dropped.has(id), reason: dropped.get(id) ?? null });
  }
  return { catalog, report };
}
