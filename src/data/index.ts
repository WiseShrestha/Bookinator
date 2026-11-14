// The single place that decides which catalog the app plays.
//
//   research (default) the machine-labelled CMU/research catalog built by `npm run catalog:research`
//                      (only the targets that pass the engine gate; see data/cmu/coverage_report.json)
//   classic            the 10-book DEVELOPMENT FIXTURE (labels from general knowledge, partly source-checked)
//
// Choice, highest priority first: the page URL (?collection=classic|research), then VITE_CATALOG
// (fixture|classic → classic, cmu|research → research), then research.
// The start screen links between the two. The UI shows a warning banner for anything not "production".
import type { Catalog } from "../engine/model.ts";
import cmu from "./cmu.catalog.json";
import fixture from "./fixture.catalog.json";

export type CollectionId = "classic" | "research";

export const COLLECTIONS: Record<CollectionId, { catalog: Catalog; label: string; blurb: string }> = {
  research: {
    catalog: cmu as unknown as Catalog,
    label: "Research shelf",
    blurb: `${(cmu as unknown as Catalog).coverage?.titles_reachable ?? (cmu as unknown as Catalog).books.length} books · machine-labelled, unreviewed`,
  },
  classic: {
    catalog: fixture as unknown as Catalog,
    label: "Classic shelf",
    blurb: "10 well-labelled books · most reliable play",
  },
};

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

function fromUrl(): CollectionId | null {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? "").get("collection");
    return v === "research" || v === "classic" ? v : null;
  } catch {
    return null;
  }
}

function fromEnv(): CollectionId | null {
  const v = env.VITE_CATALOG;
  return v === "fixture" || v === "classic" ? "classic" : v === "cmu" || v === "research" ? "research" : null;
}

export const ACTIVE_COLLECTION: CollectionId = fromUrl() ?? fromEnv() ?? "research";
export const ACTIVE_CATALOG = COLLECTIONS[ACTIVE_COLLECTION].catalog;

/** Link that reloads the app on the given collection (keeps the rest of the URL). */
export function collectionHref(id: CollectionId): string {
  const url = new URL(globalThis.location?.href ?? "http://localhost/");
  url.searchParams.set("collection", id);
  return url.pathname + url.search;
}
