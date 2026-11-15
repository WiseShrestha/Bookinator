// Applies the AI labeller files in data/ai_recall/*.txt to an already-built research catalog, with the
// SAME per-cell rules as merge_ai_recall() in scripts/build_cmu_catalog.py. Use it when labeller files
// changed but the Core pack needed for a full rebuild is not at hand:
//
//   npx tsx scripts/apply_ai_recall.ts --version cmu-priority500-v2   # then: npx tsx scripts/gate_catalog.ts
//
// Rules per (book, question), using every labeller file at once:
//   * labellers disagree with each other  -> no AI answer (the cell stays as sourced, or unknown)
//   * labellers agree                     -> their strongest value
//   * AI agrees with a sourced label      -> the sourced label is kept
//   * AI disagrees with a sourced label   -> the cell becomes unknown
// Existing ai_recall cells are recomputed from scratch, so running it twice gives the same catalog.
// Only single-book targets are touched; series targets (built from several volumes) keep their cells
// until the next full build. A new catalog_version is required: Supabase releases are immutable.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog, CatalogFeature } from "../src/engine/model.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECALL_DIR = resolve(ROOT, "data/ai_recall");
const VALUE: Record<string, number> = { Y: 0.9, y: 0.7, n: 0.3, N: 0.1 };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** `book_id | title | tokens` (see the header of data/ai_recall/labels.txt). */
function readLabeller(file: string, qids: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  readFileSync(file, "utf8").split(/\r?\n/).forEach((raw, n) => {
    const line = raw.split("#", 1)[0].trim();
    if (!line) return;
    const [idPart, , tokens] = line.split("|").map((x) => x.trim());
    const bid = idPart.includes(":") ? idPart : `cmu:enwiki:${idPart}`;
    for (const tok of (tokens ?? "").split(/\s+/).filter(Boolean)) {
      const qid = /^\d/.test(tok) ? `q${tok.slice(0, -1)}` : tok.slice(0, -1);
      const v = VALUE[tok.slice(-1)];
      const key = `${bid}/${qid}`;
      if (!qids.has(qid) || v === undefined || out.has(key)) throw new Error(`${file} line ${n + 1}: bad or repeated token ${tok}`);
      out.set(key, v);
    }
  });
  return out;
}

function main() {
  const catalogPath = resolve(ROOT, arg("catalog") ?? "src/data/cmu.catalog.json");
  const version = arg("version");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Catalog & { ai_recall_applied?: unknown };
  if (!version || version === catalog.catalog_version) throw new Error("pass --version with a NEW catalog version");
  const qids = new Set(catalog.questions.map((q) => q.id));
  const files = readdirSync(RECALL_DIR).filter((f) => f.endsWith(".txt")).sort((a, b) => (a !== "labels.txt" ? 1 : 0) - (b !== "labels.txt" ? 1 : 0) || a.localeCompare(b));
  const labellers = files.map((f) => ({ name: f === "labels.txt" ? "claude" : f.replace(/\.txt$/, ""), cells: readLabeller(resolve(RECALL_DIR, f), qids) }));

  const singles = new Set(catalog.books.filter((b) => !b.volumes).map((b) => b.id));
  const kept: CatalogFeature[] = [];
  const sourced = new Map<string, CatalogFeature>();
  for (const f of catalog.features) {
    if (singles.has(f.book_id) && f.status === "ai_recall") continue; // recomputed below
    kept.push(f);
    if (singles.has(f.book_id) && f.p_yes !== 0.5) sourced.set(`${f.book_id}/${f.question_id}`, f);
  }

  const stats = Object.fromEntries(labellers.map((l) => [l.name, { answers_on_playable_books: 0, agree_with_sourced: 0, conflict_with_sourced: 0 }]));
  let crossAgree = 0, crossDisagree = 0, added = 0, agree = 0, conflict = 0;
  const unknowned = new Set<string>();
  const keys = [...new Set(labellers.flatMap((l) => [...l.cells.keys()]))].filter((k) => singles.has(k.slice(0, k.lastIndexOf("/")))).sort();
  for (const key of keys) {
    const vals = labellers.filter((l) => l.cells.has(key)).map((l) => ({ name: l.name, v: l.cells.get(key)! }));
    const known = sourced.get(key);
    for (const { name, v } of vals) {
      stats[name].answers_on_playable_books++;
      if (known) stats[name][(known.p_yes - 0.5) * (v - 0.5) > 0 ? "agree_with_sourced" : "conflict_with_sourced"]++;
    }
    if (vals.length > 1) {
      if (vals.some((x) => x.v > 0.5) && vals.some((x) => x.v < 0.5)) { crossDisagree++; continue; }
      crossAgree++;
    }
    const v = vals.map((x) => x.v).reduce((a, b) => (Math.abs(b - 0.5) > Math.abs(a - 0.5) ? b : a));
    if (known) {
      if ((known.p_yes - 0.5) * (v - 0.5) > 0) agree++;
      else { conflict++; unknowned.add(key); }
      continue;
    }
    const [bookId, qid] = [key.slice(0, key.lastIndexOf("/")), key.slice(key.lastIndexOf("/") + 1)];
    kept.push({ book_id: bookId, question_id: qid, p_yes: v as CatalogFeature["p_yes"], status: "ai_recall", source_ids: [], reviewed: false });
    added++;
  }
  // Keep the shipped order: books in catalog order, questions in bank order.
  const bookPos = new Map(catalog.books.map((b, i) => [b.id, i]));
  const qPos = new Map(catalog.questions.map((q, i) => [q.id, i]));
  catalog.features = kept
    .filter((f) => !unknowned.has(`${f.book_id}/${f.question_id}`))
    .sort((a, b) => bookPos.get(a.book_id)! - bookPos.get(b.book_id)! || qPos.get(a.question_id)! - qPos.get(b.question_id)!);
  catalog.catalog_version = version;
  for (const s of Object.values(stats)) {
    const n = s.agree_with_sourced + s.conflict_with_sourced;
    (s as Record<string, unknown>).agreement_with_sourced = n ? Math.round((1000 * s.agree_with_sourced) / n) / 1000 : null;
  }
  const summary = {
    labellers: stats,
    between_labellers: { agree: crossAgree, disagree_dropped: crossDisagree },
    cells_added: added,
    checked_against_sourced_labels: agree + conflict,
    agree,
    conflict_set_to_unknown: conflict,
    scope: "single-book targets of the shipped catalog (scripts/apply_ai_recall.ts); series targets unchanged",
  };
  writeFileSync(catalogPath, JSON.stringify(catalog) + "\n");
  writeFileSync(resolve(ROOT, "data/cmu/ai_recall_applied.json"), JSON.stringify({ catalog_version: version, ...summary }, null, 1) + "\n");
  console.log(JSON.stringify(summary, null, 1));
}

main();
