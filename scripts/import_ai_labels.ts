// Imports label files produced with docs/AI_LABELLING_PROMPT.md (one prompt for every teammate and every AI).
//
//   npx tsx scripts/import_ai_labels.ts --name gpt labels_a.txt labels_b.txt [--dry-run]
//
// --name is the AI that produced the files (gpt, gemini, claude2 …), not the person: files from the same AI are
// merged into one labeller so that the cross-check between DIFFERENT AIs stays meaningful.
//
// Line format (anything else in the files, e.g. chat text, is ignored):
//   id | title | author | first published year | original language | answers        (answers: 01Y 13N m01n …)
//
// What it does
//   1. checks every line (codes, answer letters, repeated codes) and reports bad lines by file:line;
//   2. finds the book: by id, else by normalised title/alias + author surname, against the 500-record research pool
//      and both shelves;
//   3. merges duplicates (within the files AND with the existing data/ai_recall/<name>.txt): the same direction keeps
//      the stronger answer, opposite directions drop the answer;
//   4. writes research-pool books to data/ai_recall/<name>.txt (read by the catalog build / apply_ai_recall.ts) and
//      books outside the pool to data/ai_recall/extra/<name>_new_books.json, merged across teammates.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog } from "../src/engine/model.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECALL = resolve(ROOT, "data/ai_recall");
const VALUE: Record<string, number> = { Y: 0.9, y: 0.7, n: 0.3, N: 0.1 };
const NOT_FOR_AI = new Set(["q56", "q60", "q61", "q62", "q63", "q64"]);

const argv = process.argv.slice(2);
const nameAt = argv.indexOf("--name");
const name = nameAt >= 0 ? argv[nameAt + 1] : undefined;
const dryRun = argv.includes("--dry-run");
const inputs = argv.filter((a, i) => !a.startsWith("--") && i !== nameAt + 1);
if (!name || !/^[a-z][a-z0-9_-]{1,30}$/.test(name) || inputs.length === 0) {
  console.error("usage: npx tsx scripts/import_ai_labels.ts --name <ai-name, e.g. gpt> <file> [file …] [--dry-run]");
  process.exit(1);
}
if (name === "labels") throw new Error('"labels" is reserved for data/ai_recall/labels.txt (Claude); pick another name');

// ---------------------------------------------------------------- what we already have
const read = <T>(p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as T;
const cmu = read<Catalog>("src/data/cmu.catalog.json");
const fixture = read<Catalog>("src/data/fixture.catalog.json");
const coverage = read<{ records: { id: string; title: string; authors: string[] }[] }>("data/cmu/coverage_report.json");
const qids = new Set(cmu.questions.map((q) => q.id));

/** Lowercase, NFKC, no accents, no punctuation, no leading article, no "(original title)". */
function normTitle(s: string): string {
  return s
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}
/** The title plus its main part before a subtitle ("Moby-Dick; or, The Whale" → "moby dick"). */
const titleKeys = (s: string) => [...new Set([normTitle(s), normTitle(s.split(/[;:]| - /)[0])].filter(Boolean))];
const surnameTokens = (author: string) => new Set(normTitle(author).split(" ").filter((t) => t.length > 1));

interface Known { id: string; titles: Set<string>; authors: Set<string>; where: string }
const known: Known[] = [];
const pool = new Set<string>();
for (const r of coverage.records) {
  if (r.id.startsWith("cmu:enwiki:")) pool.add(r.id);
  known.push({ id: r.id, titles: new Set(titleKeys(r.title)), authors: surnameTokens(r.authors.join(" ")), where: "research pool" });
}
for (const b of cmu.books) {
  const k = known.find((x) => x.id === b.id);
  const titles = [b.title_en, ...(b.title_ko ? [b.title_ko] : []), ...b.aliases].flatMap(titleKeys);
  if (k) titles.forEach((t) => k.titles.add(t));
  for (const v of b.volumes ?? []) {
    const kv = known.find((x) => x.id === v.id);
    if (kv) titleKeys(v.title).forEach((t) => kv.titles.add(t));
  }
}
for (const b of fixture.books) {
  known.push({ id: b.id, titles: new Set([b.title_en, ...(b.title_ko ? [b.title_ko] : []), ...b.aliases].flatMap(titleKeys)),
    authors: surnameTokens(b.author), where: "classic shelf" });
}

function findBook(id: string, title: string, author: string): { id: string; where: string } | { ambiguous: string[] } | null {
  if (id !== "-" && known.some((k) => k.id === id)) return { id, where: known.find((k) => k.id === id)!.where };
  const alt = /\(([^)]+)\)/.exec(title)?.[1];
  const ts = [...titleKeys(title), ...(alt ? titleKeys(alt) : [])].filter(Boolean);
  let hits = known.filter((k) => ts.some((x) => k.titles.has(x)));
  if (hits.length > 1 && author) {
    const a = surnameTokens(author);
    const byAuthor = hits.filter((k) => [...a].some((x) => k.authors.has(x)));
    if (byAuthor.length) hits = byAuthor;
  }
  // Prefer the research pool (that is what the build reads) over the classic shelf.
  const inPool = hits.filter((k) => pool.has(k.id));
  if (inPool.length === 1) return { id: inPool[0].id, where: "research pool" };
  const ids = [...new Set(hits.map((k) => k.id))];
  if (ids.length === 1) return { id: ids[0], where: hits[0].where };
  if (ids.length > 1) return { ambiguous: ids };
  return null;
}

