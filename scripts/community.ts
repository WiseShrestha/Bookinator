// Offline admin tooling for the community contribution database (docs/community/DESIGN.md §8).
// Uses the Supabase REST API with the SERVICE ROLE key, so run it only on a maintainer's machine
// or in a protected CI job — never ship the key to the browser.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/community.ts <command>
//
//   sync      --catalog src/data/fixture.catalog.json   load a shipped release into the read-only mirror,
//                                                        then mark approved submissions it contains as published
//   pull      --version <catalog version> [--out file]    load a release back from the database as catalog JSON
//   consensus [--release <version>] [--dry-run]          recompute community consensus from every raw answer
//                                                        (new consensus_runs row; nothing is overwritten)
//   export    --base src/data/fixture.catalog.json --version <new version> [--out data/community]
//                                                        write a candidate catalog + report for human review
//
// After `export`: run validate_catalog.py and the simulator on the candidate, review the report,
// copy it into src/data/ in a commit, deploy, then `sync` the new release.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeConsensus,
  DEFAULT_CONSENSUS_CONFIG,
  type RawAnswer,
} from "../src/community/consensus.ts";
import type { Answer, Catalog } from "../src/engine/model.ts";
import { buildCandidate, type AcceptedConsensus, type ApprovedSubmission } from "./community_lib.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const BASE = () => env("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1";
const headers = (extra: Record<string, string> = {}) => ({
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
  Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
  "Content-Type": "application/json",
  ...extra,
});

