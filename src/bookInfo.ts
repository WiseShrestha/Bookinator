// Optional extras shown next to a book: a short sourced description, a mood photo and the
// "most found" list. All of it is fetched at runtime from the source itself (nothing is written by
// us, nothing is invented) and every failure simply returns null — the game never depends on it.
//
//   description  Wikipedia intro (exact page id from the book's own source link, CC BY-SA) or the
//                Open Library work description (exact work id). Never looked up by title guess.
//   photo        Unsplash, through the `book-image` Edge Function so the API key stays server-side.
//   popular      popular_books() RPC: how many readers confirmed each book.
import { contributionsEnabled, SUPABASE_CONFIG } from "./community/client.ts";
import type { CatalogBook } from "./engine/model.ts";

export interface BookBlurb {
  text: string;
  sourceLabel: string;
  sourceUrl: string;
}

export interface BookImage {
  url: string;
  alt: string | null;
  photographer: string;
  photographer_url: string;
  photo_url: string;
}

export interface PopularBook {
  book_id: string;
  found_count: number;
}

const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  let p = memo.get(key) as Promise<T | null> | undefined;
  if (!p) {
    p = load().catch(() => null);
    memo.set(key, p);
  }
  return p;
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Plain text, at most `max` characters, cut at a sentence end when there is one. */
export function trimBlurb(raw: string, max = 420): string | null {
  const text = raw
    .split(/\n-{3,}|\(\[source\]|\[source\]/i)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 40) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

const WIKI_CURID = /^https:\/\/en\.wikipedia\.org\/\?curid=(\d+)$/;

export function fetchBlurb(book: CatalogBook): Promise<BookBlurb | null> {
  return once(`blurb:${book.id}`, async () => {
    const wiki = book.sources.map((s) => WIKI_CURID.exec(s.url)).find(Boolean);
    if (wiki) {
      const id = wiki[1];
      const data = (await getJson(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=extracts&exintro=1&explaintext=1&exsentences=3&pageids=${id}`,
      )) as { query?: { pages?: Record<string, { extract?: string }> } };
      const text = trimBlurb(data.query?.pages?.[id]?.extract ?? "");
      return text ? { text, sourceLabel: "Wikipedia (CC BY-SA)", sourceUrl: wiki[0] } : null;
    }
    const olid = book.openlibrary_work_id;
    if (olid && /^OL\d+W$/.test(olid)) {
      const data = (await getJson(`https://openlibrary.org/works/${olid}.json`)) as {
        description?: string | { value?: string };
      };
      const raw = typeof data.description === "string" ? data.description : data.description?.value ?? "";
      const text = trimBlurb(raw);
      return text ? { text, sourceLabel: "Open Library", sourceUrl: `https://openlibrary.org/works/${olid}` } : null;
    }
    return null;
  });
}

const IMAGE_CACHE = "bookinator-image:";

export function fetchImage(book: CatalogBook): Promise<BookImage | null> {
  return once(`image:${book.id}`, async () => {
    if (!contributionsEnabled) return null;
    try {
      const saved = window.sessionStorage.getItem(IMAGE_CACHE + book.id);
      if (saved) return JSON.parse(saved) as BookImage;
    } catch {
      /* storage unavailable */
    }
    const q = book.title_en.slice(0, 80);
    const data = (await getJson(`${SUPABASE_CONFIG.url}/functions/v1/book-image?q=${encodeURIComponent(q)}`)) as {
      image?: BookImage | null;
    };
    const img = data.image;
    // Only Unsplash-hosted images and links are ever rendered.
    if (
      !img ||
      !img.url.startsWith("https://images.unsplash.com/") ||
      !img.photographer_url.startsWith("https://unsplash.com/") ||
      !img.photo_url.startsWith("https://unsplash.com/")
    ) {
      return null;
    }
    try {
      window.sessionStorage.setItem(IMAGE_CACHE + book.id, JSON.stringify(img));
    } catch {
      /* storage unavailable */
    }
    return img;
  });
}

export interface LibraryLoan {
  title: string;
  author: string;
  loans: number | null;
}

/** Most-borrowed literature in Korean public libraries (Data4Library, via the Edge Function). */
export function fetchLibraryPopular(limit = 5): Promise<LibraryLoan[] | null> {
  return once("library-popular", async () => {
    if (!contributionsEnabled) return null;
    const data = (await getJson(`${SUPABASE_CONFIG.url}/functions/v1/library-popular`, undefined, 9000)) as { books?: LibraryLoan[] };
    if (!Array.isArray(data.books)) return null;
    return data.books
      .filter((b) => typeof b.title === "string" && b.title)
      .slice(0, limit)
      .map((b) => ({ title: b.title, author: typeof b.author === "string" ? b.author : "", loans: Number(b.loans) || null }));
  });
}

export function fetchPopular(catalogVersion: string, limit = 5): Promise<PopularBook[] | null> {
  return once(`popular:${catalogVersion}`, async () => {
    if (!contributionsEnabled) return null;
    const rows = (await getJson(
      `${SUPABASE_CONFIG.url}/rest/v1/rpc/popular_books`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_CONFIG.anonKey!,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ release_version: catalogVersion, max_results: limit }),
      },
      4000,
    )) as PopularBook[];
    return Array.isArray(rows) ? rows.map((r) => ({ book_id: String(r.book_id), found_count: Number(r.found_count) })) : null;
  });
}
