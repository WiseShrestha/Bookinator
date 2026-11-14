// Catalog links. Only links built from verified IDs or documented search URLs —
// never an invented shelf location, call number or availability claim.
import type { CatalogBook } from "./model.ts";

export interface CatalogLink {
  label: string;
  url: string;
  /** What exactly this link points at, shown to the user for honesty. */
  description: string;
}

const OPEN_LIBRARY = "https://openlibrary.org";

/**
 * Optional local-library search link. Set VITE_LOCAL_LIBRARY_SEARCH_URL to a template
 * containing {query}, e.g. a university OPAC search URL you have verified by hand.
 */
export interface LinkOptions {
  localSearchTemplate?: string;
  localSearchLabel?: string;
}

export function catalogLinks(book: CatalogBook, opts: LinkOptions = {}): CatalogLink[] {
  const links: CatalogLink[] = [];
  if (book.openlibrary_work_id && /^OL\d+W$/.test(book.openlibrary_work_id)) {
    links.push({
      label: "Open Library record",
      url: `${OPEN_LIBRARY}/works/${book.openlibrary_work_id}`,
      description: "Work record on Open Library (all editions).",
    });
  } else {
    const params = new URLSearchParams({ title: book.title_en, author: book.author });
    links.push({
      label: "Search Open Library",
      url: `${OPEN_LIBRARY}/search?${params.toString()}`,
      description: "Title + author search on Open Library (no verified work ID stored yet).",
    });
  }
  const template = opts.localSearchTemplate?.trim();
  if (template && template.includes("{query}") && /^https:\/\//.test(template)) {
    const query = book.title_ko ?? book.title_en;
    links.push({
      label: opts.localSearchLabel?.trim() || "Search the library catalog",
      url: template.replace("{query}", encodeURIComponent(query)),
      description: `Catalog search for "${query}". Check which edition and language the library holds.`,
    });
  }
  return links;
}
