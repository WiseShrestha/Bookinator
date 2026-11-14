// Which collection the page plays, decided without loading any catalog (main.tsx needs it before
// the catalogs are imported, to fetch a release from Supabase first).
//
// Choice, highest priority first: the page URL (?collection=research), then VITE_CATALOG=cmu, then classic.
export type CollectionId = "classic" | "research";

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

function fromUrl(): CollectionId | null {
  try {
    const v = new URLSearchParams((globalThis as { location?: { search: string } }).location?.search ?? "").get("collection");
    return v === "research" || v === "classic" ? v : null;
  } catch {
    return null;
  }
}

export function activeCollectionId(): CollectionId {
  return fromUrl() ?? (env.VITE_CATALOG === "cmu" ? "research" : "classic");
}

/** Set by main.tsx before the app loads when a release was fetched from Supabase. */
export interface RemoteCatalogOverride {
  collection: CollectionId;
  catalog: unknown;
}
export const REMOTE_OVERRIDE_KEY = "__BOOKINATOR_REMOTE_CATALOG__";
