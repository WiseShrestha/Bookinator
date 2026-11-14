// Matching clues for a result card, chosen from stored catalog labels (never generated live).
import { ANSWER_LABELS, type Answer, type CatalogFeature, type CompiledCatalog } from "./model.ts";
import type { AnsweredQuestion } from "./posterior.ts";

export interface MatchingClue {
  questionId: string;
  questionText: string;
  userAnswer: Answer;
  userAnswerLabel: string;
  /** Stored label for this book: "Yes" / "Mostly yes" / "Mostly no" / "No". */
  catalogLabel: string;
  feature: CatalogFeature | undefined;
}

const POSITIVE: Answer[] = ["yes", "probably"];
const NEGATIVE: Answer[] = ["no", "probably_not"];

function labelFor(x: number): string {
  if (x >= 0.85) return "Yes";
  if (x >= 0.65) return "Mostly yes";
  if (x <= 0.15) return "No";
  return "Mostly no";
}

/**
 * Answers that agree with a strong-ish stored label for this book, strongest first.
 * Ties broken by question order so the explanation is deterministic.
 */
export function matchingClues(
  cc: CompiledCatalog,
  bookIndex: number,
  answers: readonly AnsweredQuestion[],
  limit = 2,
): MatchingClue[] {
  const candidates = answers
    .map((a, order) => ({ ...a, order, x: cc.x[a.questionIndex][bookIndex] }))
    .filter(
      (a) => (a.x >= 0.7 && POSITIVE.includes(a.answer)) || (a.x <= 0.3 && NEGATIVE.includes(a.answer)),
    )
    .sort((a, b) => {
      // Strong label + definite answer first; positive matches ("set before 1900: Yes")
      // are more distinctive to a reader than negative ones ("no talking animals").
      const strength = (v: typeof a) =>
        Math.abs(v.x - 0.5) * 2 +
        (v.answer === "yes" || v.answer === "no" ? 1 : 0) +
        (POSITIVE.includes(v.answer) ? 1.5 : 0);
      return strength(b) - strength(a) || a.order - b.order;
    });
  return candidates.slice(0, limit).map((c) => {
    const q = cc.questions[c.questionIndex];
    return {
      questionId: q.id,
      questionText: q.text,
      userAnswer: c.answer,
      userAnswerLabel: ANSWER_LABELS[c.answer],
      catalogLabel: labelFor(c.x),
      feature: cc.feature[c.questionIndex][bookIndex],
    };
  });
}