// ---------------------------------------------------------------- parse + merge
type Cells = Map<string, number>;
interface Entry { key: string; id: string | null; title: string; author: string; year: number | null; lang: string | null; cells: Cells; from: string[] }

let conflictsDropped = 0, strengthened = 0;
function mergeInto(into: Cells, add: Cells) {
  for (const [q, v] of add) {
    const old = into.get(q);
    if (old === undefined) into.set(q, v);
    else if (Number.isNaN(old)) continue; // already dropped as a conflict
    else if ((old - 0.5) * (v - 0.5) < 0) { into.set(q, NaN); conflictsDropped++; }
    else if (Math.abs(v - 0.5) > Math.abs(old - 0.5)) { into.set(q, v); strengthened++; }
  }
}

const problems: string[] = [];
const entries = new Map<string, Entry>();
const skipped: string[] = [];
let lines = 0;
for (const file of inputs) {
  readFileSync(resolve(file), "utf8").split(/\r?\n/).forEach((raw, i) => {
    const where = `${basename(file)}:${i + 1}`;
    const line = raw.replace(/^[\s`*-]*(?=\S+\s*\|)/, "").trim();
    if (/^SKIPPED\s*\|/i.test(line)) { skipped.push(...line.split("|")[1].split(";").map((s) => s.trim()).filter(Boolean)); return; }
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length !== 6 || !/^[0-9mM]/.test(parts[5] ?? "")) return; // not a book line
    lines++;
    const [id, title, author, year, lang, answers] = parts;
    const cells: Cells = new Map();
    let bad = false;
    for (const tok of answers.split(/\s+/).filter(Boolean)) {
      const m = /^(\d{2}|m\d{2})([YyNn])$/.exec(tok);
      const qid = m ? (m[1].startsWith("m") ? m[1] : `q${m[1]}`) : "";
      if (!m || !qids.has(qid)) { problems.push(`${where}: unknown token "${tok}"`); bad = true; continue; }
      if (NOT_FOR_AI.has(qid)) continue; // sourced-only / inactive questions: ignored, not an error
      if (cells.has(qid)) { problems.push(`${where}: ${tok} repeats a question on the same line`); bad = true; continue; }
      cells.set(qid, VALUE[m[2]]);
    }
    if (!title) { problems.push(`${where}: missing title`); return; }
    if (bad && cells.size === 0) return;
    const found = findBook(id, title, author);
    if (found && "ambiguous" in found) { problems.push(`${where}: "${title}" matches several books (${found.ambiguous.join(", ")}); write its id`); return; }
    if (found && found.id.startsWith("series:")) { problems.push(`${where}: "${title}" is a whole series; label each volume instead`); return; }
    const key = found ? found.id : `new:${normTitle(title)}|${[...surnameTokens(author)].sort().join(" ")}`;
    const e = entries.get(key);
    if (e) { mergeInto(e.cells, cells); e.from.push(where); return; }
    entries.set(key, { key, id: found?.id ?? null, title, author, year: /^\d{3,4}$/.test(year) ? Number(year) : null,
      lang: /^[a-z]{2}$/.test(lang) ? lang : null, cells, from: [where] });
  });
}

// ---------------------------------------------------------------- write
const code = (q: string) => (q.startsWith("q") ? q.slice(1) : q);
const letter = (v: number) => ({ 0.9: "Y", 0.7: "y", 0.3: "n", 0.1: "N" } as Record<number, string>)[v];
const tokens = (c: Cells) => [...c].filter(([, v]) => !Number.isNaN(v)).map(([q, v]) => code(q) + letter(v)).sort((a, b) => Number(a.startsWith("m")) - Number(b.startsWith("m")) || a.localeCompare(b)).join(" ");

// research-pool books → data/ai_recall/<name>.txt, merged with what is already there
const poolFile = resolve(RECALL, `${name}.txt`);
const header: string[] = [];
const poolBooks = new Map<string, { title: string; cells: Cells }>();
if (existsSync(poolFile)) {
  for (const raw of readFileSync(poolFile, "utf8").split(/\r?\n/)) {
    if (raw.startsWith("#") || !raw.trim()) { if (raw.startsWith("#")) header.push(raw); continue; }
    const [id, title, toks] = raw.split("|").map((s) => s.trim());
    const bid = id.includes(":") ? id : `cmu:enwiki:${id}`;
    const cells: Cells = new Map();
    for (const t of toks.split(/\s+/).filter(Boolean)) cells.set(/^\d/.test(t) ? `q${t.slice(0, -1)}` : t.slice(0, -1), VALUE[t.slice(-1)]);
    poolBooks.set(bid, { title, cells });
  }
}
let poolNew = 0, poolMerged = 0;
const outside: Entry[] = [];
for (const e of entries.values()) {
  if (e.id && pool.has(e.id)) {
    const have = poolBooks.get(e.id);
    if (have) { mergeInto(have.cells, e.cells); poolMerged++; } else { poolBooks.set(e.id, { title: e.title, cells: e.cells }); poolNew++; }
  } else outside.push(e);
}
if (header.length === 0) {
  header.push(`# AI LABELS from "${name}" via docs/AI_LABELLING_PROMPT.md (scripts/import_ai_labels.ts). NO SOURCE, NOT REVIEWED.`,
    "# Format as in labels.txt: book_id | title | tokens. Read by build_cmu_catalog.py / apply_ai_recall.ts as one labeller.");
}
const poolOut = header.join("\n") + "\n" + [...poolBooks]
  .map(([id, b]) => ({ id, title: b.title.replace(/[|#]/g, " "), t: tokens(b.cells) }))
  .filter((r) => r.t)
  .map((r) => `${r.id.replace(/^cmu:enwiki:/, "")} | ${r.title} | ${r.t}`).join("\n") + "\n";

// books outside the pool → extra/<name>_new_books.json, and report books other files already hold
mkdirSync(resolve(RECALL, "extra"), { recursive: true });
const newFile = resolve(RECALL, "extra", `${name}_new_books.json`);
const prev = existsSync(newFile) ? (JSON.parse(readFileSync(newFile, "utf8")) as { books: { key: string }[] }).books : [];
const byKey = new Map<string, Record<string, unknown> & { key: string; answers: Record<string, number> }>(prev.map((b) => [b.key, b as never]));
for (const e of outside) {
  const answers = Object.fromEntries([...e.cells].filter(([, v]) => !Number.isNaN(v)));
  const old = byKey.get(e.key);
  if (old) { const c: Cells = new Map(Object.entries(old.answers)); mergeInto(c, e.cells); old.answers = Object.fromEntries([...c].filter(([, v]) => !Number.isNaN(v))); }
  else byKey.set(e.key, { key: e.key, book_id: e.id, on: e.id ? "classic shelf only" : "not in the project yet", title: e.title, author: e.author,
    first_publication_year: e.year, original_language: e.lang, answers });
}
const others = readdirSync(resolve(RECALL, "extra")).filter((f) => f.endsWith("_new_books.json") && f !== basename(newFile))
  .flatMap((f) => (JSON.parse(readFileSync(resolve(RECALL, "extra", f), "utf8")) as { books: { key: string }[] }).books.map((b) => ({ f, key: b.key })));
const sharedWithOthers = [...byKey.keys()].filter((k) => others.some((o) => o.key === k));

if (!dryRun) {
  writeFileSync(poolFile, poolOut);
  writeFileSync(newFile, JSON.stringify({ notice: `AI labels from "${name}" for books outside the 500-record research pool (NOT used by the build yet). Answers are p_yes per question id.`,
    books: [...byKey.values()] }, null, 1) + "\n");
}

console.log(`${lines} book lines read from ${inputs.length} file(s) → ${entries.size} distinct books`);
console.log(`  research pool: ${poolNew} new + ${poolMerged} merged into data/ai_recall/${name}.txt`);
console.log(`  outside the pool: ${outside.length} → data/ai_recall/extra/${name}_new_books.json` +
  (sharedWithOthers.length ? ` (${sharedWithOthers.length} also in another AI's extra file — fine, they are cross-checked later)` : ""));
console.log(`  duplicates merged: ${strengthened} answers strengthened, ${conflictsDropped} contradicting answers dropped`);
if (skipped.length) console.log(`  the AI skipped: ${skipped.join("; ")}`);
if (problems.length) console.log(`\n${problems.length} problem(s):\n  ` + problems.join("\n  "));
if (dryRun) console.log("\n(dry run: nothing written)");
