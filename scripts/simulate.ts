// Seeded game simulations using exactly the same engine module as the UI.
//
//   npm run simulate                                   # fixture, all scenarios, 30 games/book/scenario
//   npm run simulate -- --catalog src/data/catalog.json --games 30 --seed 7
//   npm run simulate -- --crisp-truth                  # labels ≠ 0.5 treated as certain facts
//   npm run simulate -- --truth data/truth/truth20.json  # simulated users answer from an
//                                                       # independently labeled truth fixture
//
// IMPORTANT: when simulated answers are generated from the same labels the engine uses,
// the result measures internal consistency only — it cannot show the labels are correct.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfig, type EngineConfig } from "../src/engine/config.ts";
import { ANSWERS, compileCatalog, type Answer, type Catalog, type CompiledCatalog } from "../src/engine/model.ts";
import { applyEvent, deriveState, newSession, type Session } from "../src/engine/session.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ----------------------------------------------------------------- scenarios
export interface Scenario {
  name: string;
  description: string;
  /** Probability of answering "Don't know". */
  unknownRate: number;
  /** Probability a known answer is wrong. */
  wrongRate: number;
  /** Share of known answers given as Probably / Probably not instead of Yes / No. */
  hedgeRate: number;
  /** Exactly one wrong answer at a random position among the first `oneMistakeWithin` answers. */
  oneMistakeWithin?: number;
  /** Sample answers from the engine's own response channel (same-channel baseline). */
  useChannel?: boolean;
}

export const SCENARIOS: Scenario[] = [
  { name: "clear", description: "5% unknown, no wrong answers", unknownRate: 0.05, wrongRate: 0, hedgeRate: 0.2 },
  { name: "half", description: "25% unknown, 5% wrong among known", unknownRate: 0.25, wrongRate: 0.05, hedgeRate: 0.3 },
  { name: "difficult", description: "40% unknown, 10% wrong among known", unknownRate: 0.4, wrongRate: 0.1, hedgeRate: 0.4 },
  { name: "one_mistake", description: "5% unknown, exactly one wrong answer in the first 6", unknownRate: 0.05, wrongRate: 0, hedgeRate: 0.2, oneMistakeWithin: 6 },
  { name: "channel", description: "answers sampled from the engine's own channel (baseline)", unknownRate: 0, wrongRate: 0, hedgeRate: 0, useChannel: true },
];

// ----------------------------------------------------------------- seeded RNG
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ----------------------------------------------------------------- one game
export interface GameResult {
  bookIndex: number;
  outcome: "first_guess" | "second_guess" | "shortlist" | "fail";
  questions: number;
  wrongGuesses: number[];
  /** Target was in the top 3 of the posterior when the game ended. */
  inTop3AtEnd: boolean;
}

/**
 * truthX[q][b]: probability the fact is Yes in the simulated user's world. A latent
 * truth is sampled once per (game, question) — never re-sampled turn to turn.
 */
export function playGame(
  cc: CompiledCatalog,
  config: EngineConfig,
  truthX: Float64Array[],
  target: number,
  scenario: Scenario,
  rng: () => number,
  filmMemoryMode = false,
  crispTruth = false,
  /** Truth-fixture mode: cells with no vouched-for fact (0.5) are answered "Don't know". */
  unknownAsDontKnow = false,
): GameResult {
  const truth = new Map<number, boolean>();
  const factFor = (q: number) => {
    const x = truthX[q][target];
    // crisp: labels ≠ 0.5 are treated as certain facts (isolates engine capacity from label noise)
    if (!truth.has(q)) truth.set(q, crispTruth && x !== 0.5 ? x > 0.5 : rng() < x);
    return truth.get(q)!;
  };
  const mistakeAt = scenario.oneMistakeWithin ? Math.floor(rng() * scenario.oneMistakeWithin) : -1;
  let answered = 0;

  const answerFor = (q: number): Answer => {
    if (unknownAsDontKnow && truthX[q][target] === 0.5 && !scenario.useChannel) {
      answered++;
      return "dont_know";
    }
    const fact = factFor(q);
    const n = answered++;
    if (scenario.useChannel) {
      let u = rng();
      for (const a of ANSWERS) {
        const pa = fact ? config.channel[a].givenYes : config.channel[a].givenNo;
        if ((u -= pa) <= 0) return a;
      }
      return "dont_know";
    }
    if (n !== mistakeAt && rng() < scenario.unknownRate) return "dont_know";
    let said = fact;
    if (n === mistakeAt || rng() < scenario.wrongRate) said = !fact;
    const hedge = rng() < scenario.hedgeRate;
    return said ? (hedge ? "probably" : "yes") : hedge ? "probably_not" : "no";
  };

  let session: Session = newSession({ filmMemoryMode });
  const wrongGuesses: number[] = [];
  for (let step = 0; step < 200; step++) {
    const st = deriveState(cc, config, session);
    const a = st.action;
    const end = (outcome: GameResult["outcome"]): GameResult => ({
      bookIndex: target,
      outcome,
      questions: st.answers.length,
      wrongGuesses,
      inTop3AtEnd: st.ranked.slice(0, 3).includes(target),
    });
    if (a.kind === "ask") {
      session = applyEvent(cc, config, session, { type: "answer", questionId: a.question.id, answer: answerFor(a.questionIndex) }, st);
    } else if (a.kind === "guess") {
      if (a.bookIndex === target) return end(wrongGuesses.length === 0 ? "first_guess" : "second_guess");
      wrongGuesses.push(a.bookIndex);
      session = applyEvent(cc, config, session, { type: "reject", bookId: a.book.id }, st);
    } else if (a.kind === "shortlist") {
      return end(a.bookIndices.includes(target) ? "shortlist" : "fail");
    } else {
      return end("fail");
    }
  }
  throw new Error("simulation did not terminate");
}

