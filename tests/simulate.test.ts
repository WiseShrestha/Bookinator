import assert from "node:assert/strict";
import { it } from "node:test";
import { makeConfig } from "../src/engine/config.ts";
import { compileCatalog } from "../src/engine/model.ts";
import { ACTIVE_CATALOG } from "../src/data/index.ts";
import { SCENARIOS, mulberry32, playGame, summarize } from "../scripts/simulate.ts";

const config = makeConfig();
const cc = compileCatalog(ACTIVE_CATALOG, config.channel, config.unknownPYes);

it("simulation is reproducible for a fixed seed and uses the runtime engine", () => {
  for (const sc of SCENARIOS) {
    const a = playGame(cc, config, cc.x, 3, sc, mulberry32(123));
    const b = playGame(cc, config, cc.x, 3, sc, mulberry32(123));
    assert.deepEqual(a, b);
    assert.ok(a.questions <= config.maxQuestions);
  }
});

it("summary counts are consistent", () => {
  const res = Array.from({ length: 20 }, (_, g) => playGame(cc, config, cc.x, g % cc.books.length, SCENARIOS[1], mulberry32(g)));
  const s = summarize(SCENARIOS[1], res);
  assert.equal(s.games, 20);
  assert.equal(s.foundAnyRoute + s.failures, 20);
  assert.ok(s.top1 <= s.foundAnyRoute);
});