async function rest<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(BASE() + path, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Reads every row of a table or view, 1000 at a time, in a stable order. */
async function readAll<T>(path: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await rest<T[]>("GET", `${path}${sep}order=${order}&limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function sync() {
  const path = resolve(ROOT, arg("catalog") ?? "src/data/fixture.catalog.json");
  const cat = JSON.parse(readFileSync(path, "utf8")) as Catalog;
  const res = await rest("POST", "/rpc/tb_sync_release", { cat, commit_sha: gitCommit() });
  console.log("loaded", res);
  for (const b of cat.books.filter((x) => x.id.startsWith("tb:"))) {
    const sid = b.id.slice(3);
    await rest("PATCH", `/book_submissions?id=eq.${sid}&status=eq.review&approved_review_id=not.is.null`,
      { status: "published", published_book_id: b.id }, { Prefer: "return=minimal" });
    console.log(`submission ${sid} → published as ${b.id}`);
  }
}

interface EvidenceRow {
  answer_ref: string;
  contributor_id: string;
  target_id: string;
  question_id: string;
  answer: Answer;
  origin: RawAnswer["origin"];
  created_at: string;
  excluded: boolean;
}

async function consensus() {
  const rows = await readAll<EvidenceRow>(
    "/feature_evidence?select=answer_ref,contributor_id,target_id,question_id,answer,origin,created_at,excluded", "answer_ref");
  const raw: RawAnswer[] = rows.map((r) => ({
    contributorId: r.contributor_id, targetId: r.target_id, questionId: r.question_id, answer: r.answer,
    origin: r.origin, createdAt: r.created_at, excluded: r.excluded,
  }));
  const release = arg("release");
  const published = new Map<string, number>();
  if (release) {
    for (const f of await readAll<{ book_id: string; question_id: string; p_yes: number }>(
      `/book_features?catalog_version=eq.${encodeURIComponent(release)}&select=book_id,question_id,p_yes`, "book_id,question_id")) {
      published.set(`${f.book_id}/${f.question_id}`, Number(f.p_yes));
    }
  }
  const config = DEFAULT_CONSENSUS_CONFIG;
  const results = computeConsensus(raw, config, (t, q) => published.get(`${t}/${q}`));
  const labelled = results.filter((r) => r.proposedPYes !== 0.5).length;
  console.log(`${rows.length} raw answers → ${results.length} cells, ${labelled} with a proposed label`);
  if (flag("dry-run")) return;

  const [run] = await rest<{ id: number }[]>("POST", "/consensus_runs",
    { algorithm_version: config.algorithmVersion, config, input_rows: rows.length, git_commit: gitCommit() },
    { Prefer: "return=representation" });
  for (let i = 0; i < results.length; i += 500) {
    await rest("POST", "/feature_consensus", results.slice(i, i + 500).map((r) => ({
      run_id: run.id, target_id: r.targetId, question_id: r.questionId, raw_answers: r.rawAnswers,
      contributors: r.contributors, informative_contributors: r.informativeContributors, counts: r.counts,
      log_odds: r.logOdds, posterior: r.posterior, agreement: r.agreement, proposed_p_yes: r.proposedPYes, flags: r.flags,
    })), { Prefer: "return=minimal" });
  }
  console.log(`stored as consensus run ${run.id}`);
}

async function exportCandidate() {
  const basePath = resolve(ROOT, arg("base") ?? "src/data/fixture.catalog.json");
  const version = arg("version");
  if (!version) throw new Error("--version <new catalog version> is required");
  const outDir = resolve(ROOT, arg("out") ?? "data/community");
  const base = JSON.parse(readFileSync(basePath, "utf8")) as Catalog;

  // The latest consensus review per row decides: accept_consensus counts, a later dismiss cancels it.
  const reviews = await readAll<{ subject_id: string; action: string; id: number }>(
    "/submission_reviews?subject_type=eq.feature_consensus&action=in.(accept_consensus,dismiss_consensus)&select=id,subject_id,action", "id");
  const last = new Map<string, string>();
  for (const r of reviews) last.set(r.subject_id, r.action);
  const ids = [...last].filter(([, a]) => a === "accept_consensus").map(([id]) => id);
  const accepted: AcceptedConsensus[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await rest<{ id: number; target_id: string; question_id: string; proposed_p_yes: number; contributors: number; consensus_runs: { algorithm_version: string } }[]>(
      "GET", `/feature_consensus?id=in.(${ids.slice(i, i + 200).join(",")})&select=id,target_id,question_id,proposed_p_yes,contributors,consensus_runs(algorithm_version)`);
    for (const r of rows) {
      accepted.push({ consensus_id: r.id, algorithm_version: r.consensus_runs.algorithm_version, target_id: r.target_id,
        question_id: r.question_id, proposed_p_yes: Number(r.proposed_p_yes), contributors: r.contributors });
    }
  }
  const approved = await readAll<ApprovedSubmission>(
    "/book_submissions?kind=eq.new_book&status=eq.review&approved_review_id=not.is.null" +
    "&select=id,title,author,title_ko,aliases,original_language,first_publication_year,series_title,series_number,isbn13,openlibrary_work_id", "created_at");

  const { catalog, report } = buildCandidate(base, accepted, approved, version);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "candidate.catalog.json"), JSON.stringify(catalog) + "\n");
  writeFileSync(resolve(outDir, "candidate.report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(JSON.stringify(report.cells), `new books: ${report.new_books.length}, conflicts: ${report.conflicts.length}, regressions: ${report.regressions.length}`);
  console.log(`next: node scripts/py.mjs scripts/validate_catalog.py ${resolve(outDir, "candidate.catalog.json")}`);
}

/** Loads a release back from the database as catalog JSON (the inverse of `sync`). */
async function pull() {
  const version = arg("version");
  if (!version) throw new Error("--version <catalog version> is required");
  const out = resolve(ROOT, arg("out") ?? `data/community/${version}.catalog.json`);
  const cat = await rest<Catalog | null>("POST", "/rpc/get_release_catalog", { release_version: version });
  if (!cat) throw new Error(`release ${version} is not in the database (run sync first)`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cat) + "\n");
  console.log(`${version}: ${cat.books.length} books, ${cat.questions.length} questions, ${cat.features.length} features → ${out}`);
}

const commands: Record<string, () => Promise<void>> = { sync, pull, consensus, export: exportCandidate };
const cmd = process.argv[2];
if (!cmd || !commands[cmd]) {
  console.error("usage: tsx scripts/community.ts sync|pull|consensus|export [options]  (see the header of this file)");
  process.exit(2);
}
commands[cmd]().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