// ----------------------------------------------------------------- metrics
export interface Summary {
  scenario: string;
  description: string;
  games: number;
  top1: number;
  firstGuessWrong: number;
  recoveredAfterOneRejection: number;
  foundAnyRoute: number;
  inTop3AtEnd: number;
  failures: number;
  meanQuestionsSuccess: number | null;
  meanQuestionsAll: number;
  p90Questions: number;
  wrongGuessesTotal: number;
  gamesWithWrongGuess: number;
}

function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function summarize(scenario: Scenario, results: GameResult[]): Summary {
  const success = results.filter((r) => r.outcome !== "fail");
  const firstWrong = results.filter((r) => r.wrongGuesses.length > 0);
  return {
    scenario: scenario.name,
    description: scenario.description,
    games: results.length,
    top1: results.filter((r) => r.outcome === "first_guess").length,
    firstGuessWrong: firstWrong.length,
    recoveredAfterOneRejection: results.filter((r) => r.outcome === "second_guess" && r.wrongGuesses.length === 1).length,
    foundAnyRoute: success.length,
    inTop3AtEnd: results.filter((r) => r.inTop3AtEnd).length,
    failures: results.length - success.length,
    meanQuestionsSuccess: success.length ? mean(success.map((r) => r.questions)) : null,
    meanQuestionsAll: mean(results.map((r) => r.questions)),
    p90Questions: percentile(results.map((r) => r.questions), 0.9),
    wrongGuessesTotal: results.reduce((s, r) => s + r.wrongGuesses.length, 0),
    gamesWithWrongGuess: firstWrong.length,
  };
}

// ----------------------------------------------------------------- CLI
function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = "true";
      else args[key] = argv[++i];
    }
  }
  return args;
}

