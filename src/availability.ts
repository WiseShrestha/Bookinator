// Client for the optional library proxy (server/library-proxy.mjs). Every failure becomes a
// readable message; nothing here ever claims availability the proxy did not report.
import type { CatalogBook, CatalogEdition } from "./engine/model.ts";

export interface AvailabilityConfig {
  proxyUrl?: string;
  libCode?: string;
  libName?: string;
}

export type AvailabilityResult =
  | {
      ok: true;
      edition: CatalogEdition;
      hasBook: boolean | null;
      loanAvailable: boolean | null;
      fetchedAt: string;
      cached: boolean;
      ms: number;
    }
  | { ok: false; edition: CatalogEdition | null; message: string };

export function availabilityEnabled(cfg: AvailabilityConfig): boolean {
  return Boolean(cfg.proxyUrl && /^https?:\/\//.test(cfg.proxyUrl) && cfg.libCode && /^\d{3,10}$/.test(cfg.libCode));
}

/** Korean edition first (local libraries mostly hold those), then any edition with an ISBN. */
export function pickEdition(book: CatalogBook): CatalogEdition | null {
  const withIsbn = book.editions.filter((e) => e.isbn && /^97[89]\d{10}$/.test(e.isbn));
  return withIsbn.find((e) => e.language === "ko") ?? withIsbn[0] ?? null;
}

export async function checkAvailability(
  cfg: AvailabilityConfig,
  book: CatalogBook,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<AvailabilityResult> {
  const edition = pickEdition(book);
  if (!edition?.isbn) return { ok: false, edition: null, message: "No verified ISBN is stored for this book yet." };
  if (!availabilityEnabled(cfg)) return { ok: false, edition, message: "Availability lookup is not configured." };
  const url = `${cfg.proxyUrl!.replace(/\/$/, "")}/availability?isbn13=${edition.isbn}&libCode=${cfg.libCode}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok || body.ok !== true) {
      const reason = body.error === "not_configured" ? "the library service is not set up" : `the lookup failed (${String(body.error ?? res.status)})`;
      return { ok: false, edition, message: `Couldn't check availability: ${reason}.` };
    }
    return {
      ok: true,
      edition,
      hasBook: typeof body.hasBook === "boolean" ? body.hasBook : null,
      loanAvailable: typeof body.loanAvailable === "boolean" ? body.loanAvailable : null,
      fetchedAt: String(body.fetchedAt),
      cached: body.cached === true,
      ms: Number(body.ms) || 0,
    };
  } catch {
    return { ok: false, edition, message: "Couldn't reach the library service." };
  }
}
