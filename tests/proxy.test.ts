import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
// @ts-expect-error — plain .mjs module without type declarations
import { createProxy } from "../server/library-proxy.mjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

let upstream: Server;
let upstreamBase = "";
const calls: URL[] = [];
let mode: "ok" | "error" | "slow" | "weird" = "ok";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

before(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    calls.push(url);
    const send = (obj: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (mode === "slow") return setTimeout(() => send({}), 500);
    if (mode === "error") return send({ response: { error: "인증키가 유효하지 않습니다" } });
    if (mode === "weird") return send({ response: { something: "else" } });
    if (url.pathname === "/api/bookExist") return send({ response: { request: {}, result: { hasBook: "Y", loanAvailable: "N" } } });
    if (url.pathname === "/api/libSrchByBook")
      return send({ response: { libs: [{ lib: { libCode: "111001", libName: "Test Library", address: "Seoul" } }] } });
    res.writeHead(404).end();
  });
  upstreamBase = await listen(upstream);
});
after(() => upstream.close());

async function withProxy(opts: Record<string, unknown>, fn: (base: string) => Promise<void>) {
  const proxy = createProxy({ baseUrl: upstreamBase, timeoutMs: 200, ...opts }) as Server;
  const base = await listen(proxy);
  try { await fn(base); } finally { proxy.close(); }
}

describe("library proxy", () => {
  it("returns 503 not_configured without a key, and never calls upstream", async () => {
    calls.length = 0;
    await withProxy({ authKey: "" }, async (base) => {
      const r = await fetch(`${base}/availability?isbn13=9788936433598&libCode=111001`);
      assert.equal(r.status, 503);
      assert.equal((await j(r)).error, "not_configured");
      assert.equal((await j(await fetch(`${base}/health`))).configured, false);
    });
    assert.equal(calls.length, 0);
  });

  it("validates inputs", async () => {
    await withProxy({ authKey: "k" }, async (base) => {
      assert.equal((await fetch(`${base}/availability?isbn13=123&libCode=111001`)).status, 400);
      assert.equal((await fetch(`${base}/availability?isbn13=9788936433598&libCode=abc`)).status, 400);
      assert.equal((await fetch(`${base}/libraries?isbn=9788936433598&region=x`)).status, 400);
    });
  });

  it("maps bookExist, adds key server-side, and caches with honest metadata", async () => {
    mode = "ok";
    calls.length = 0;
    await withProxy({ authKey: "secret-key" }, async (base) => {
      const r1 = await j(await fetch(`${base}/availability?isbn13=9788936433598&libCode=111001`));
      assert.deepEqual([r1.ok, r1.hasBook, r1.loanAvailable, r1.cached], [true, true, false, false]);
      assert.equal(r1.queried.isbn13, "9788936433598");
      assert.equal(calls[0].searchParams.get("authKey"), "secret-key");
      assert.equal(calls[0].searchParams.get("format"), "json");
      assert.ok(!JSON.stringify(r1).includes("secret-key"), "key must not leak to the client");
      const r2 = await j(await fetch(`${base}/availability?isbn13=9788936433598&libCode=111001`));
      assert.equal(r2.cached, true);
      assert.equal(calls.length, 1);
    });
  });

  it("maps libSrchByBook", async () => {
    mode = "ok";
    await withProxy({ authKey: "k" }, async (base) => {
      const r = await j(await fetch(`${base}/libraries?isbn=9788936433598&region=11`));
      assert.deepEqual(r.libraries, [{ libCode: "111001", libName: "Test Library", address: "Seoul" }]);
    });
  });

  it("fails gracefully: upstream error, timeout, unexpected shape", async () => {
    await withProxy({ authKey: "k", cacheMs: 0 }, async (base) => {
      const q = `${base}/availability?isbn13=9788936433598&libCode=111001`;
      mode = "error";
      let r = await fetch(q);
      assert.equal(r.status, 502);
      mode = "slow";
      r = await fetch(q);
      assert.equal(r.status, 504);
      assert.equal((await j(r)).error, "timeout");
      mode = "weird";
      r = await fetch(q);
      assert.equal(r.status, 502);
      assert.equal((await j(r)).error, "unexpected_response");
      mode = "ok";
    });
  });
});
