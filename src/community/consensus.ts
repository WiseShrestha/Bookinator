// Community consensus: turns raw contributor answers into a proposed p_yes per (target, question).
//
// Pure TypeScript with no server or React imports, so the same code can run in the offline
// publish script, the tests and (if chosen later) a Supabase Edge Function. It never writes the
// game catalog: its output is a *proposal* that a reviewer accepts or rejects (docs/community/DESIGN.md §6).
//
// Why the engine's channel: a contributor answering "Yes" about a book is the same noisy memory
// signal the engine already models during play, P(answer | fact). Reusing it keeps the meaning of
// the five answers identical everywhere — "Probably" is weaker than "Yes", and "Don't know" is
// neutral (likelihood ratio 1) but is still counted, unlike a question that was never asked.

import { DEFAULT_CHANNEL } from "../engine/config.ts";
import { ALLOWED_P_YES, ANSWERS, type Answer, type Channel } from "../engine/model.ts";

/** Where a raw answer came from. Kept on every vote so a later algorithm can weight them differently. */
export type AnswerOrigin = "game_session" | "contribution_form" | "submission_seed";

export interface RawAnswer {
  contributorId: string;
  /** Canonical book id ("fx-…", "cmu:…") or "submission:<uuid>" for a book not yet published. */
  targetId: string;
  questionId: string;
  answer: Answer;
  origin: AnswerOrigin;
  /** ISO timestamp; used only to pick a contributor's latest answer. */
  createdAt: string;
  /** Set by a reviewer's exclusion; excluded answers stay stored but never count. */
  excluded?: boolean;
}

export interface ConsensusConfig {
  /** Recorded with every result so stored rows can be recomputed or compared across versions. */
  algorithmVersion: string;
  channel: Channel;
  /**
   * Multiplies each vote's log-likelihood ratio. Contributors are not truly independent (shared
   * film memories, the same Wikipedia summary), so a value below 1 keeps a few agreeing votes
   * from looking certain. Unvalidated starting value.
   */
  tempering: number;
  /** Per-origin weight. All 1 to start; changing it needs no new data, only a recompute. */
  originWeight: Record<AnswerOrigin, number>;
  /** Distinct contributors with an informative (not "Don't know") answer needed for 0.7 / 0.3. */
  minContributorsQualified: number;
  /** … and for 0.9 / 0.1. */
  minContributorsStrong: number;
  /** Share of informative votes on the majority side needed for 0.7 / 0.3 and for 0.9 / 0.1. */
  minAgreementQualified: number;
  minAgreementStrong: number;
  /** Posterior needed for the strong level (the qualified level needs 0.7 / 0.3). */
  strongPosterior: number;
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  algorithmVersion: "crowd-v1",
  channel: DEFAULT_CHANNEL,
  tempering: 0.5,
  originWeight: { game_session: 1, contribution_form: 1, submission_seed: 1 },
  minContributorsQualified: 3,
  minContributorsStrong: 5,
  minAgreementQualified: 0.7,
  minAgreementStrong: 0.85,
  strongPosterior: 0.95,
};

export type ConsensusFlag =
  | "too_few_contributors"
  | "low_agreement"
  | "mostly_dont_know"
  | "conflicts_with_catalog";

export interface ConsensusResult {
  targetId: string;
  questionId: string;
  algorithmVersion: string;
  /** Raw rows counted (after exclusions), before collapsing repeats. */
  rawAnswers: number;
  /** Distinct contributors after collapsing (one vote each). */
  contributors: number;
  /** Contributors whose vote is not "Don't know". */
  informativeContributors: number;
  counts: Record<Answer, number>;
  logOdds: number;
  /** P(fact is Yes | votes), from a neutral 0.5 prior. */
  posterior: number;
  /** Share of informative votes on the majority side (yes+probably vs no+probably_not). */
  agreement: number;
  /** Proposed catalog value, one of ALLOWED_P_YES; 0.5 when the evidence is not enough. */
  proposedPYes: number;
  flags: ConsensusFlag[];
}

export function validateConsensusConfig(c: ConsensusConfig): void {
  if (!(c.tempering > 0 && c.tempering <= 1)) throw new Error("tempering must be in (0, 1]");
  if (!(c.minContributorsQualified >= 1 && c.minContributorsStrong >= c.minContributorsQualified)) {
    throw new Error("minContributorsStrong must be >= minContributorsQualified >= 1");
  }
  for (const [k, w] of Object.entries(c.originWeight)) {
    if (!(w >= 0)) throw new Error(`originWeight.${k} must be >= 0`);
  }
}

