// The shipped CMU catalog must keep the promise its playability gate made: every playable book is
// found as the engine's first guess when the reader answers exactly from that book's own labels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { makeConfig } from "../src/engine/config.ts";
import { compileCatalog, type Catalog } from "../src/engine/model.ts";
import { mulberry32, playGame } from "../scripts/simulate.ts";

const catalog = JSON.parse(readFileSync(new URL("../src/data/cmu.catalog.json", import.meta.url), "utf8")) as Catalog;
const config = makeConfig();

test("cmu catalog is marked as unreviewed machine-labelled data", () => {
  assert.equal(catalog.data_status, "machine_labelled_unreviewed");
  assert.ok(catalog.notice && /No human has reviewed/.test(catalog.notice));
  assert.ok(catalog.coverage && catalog.coverage.playable_game_targets === catalog.books.length);
  assert.ok(catalog.coverage.imported_source_records >= catalog.books.length);
  // Sourced labels cite exactly one source; AI-recall labels (general knowledge) cite none and say so.
  assert.ok(catalog.features.every((f) => f.reviewed === false &&
    ((f.status === "supported" && f.source_ids.length === 1) || (f.status === "ai_recall" && f.source_ids.length === 0))));
});

test("every cmu feature cites a source registered on its own book", () => {
  const sources = new Map(catalog.books.map((b) => [b.id, new Set(b.sources.map((s) => s.id))]));
  for (const f of catalog.features) {
    if (f.source_ids.length) assert.ok(sources.get(f.book_id)?.has(f.source_ids[0]), `${f.book_id}/${f.question_id}`);
  }
});

test("every playable cmu book is the first guess when answering from its own labels", () => {
  const cc = compileCatalog(catalog, config.channel, config.unknownPYes);
  const own = { name: "own_labels", description: "", unknownRate: 0, wrongRate: 0, hedgeRate: 0 };
  cc.books.forEach((b, i) => {
    const r = playGame(cc, config, cc.x, i, own, mulberry32(1), false, true, true);
    assert.equal(r.outcome, "first_guess", b.title_en);
  });
});
