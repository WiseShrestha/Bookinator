// Log-space posterior, normalization, entropy and ranking.
import { answerIndex, type Answer, type CompiledCatalog } from "./model.ts";

export interface AnsweredQuestion {
  questionIndex: number;
  answer: Answer;
}

export type Posterior =
  | { kind: "ok"; p: Float64Array; logp: Float64Array }
  | { kind: "no_match" };

/**
 * Replays the full history from the uniform original prior.
 * Rejected books get log-probability −∞. If nothing finite remains, returns
 * no_match instead of normalizing an empty distribution.
 */
export function computePosterior(
  cc: CompiledCatalog,
  history: readonly AnsweredQuestion[],
  rejected: ReadonlySet<number>,
): Posterior {
  const N = cc.books.length;
  const logp = new Float64Array(N).fill(-Math.log(N));
  for (const { questionIndex, answer } of history) {
    const row = cc.logL[questionIndex][answerIndex(answer)];
    for (let b = 0; b < N; b++) logp[b] += row[b];
  }
  for (const b of rejected) logp[b] = Number.NEGATIVE_INFINITY;
  const p = softmax(logp);
  if (!p) return { kind: "no_match" };
  return { kind: "ok", p, logp };
}

/** Numerically stable softmax. Returns null when every entry is −∞ (or NaN). */
export function softmax(logp: Float64Array): Float64Array | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of logp) if (Number.isFinite(v) && v > max) max = v;
  if (!Number.isFinite(max)) return null;
  const p = new Float64Array(logp.length);
  let sum = 0;
  for (let i = 0; i < logp.length; i++) {
    const v = Number.isFinite(logp[i]) ? Math.exp(logp[i] - max) : 0;
    p[i] = v;
    sum += v;
  }
  for (let i = 0; i < p.length; i++) p[i] /= sum;
  return p;
}

/** Shannon entropy in bits; 0·log 0 = 0. */
export function entropy(p: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (v > 0) h -= v * Math.log2(v);
  }
  return h;
}

/**
 * Candidate indices by descending probability; exact ties go to the lower
 * catalog index so ranking is deterministic. Excluded (rejected) books are dropped.
 */
export function rankBooks(p: Float64Array, exclude: ReadonlySet<number> = new Set()): number[] {
  const idx: number[] = [];
  for (let i = 0; i < p.length; i++) if (!exclude.has(i)) idx.push(i);
  idx.sort((a, b) => (p[b] !== p[a] ? p[b] - p[a] : a - b));
  return idx;
}
