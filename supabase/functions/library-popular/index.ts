// Bookinator — most-borrowed literature in Korean public libraries (Data4Library "loanItemSrch"),
// keeping the Data4Library key server-side. GET /functions/v1/library-popular -> { books: [...] }
// Any failure (key not activated yet, timeout, unexpected shape) returns books: [] so the start
// screen simply hides the list. Nothing is made up here: an empty answer stays empty.
// Deployed with verify_jwt = false; secret DATA4LIBRARY_ACCESS_KEY is set in the Supabase dashboard.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED = [
  /^https:\/\/wiseshrestha\.github\.io$/,
  /^https:\/\/queso-gato1355\.github\.io$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

function json(body: unknown, status: number, origin: string | null, maxAge = 0): Response {
  const ok = origin !== null && ALLOWED.some((r) => r.test(origin));
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin! : "https://wiseshrestha.github.io",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      Vary: "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const text = (v: unknown, max: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return json(null, 200, origin);
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405, origin);
  if (origin !== null && !ALLOWED.some((r) => r.test(origin))) return json({ error: "origin not allowed" }, 403, origin);

  const key = Deno.env.get("DATA4LIBRARY_ACCESS_KEY");
  if (!key) return json({ books: [], reason: "not_configured" }, 200, origin);

  try {
    const now = new Date();
    const api = new URL("http://data4library.kr/api/loanItemSrch");
    api.searchParams.set("authKey", key);
    api.searchParams.set("format", "json");
    api.searchParams.set("pageSize", "10");
    api.searchParams.set("kdc", "8"); // literature
    api.searchParams.set("startDt", day(new Date(now.getTime() - 30 * 86400000)));
    api.searchParams.set("endDt", day(now));
    const res = await fetch(api, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const r = data?.response;
    if (!res.ok || !r || r.error || !Array.isArray(r.docs)) {
      return json({ books: [], reason: text(r?.errCode, 40) || `http_${res.status}` }, 200, origin);
    }
    const books = r.docs
      .map((d: { doc?: Record<string, unknown> }) => d?.doc ?? {})
      .map((d: Record<string, unknown>) => ({
        title: text(d.bookname, 200),
        author: text(d.authors, 200),
        loans: Number(d.loan_count) || null,
      }))
      .filter((b: { title: string }) => b.title)
      .slice(0, 10);
    return json({ books, period_days: 30, source: "data4library.kr" }, 200, origin, books.length ? 21600 : 0);
  } catch {
    return json({ books: [], reason: "unavailable" }, 200, origin);
  }
});
