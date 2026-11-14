// Optional server-side proxy for Data4Library (도서관 정보나루) availability lookups.
// Keeps the API key off the client. Node 20+ standard library only.
//
//   DATA4LIBRARY_AUTH_KEY=... node server/library-proxy.mjs
//   GET /health
//   GET /availability?isbn13=9788936433598&libCode=111001   → does this library hold it / can it be borrowed?
//   GET /libraries?isbn=9788936433598&region=11               → which libraries in a region hold it
//
// Endpoint names and parameters (bookExist: libCode, isbn13; libSrchByBook: isbn, region) follow
// https://www.data4library.kr/apiUtilization as used by independent open-source clients. They have
// NOT been called with a live key during the build: test once with a real key before the demo.
// Responses are parsed tolerantly; anything unexpected becomes an error, never invented availability.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ISBN13 = /^97[89]\d{10}$/;
const LIB_CODE = /^\d{3,10}$/;
const REGION = /^\d{2}$/;

/** Depth-first search for the first object having any of `keys`. */
function findObject(node, keys) {
  if (!node || typeof node !== "object") return null;
  if (!Array.isArray(node) && keys.some((k) => k in node)) return node;
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findObject(v, keys);
    if (hit) return hit;
  }
  return null;
}

function findAll(node, keys, out = []) {
  if (!node || typeof node !== "object") return out;
  if (!Array.isArray(node) && keys.every((k) => k in node)) out.push(node);
  for (const v of Array.isArray(node) ? node : Object.values(node)) findAll(v, keys, out);
  return out;
}

const yn = (v) => (v === "Y" || v === true ? true : v === "N" || v === false ? false : null);

export function createProxy({
  authKey = process.env.DATA4LIBRARY_AUTH_KEY,
  baseUrl = process.env.DATA4LIBRARY_BASE_URL || "http://data4library.kr",
  allowOrigin = process.env.ALLOW_ORIGIN || "*",
  timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 6000),
  cacheMs = Number(process.env.CACHE_MS || 5 * 60 * 1000),
  fetchImpl = globalThis.fetch,
} = {}) {
  const cache = new Map();

  async function upstream(path, params) {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/${path}`);
    for (const [k, v] of Object.entries({ authKey, ...params, format: "json" })) url.searchParams.set(k, v);
    const key = `${path}?${JSON.stringify(params)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return { body: hit.body, cached: true, fetchedAt: hit.at, ms: 0 };
    const started = Date.now();
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(new Error(`upstream HTTP ${res.status}`), { status: 502 });
    const body = await res.json();
    const err = findObject(body, ["error"]);
    if (err && typeof err.error === "string") throw Object.assign(new Error(`upstream error: ${err.error}`), { status: 502 });
    cache.set(key, { body, at: Date.now() });
    return { body, cached: false, fetchedAt: Date.now(), ms: Date.now() - started };
  }

  return createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": allowOrigin,
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "OPTIONS") return send(204, {});
    if (req.method !== "GET") return send(405, { ok: false, error: "method_not_allowed" });
    if (url.pathname === "/health") return send(200, { ok: true, configured: Boolean(authKey) });
    if (!authKey) return send(503, { ok: false, error: "not_configured", message: "DATA4LIBRARY_AUTH_KEY is not set" });

    try {
      if (url.pathname === "/availability") {
        const isbn13 = url.searchParams.get("isbn13") || "";
        const libCode = url.searchParams.get("libCode") || "";
        if (!ISBN13.test(isbn13) || !LIB_CODE.test(libCode)) return send(400, { ok: false, error: "bad_request" });
        const r = await upstream("bookExist", { isbn13, libCode });
        const result = findObject(r.body, ["hasBook", "loanAvailable"]);
        if (!result) return send(502, { ok: false, error: "unexpected_response" });
        return send(200, {
          ok: true, source: "Data4Library", queried: { isbn13, libCode },
          hasBook: yn(result.hasBook), loanAvailable: yn(result.loanAvailable),
          cached: r.cached, fetchedAt: new Date(r.fetchedAt).toISOString(), ms: r.ms,
        });
      }
      if (url.pathname === "/libraries") {
        const isbn = url.searchParams.get("isbn") || "";
        const region = url.searchParams.get("region") || "";
        if (!ISBN13.test(isbn) || !REGION.test(region)) return send(400, { ok: false, error: "bad_request" });
        const r = await upstream("libSrchByBook", { isbn, region });
        const libs = findAll(r.body, ["libCode", "libName"]).slice(0, 50).map((l) => ({
          libCode: String(l.libCode), libName: String(l.libName), address: l.address ? String(l.address) : null,
        }));
        return send(200, {
          ok: true, source: "Data4Library", queried: { isbn, region }, libraries: libs,
          cached: r.cached, fetchedAt: new Date(r.fetchedAt).toISOString(), ms: r.ms,
        });
      }
      return send(404, { ok: false, error: "not_found" });
    } catch (e) {
      const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
      return send(timeout ? 504 : e.status || 502, { ok: false, error: timeout ? "timeout" : "upstream_failed", message: String(e.message || e) });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  createProxy().listen(port, () => {
    const configured = Boolean(process.env.DATA4LIBRARY_AUTH_KEY);
    console.log(`library proxy on http://localhost:${port} (${configured ? "key configured" : "NO KEY: requests return 503"})`);
  });
}