/** Truth fixture: { "book_id": { "q01": 0.9, ... } }; unlisted cells are 0.5. */
function loadTruth(path: string, cc: CompiledCatalog): { x: Float64Array[]; books: number[] } {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, number>>;
  const x = cc.questions.map(() => new Float64Array(cc.books.length).fill(0.5));
  const books: number[] = [];
  for (const [bookId, cells] of Object.entries(raw)) {
    if (bookId.startsWith("_")) continue;
    const b = cc.bookIndex.get(bookId);
    if (b === undefined) throw new Error(`truth fixture: unknown book ${bookId}`);
    books.push(b);
    for (const [qid, p] of Object.entries(cells)) {
      const q = cc.questionIndex.get(qid);
      if (q === undefined) throw new Error(`truth fixture: unknown question ${qid}`);
      x[q][b] = p;
    }
  }
  return { x, books };
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "n/a (0/0)");

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = resolve(ROOT, args.catalog ?? "src/data/fixture.catalog.json");
  const games = Number(args.games ?? 30);
  const seed = Number(args.seed ?? 42);
  const film = args.film === "true";
  const crisp = args["crisp-truth"] === "true";
  const only = args.scenario && args.scenario !== "all" ? args.scenario.split(",") : null;
  const config = makeConfig();
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Catalog;
  const cc = compileCatalog(catalog, config.channel, config.unknownPYes);

  let truthX = cc.x;
  let targets = cc.books.map((_, i) => i);
  let truthNote = "simulated answers generated from the SAME labels the engine uses (internal consistency only)";
  if (args.truth) {
    const t = loadTruth(resolve(ROOT, args.truth), cc);
    truthX = t.x;
    targets = t.books;
    truthNote = `simulated answers generated from truth fixture ${args.truth} (${t.books.length} books); cells absent from it are answered "Don't know"`;
  }

  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.name));
  const started = Date.now();
  const report: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    catalog: args.catalog ?? "src/data/fixture.catalog.json",
    catalog_version: catalog.catalog_version,
    data_status: catalog.data_status,
    truth: truthNote,
    seed,
    games_per_book_per_scenario: games,
    film_memory_mode: film,
    crisp_truth: crisp,
    config: { ...config, channel: config.channel },
    scenarios: [] as unknown[],
  };

  console.log(`\nThat Book simulation — catalog ${catalog.catalog_version} (${catalog.data_status}), ${targets.length} target books`);
  console.log(`Truth: ${truthNote}`);
  console.log(`Seed ${seed}, ${games} games per book per scenario${film ? ", film-memory mode" : ""}${crisp ? ", crisp truth (labels ≠ 0.5 treated as certain)" : ""}\n`);

  const rows: string[][] = [];
  for (const sc of scenarios) {
    const results: GameResult[] = [];
    for (const b of targets) {
      for (let g = 0; g < games; g++) {
        const rng = mulberry32(hashSeed(seed, sc.name, cc.books[b].id, g));
        results.push(playGame(cc, config, truthX, b, sc, rng, film, crisp, Boolean(args.truth)));
      }
    }
    const s = summarize(sc, results);
    const subsets: Record<string, Summary> = {};
    const ko = results.filter((r) => cc.books[r.bookIndex].original_language === "ko");
    if (ko.length && ko.length < results.length) {
      subsets.korean = summarize(sc, ko);
      subsets.global = summarize(sc, results.filter((r) => cc.books[r.bookIndex].original_language !== "ko"));
    }
    const confusion = new Map<string, number>();
    for (const r of results) {
      for (const w of r.wrongGuesses) {
        const k = `${cc.books[r.bookIndex].id} → guessed ${cc.books[w].id}`;
        confusion.set(k, (confusion.get(k) ?? 0) + 1);
      }
    }
    const topConfusions = [...confusion.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
    const perBookFail = cc.books
      .map((bk, i) => ({ id: bk.id, fails: results.filter((r) => r.bookIndex === i && r.outcome === "fail").length }))
      .filter((x) => x.fails > 0)
      .sort((a, b) => b.fails - a.fails);
    (report.scenarios as unknown[]).push({ ...s, subsets, topConfusions, perBookFailures: perBookFail });
    rows.push([
      sc.name,
      pct(s.top1, s.games),
      pct(s.recoveredAfterOneRejection, s.firstGuessWrong),
      pct(s.foundAnyRoute, s.games),
      pct(s.inTop3AtEnd, s.games),
      s.meanQuestionsSuccess?.toFixed(1) ?? "–",
      s.meanQuestionsAll.toFixed(1),
      String(s.p90Questions),
      `${s.failures}`,
      `${s.wrongGuessesTotal}`,
    ]);
    if (topConfusions.length) {
      console.log(`[${sc.name}] most frequent wrong guesses: ${topConfusions.slice(0, 3).map(([k, v]) => `${k} ×${v}`).join("; ")}`);
    }
  }

  const header = ["scenario", "top-1", "recovered after 1 rejection", "found (any route)", "target in top-3 at end", "mean Q (success)", "mean Q (all)", "p90 Q", "failures", "wrong guesses"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
  console.log("\n" + line(header));
  console.log("| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |");
  for (const r of rows) console.log(line(r));

  const sum = (name: string) => (report.scenarios as Summary[]).find((x) => x.scenario === name);
  const clear = sum("clear");
  const half = sum("half");
  console.log("\nBrief's provisional targets (unvalidated):");
  if (clear) console.log(`  clear  top-1 ≥ 95% within 18 Q: ${pct(clear.top1, clear.games)} → ${clear.top1 / clear.games >= 0.95 ? "meets" : "below"}`);
  if (half) {
    console.log(`  half   top-1 ≥ 80%: ${pct(half.top1, half.games)} → ${half.top1 / half.games >= 0.8 ? "meets" : "below"}`);
    console.log(`  half   found incl. shortlist ≥ 90%: ${pct(half.foundAnyRoute, half.games)} → ${half.foundAnyRoute / half.games >= 0.9 ? "meets" : "below"}`);
  }
  if (catalog.data_status !== "production") {
    console.log(`\n⚠ Catalog is "${catalog.data_status}". These numbers are NOT accuracy claims.`);
  }

  const out = resolve(ROOT, args.out ?? "reports/simulation.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nWrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