/** One vote per contributor per (target, question): their most recent non-excluded answer. */
export function collapseRepeats(rows: readonly RawAnswer[]): RawAnswer[] {
  const latest = new Map<string, RawAnswer>();
  for (const r of rows) {
    if (r.excluded) continue;
    const key = `${r.targetId}\u0000${r.questionId}\u0000${r.contributorId}`;
    const prev = latest.get(key);
    // Ties on timestamp keep the first row seen, so the result does not depend on sort stability.
    if (!prev || r.createdAt > prev.createdAt) latest.set(key, r);
  }
  return [...latest.values()];
}

function proposal(
  posterior: number,
  informative: number,
  agreement: number,
  c: ConsensusConfig,
): number {
  const strong =
    informative >= c.minContributorsStrong && agreement >= c.minAgreementStrong;
  const qualified =
    informative >= c.minContributorsQualified && agreement >= c.minAgreementQualified;
  if (strong && posterior >= c.strongPosterior) return 0.9;
  if (strong && posterior <= 1 - c.strongPosterior) return 0.1;
  if (qualified && posterior >= 0.7) return 0.7;
  if (qualified && posterior <= 0.3) return 0.3;
  return 0.5;
}

/**
 * Aggregates raw answers into one result per (target, question).
 * `catalogPYes` (optional) is the currently published value, used only to flag conflicts:
 * it never acts as a prior, so reviewers see what the community says on its own.
 */
export function computeConsensus(
  rows: readonly RawAnswer[],
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG,
  catalogPYes?: (targetId: string, questionId: string) => number | undefined,
): ConsensusResult[] {
  validateConsensusConfig(config);
  const llr = Object.fromEntries(
    ANSWERS.map((a) => [a, Math.log(config.channel[a].givenYes / config.channel[a].givenNo)]),
  ) as Record<Answer, number>;

  const rawCount = new Map<string, number>();
  for (const r of rows) {
    if (r.excluded) continue;
    const k = `${r.targetId}\u0000${r.questionId}`;
    rawCount.set(k, (rawCount.get(k) ?? 0) + 1);
  }

  const groups = new Map<string, RawAnswer[]>();
  for (const v of collapseRepeats(rows)) {
    const k = `${v.targetId}\u0000${v.questionId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }

  const out: ConsensusResult[] = [];
  for (const [k, votes] of groups) {
    const [targetId, questionId] = k.split("\u0000");
    const counts = Object.fromEntries(ANSWERS.map((a) => [a, 0])) as Record<Answer, number>;
    let logOdds = 0;
    for (const v of votes) {
      counts[v.answer]++;
      logOdds += llr[v.answer] * config.tempering * config.originWeight[v.origin];
    }
    const positive = counts.yes + counts.probably;
    const negative = counts.no + counts.probably_not;
    const informative = positive + negative;
    const agreement = informative === 0 ? 0 : Math.max(positive, negative) / informative;
    const posterior = 1 / (1 + Math.exp(-logOdds));
    const proposedPYes = proposal(posterior, informative, agreement, config);

    const flags: ConsensusFlag[] = [];
    if (informative < config.minContributorsQualified) flags.push("too_few_contributors");
    else if (agreement < config.minAgreementQualified) flags.push("low_agreement");
    if (votes.length > 0 && counts.dont_know / votes.length > 0.5) flags.push("mostly_dont_know");
    const published = catalogPYes?.(targetId, questionId);
    if (
      published !== undefined &&
      proposedPYes !== 0.5 &&
      published !== 0.5 &&
      (published > 0.5) !== (proposedPYes > 0.5)
    ) {
      flags.push("conflicts_with_catalog");
    }

    out.push({
      targetId,
      questionId,
      algorithmVersion: config.algorithmVersion,
      rawAnswers: rawCount.get(k) ?? votes.length,
      contributors: votes.length,
      informativeContributors: informative,
      counts,
      logOdds,
      posterior,
      agreement,
      proposedPYes,
      flags,
    });
  }
  out.sort((a, b) => a.targetId.localeCompare(b.targetId) || a.questionId.localeCompare(b.questionId));
  return out;
}

/** True when a proposal can be written to a catalog feature unchanged. */
export function isAllowedPYes(p: number): boolean {
  return (ALLOWED_P_YES as readonly number[]).includes(p);
}
