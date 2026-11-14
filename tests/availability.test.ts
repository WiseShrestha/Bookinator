import assert from "node:assert/strict";
import { it } from "node:test";
import { availabilityEnabled, checkAvailability, pickEdition } from "../src/availability.ts";
import { COLLECTIONS } from "../src/data/index.ts";

// These tests exercise the 10-book fixture (Classic shelf) specifically, whatever the app opens on.
const ACTIVE_CATALOG = COLLECTIONS.classic.catalog;

const veg = ACTIVE_CATALOG.books.find((b) => b.id === "fx-the-vegetarian")!;
const cfg = { proxyUrl: "https://proxy.example", libCode: "111001", libName: "Test Library" };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

it("prefers the Korean edition and needs full config", () => {
  assert.equal(pickEdition(veg)?.isbn, "9788936433598");
  assert.equal(availabilityEnabled({}), false);
  assert.equal(availabilityEnabled({ ...cfg, libCode: "x" }), false);
  assert.equal(availabilityEnabled(cfg), true);
});

it("reports proxy results with the edition queried", async () => {
  const r = await checkAvailability(cfg, veg, reply(200, { ok: true, hasBook: true, loanAvailable: false, fetchedAt: "2026-11-14T06:00:00Z", cached: false, ms: 120 }));
  assert.ok(r.ok && r.hasBook === true && r.loanAvailable === false && r.edition.isbn === "9788936433598");
});

it("never invents availability on failure", async () => {
  for (const f of [reply(503, { ok: false, error: "not_configured" }), reply(502, { ok: false, error: "timeout" }),
                   (async () => { throw new Error("offline"); }) as typeof fetch]) {
    const r = await checkAvailability(cfg, veg, f);
    assert.equal(r.ok, false);
    assert.ok(!("hasBook" in r));
  }
  const noIsbn = ACTIVE_CATALOG.books.find((b) => b.editions.length === 0)!;
  assert.equal((await checkAvailability(cfg, noIsbn, reply(200, {}))).ok, false);
});
