import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collapseRepeats,
  computeConsensus,
  DEFAULT_CONSENSUS_CONFIG,
  isAllowedPYes,
  type RawAnswer,
} from "../src/community/consensus.ts";
import type { Answer } from "../src/engine/model.ts";

let clock = 0;
function vote(contributorId: string, answer: Answer, over: Partial<RawAnswer> = {}): RawAnswer {
  clock++;
  return {
    contributorId,
    targetId: "fx-the-hobbit",
    questionId: "q09",
    answer,
    origin: "contribution_form",
    createdAt: new Date(Date.UTC(2026, 10, 14, 0, 0, clock)).toISOString(),
    ...over,
  };
}
const only = (rows: RawAnswer[], ...rest: Parameters<typeof computeConsensus> extends [unknown, ...infer R] ? R : never) => {
  const out = computeConsensus(rows, ...rest);
  assert.equal(out.length, 1);
  return out[0];
};

describe("community consensus", () => {
  it("one or two agreeing votes are not enough to propose a label", () => {
    const r = only([vote("a", "yes"), vote("b", "yes")]);
    assert.equal(r.proposedPYes, 0.5);
    assert.ok(r.flags.includes("too_few_contributors"));
    assert.ok(r.posterior > 0.5);
  });

  it("three agreeing contributors give a qualified label, five a strong one", () => {
    assert.equal(only(["a", "b", "c"].map((c) => vote(c, "yes"))).proposedPYes, 0.7);
    assert.equal(only(["a", "b", "c", "d", "e"].map((c) => vote(c, "yes"))).proposedPYes, 0.9);
    assert.equal(only(["a", "b", "c", "d", "e"].map((c) => vote(c, "no"))).proposedPYes, 0.1);
  });

  it("repeated submissions by one contributor count once (their latest answer)", () => {
    const spam = Array.from({ length: 50 }, () => vote("spammer", "yes"));
    const r = only([...spam, vote("spammer", "no")]);
    assert.equal(r.rawAnswers, 51);
    assert.equal(r.contributors, 1);
    assert.equal(r.counts.no, 1);
    assert.equal(r.counts.yes, 0);
    assert.equal(r.proposedPYes, 0.5);
  });

  it("'Don't know' is neutral evidence but is kept apart from not-asked", () => {
    const r = only([vote("a", "dont_know"), vote("b", "dont_know"), vote("c", "dont_know")]);
    assert.equal(r.logOdds, 0);
    assert.equal(r.contributors, 3);
    assert.equal(r.informativeContributors, 0);
    assert.ok(r.flags.includes("mostly_dont_know"));
    // A question nobody was asked produces no row at all.
    assert.equal(computeConsensus([vote("a", "yes", { questionId: "q10" })]).some((x) => x.questionId === "q09"), false);
  });

  it("'Probably' is weaker evidence than 'Yes'", () => {
    const sure = only(["a", "b", "c"].map((c) => vote(c, "yes")));
    const hedged = only(["a", "b", "c"].map((c) => vote(c, "probably")));
    assert.ok(hedged.logOdds > 0 && hedged.logOdds < sure.logOdds);
    // Five hedged votes stay "mostly yes"; five sure votes reach the strong level.
    assert.equal(only(["a", "b", "c", "d", "e"].map((c) => vote(c, "probably"))).proposedPYes, 0.7);
  });

  it("split votes are flagged as low agreement and stay neutral", () => {
    const r = only([vote("a", "yes"), vote("b", "yes"), vote("c", "no"), vote("d", "no")]);
    assert.equal(r.agreement, 0.5);
    assert.equal(r.proposedPYes, 0.5);
    assert.ok(r.flags.includes("low_agreement"));
  });

  it("excluded answers are ignored but the raw rows are not dropped by the caller", () => {
    const rows = [vote("a", "yes"), vote("b", "yes"), vote("c", "yes"), vote("d", "no", { excluded: true })];
    const r = only(rows);
    assert.equal(r.contributors, 3);
    assert.equal(rows.length, 4);
    assert.equal(collapseRepeats(rows).length, 3);
  });

  it("flags conflicts with the published catalog without using it as a prior", () => {
    const rows = ["a", "b", "c"].map((c) => vote(c, "no"));
    const plain = only(rows);
    const flagged = only(rows, DEFAULT_CONSENSUS_CONFIG, () => 0.9);
    assert.equal(flagged.logOdds, plain.logOdds);
    assert.ok(flagged.flags.includes("conflicts_with_catalog"));
  });

  it("is recomputable: origin weights and tempering change results without new data", () => {
    const rows = ["a", "b", "c"].map((c) => vote(c, "yes", { origin: "game_session" }));
    const base = only(rows);
    const muted = only(rows, { ...DEFAULT_CONSENSUS_CONFIG, algorithmVersion: "x", originWeight: { game_session: 0, contribution_form: 1, submission_seed: 1 } });
    assert.equal(muted.logOdds, 0);
    assert.equal(muted.algorithmVersion, "x");
    assert.ok(base.logOdds > 0);
  });

  it("groups by target and question and only proposes allowed catalog values", () => {
    const rows: RawAnswer[] = [];
    const answers: Answer[] = ["yes", "probably", "dont_know", "probably_not", "no"];
    for (let i = 0; i < 200; i++) {
      rows.push(vote(`c${i % 13}`, answers[i % 5], { targetId: `b${i % 3}`, questionId: `q0${i % 4}` }));
    }
    const out = computeConsensus(rows);
    assert.equal(out.length, 12);
    for (const r of out) assert.ok(isAllowedPYes(r.proposedPYes), String(r.proposedPYes));
  });

  it("rejects invalid configurations", () => {
    assert.throws(() => computeConsensus([], { ...DEFAULT_CONSENSUS_CONFIG, tempering: 0 }));
    assert.throws(() => computeConsensus([], { ...DEFAULT_CONSENSUS_CONFIG, minContributorsStrong: 1, minContributorsQualified: 3 }));
  });
});
