import type { Channel } from "./model.ts";

/**
 * All numerical thresholds live here. They are the brief's unvalidated starting
 * settings: tune them with playtests and simulations, not by intuition on stage.
 */
export interface EngineConfig {
  channel: Channel;
  /** p_yes used for cells with no stored label. */
  unknownPYes: number;
  /** Guess only after this many answers that are not "Don't know". */
  minInformativeAnswers: number;
  /** Top candidate probability needed before guessing. */
  guessMinProbability: number;
  /** Top / second probability ratio needed before guessing. */
  guessMinRatio: number;
  /** Hard cap on questions asked (including "Don't know"). */
  maxQuestions: number;
  /** Below this best weighted information-gain score (bits), stop and shortlist. */
  minScore: number;
  /** After this many rejected guesses, show the shortlist and out-of-catalog exit. */
  maxRejections: number;
  /**
   * Answered questions required after a rejection before the next guess.
   * Not in the brief's pseudocode; added so a rejection is followed by "continue
   * questioning" rather than an instant second guess. Set to 0 to disable.
   */
  questionsAfterRejection: number;
  shortlistSize: number;
  /** Max questions asked per correlation group (brief: initially one). */
  maxPerGroup: number;
  /** Scores within this distance are treated as ties; ties go to the lower index. */
  tieEpsilon: number;
}

export const DEFAULT_CHANNEL: Channel = {
  yes: { givenYes: 0.55, givenNo: 0.05 },
  probably: { givenYes: 0.2, givenNo: 0.1 },
  dont_know: { givenYes: 0.1, givenNo: 0.1 },
  probably_not: { givenYes: 0.1, givenNo: 0.2 },
  no: { givenYes: 0.05, givenNo: 0.55 },
};

export const DEFAULT_CONFIG: EngineConfig = {
  channel: DEFAULT_CHANNEL,
  unknownPYes: 0.5,
  minInformativeAnswers: 6,
  guessMinProbability: 0.8,
  guessMinRatio: 4,
  maxQuestions: 18,
  minScore: 0.01,
  maxRejections: 2,
  questionsAfterRejection: 1,
  shortlistSize: 3,
  maxPerGroup: 1,
  tieEpsilon: 1e-12,
};

export function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
