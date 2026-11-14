// Expected information gain, weighted by recallability, with deterministic argmax.
import { ANSWERS, type CompiledCatalog } from "./model.ts";
import { entropy } from "./posterior.ts";

export interface QuestionScore {
  questionIndex: number;
  /** Expected information gain in bits. */
  ig: number;
  /** ig × recallability — the value that is maximized. */
  score: number;
}

/**
 * Books whose probability is below this contribute < 1e-13 bits to any entropy
 * term, so they are skipped in the inner loop. Same code path for UI and simulator.
 */
export const NEGLIGIBLE_P = 1e-15;

export function aliveIndices(p: Float64Array): Int32Array {
  const out: number[] = [];
  for (let b = 0; b < p.length; b++) if (p[b] > NEGLIGIBLE_P) out.push(b);
  return Int32Array.from(out);
}

/**
 * IG(q) = H(p) − Σ_a P(a|q) · H(p_after(q, a)), where P(a|q) = Σ_b p[b]·L[b,q,a].
 * Uses H(joint/mass) = log2(mass) − Σ joint·log2(joint) / mass.
 */
export function informationGain(
  cc: CompiledCatalog,
  p: Float64Array,
  q: number,
  alive: Int32Array = aliveIndices(p),
  h0: number = entropy(p),
): number {
  let expectedH = 0;
  for (let ai = 0; ai < ANSWERS.length; ai++) {
    const row = cc.L[q][ai];
    let mass = 0;
    let jlogj = 0;
    for (let k = 0; k < alive.length; k++) {
      const b = alive[k];
      const j = p[b] * row[b];
      if (j > 0) {
        mass += j;
        jlogj += j * Math.log2(j);
      }
    }
    if (mass > 0) expectedH += mass * Math.log2(mass) - jlogj; // = mass · H(joint/mass)
  }
  // Floating-point noise can make an uninformative question come out at −1e-16.
  return Math.max(0, h0 - expectedH);
}

export function scoreQuestions(
  cc: CompiledCatalog,
  p: Float64Array,
  eligible: readonly number[],
): QuestionScore[] {
  const alive = aliveIndices(p);
  const h0 = entropy(p);
  return eligible.map((q) => {
    const ig = informationGain(cc, p, q, alive, h0);
    return { questionIndex: q, ig, score: ig * cc.questions[q].recallability };
  });
}

/**
 * Deterministic argmax: scores within `tieEpsilon` are ties, and ties go to the
 * question that appears first in the catalog's question order.
 */
export function pickBest(scores: readonly QuestionScore[], tieEpsilon: number): QuestionScore | null {
  let best: QuestionScore | null = null;
  for (const s of scores) {
    if (
      best === null ||
      s.score > best.score + tieEpsilon ||
      (Math.abs(s.score - best.score) <= tieEpsilon && s.questionIndex < best.questionIndex)
    ) {
      best = s;
    }
  }
  return best;
}
