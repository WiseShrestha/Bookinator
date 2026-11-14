import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCandidate, playableIds, submissionBookId, type AcceptedConsensus, type ApprovedSubmission } from "../scripts/community_lib.ts";
import fixture from "../src/data/fixture.catalog.json";
import type { Catalog } from "../src/engine/model.ts";

const BASE = fixture as unknown as Catalog;
let nextId = 1;
const acc = (target_id: string, question_id: string, p: number, contributors = 5): AcceptedConsensus => ({
  consensus_id: nextId++, algorithm_version: "crowd-v1", target_id, question_id, proposed_p_yes: p, contributors,
});
const SUB: ApprovedSubmission = {
  id: "00000000-0000-4000-8000-000000000001", title: "Test Novel", author: "A. Writer", title_ko: null, aliases: [],
  original_language: "en", first_publication_year: 2001, series_title: null, series_number: null, isbn13: null, openlibrary_work_id: null,
};

describe("community candidate catalog", () => {
  it("fills unlabelled cells, never overwrites source-checked ones, and reports the conflict", () => {
    const supported = BASE.features.find((f) => f.status === "supported" && f.p_yes >= 0.7)!;
    const unlabelledQ = BASE.questions.find((q) => !BASE.features.some((f) => f.book_id === supported.book_id && f.question_id === q.id && f.p_yes !== 0.5))!;
    const { catalog, report } = buildCandidate(BASE, [
      acc(supported.book_id, supported.question_id, 0.1),
      acc(supported.book_id, unlabelledQ.id, 0.9),
      acc("fx-not-a-book", "q01", 0.9),
    ], [], "candidate-test");
    assert.equal(report.cells.applied, 1);
    assert.equal(report.cells.kept_source_checked, 1);
    assert.equal(report.cells.unknown_target, 1);
    assert.equal(report.conflicts.length, 1);
    const kept = catalog.features.find((f) => f.book_id === supported.book_id && f.question_id === supported.question_id)!;
    assert.equal(kept.p_yes, supported.p_yes);
    const added = catalog.features.find((f) => f.book_id === supported.book_id && f.question_id === unlabelledQ.id)!;
    assert.equal(added.status, "community_consensus");
    assert.equal(added.reviewed, true);
    assert.equal(added.consensus?.contributors, 5);
    assert.equal(catalog.catalog_version, "candidate-test");
    // the base catalog object is not mutated
    assert.notEqual(BASE.features.find((f) => f.book_id === supported.book_id && f.question_id === unlabelledQ.id)?.status, "community_consensus");
  });

  it("keeps an approved book out until the engine can find it", () => {
    const thin = buildCandidate(BASE, [acc(`submission:${SUB.id}`, "q01", 0.9)], [SUB], "c1");
    assert.equal(thin.report.new_books[0].playable, false);
    assert.ok(!thin.catalog.books.some((b) => b.id === submissionBookId(SUB.id)));
  });

  it("adds an approved book whose consensus labels make it identifiable, without regressions", () => {
    // Give the new book the opposite of every strong fixture label on many questions, so it is distinct.
    const qs = BASE.questions.filter((q) => q.active !== false).slice(0, 40);
    const labels = qs.map((q, i) => acc(`submission:${SUB.id}`, q.id, i % 3 === 0 ? 0.9 : 0.1));
    const { catalog, report } = buildCandidate(BASE, labels, [SUB], "c2");
    const nb = report.new_books[0];
    assert.equal(nb.id, submissionBookId(SUB.id));
    assert.equal(nb.playable, true);
    assert.ok(catalog.books.some((b) => b.id === nb.id));
    assert.ok(playableIds(catalog).has(nb.id));
    assert.deepEqual(report.regressions, []);
  });

  it("refuses an approved book without the required catalog fields", () => {
    const { report } = buildCandidate(BASE, [], [{ ...SUB, original_language: null }], "c3");
    assert.match(report.new_books[0].reason ?? "", /original_language/);
  });
});
