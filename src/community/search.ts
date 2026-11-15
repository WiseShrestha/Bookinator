// Duplicate check against the books the browser already has (the active catalog), so the
// "similar book" hint works without any server. Same idea as the SQL search_books(): normalised
// text, substring and character-bigram similarity over title, Korean title, aliases and author.
import type { CatalogBook } from "../engine/model.ts";

export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

/** Removes control, invisible and bidi-override characters and collapses whitespace (same rule as SQL tb_clean_text). */
export function cleanText(s: string): string {
  return s
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/ /g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams (works for Hangul and Latin alike). */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let total = 0;
  let shared = 0;
  for (const n of x.values()) total += n;
  for (const [g, n] of y) {
    total += n;
    shared += Math.min(n, x.get(g) ?? 0);
  }
  return total === 0 ? (a === b && a !== "" ? 1 : 0) : (2 * shared) / total;
}

function titleScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  if (query.length >= 2 && (candidate.includes(query) || query.includes(candidate))) return 0.85;
  return similarity(query, candidate);
}

export interface LocalHit {
  book: CatalogBook;
  score: number;
}

export function searchLocal(books: readonly CatalogBook[], title: string, author = "", limit = 3, threshold = 0.45): LocalHit[] {
  const qt = normalize(title);
  const qa = normalize(author);
  if (qt.length < 1 && qa.length < 2) return [];
  const hits: LocalHit[] = [];
  for (const book of books) {
    const titles = [book.title_en, book.title_ko, ...book.aliases].map(normalize).filter(Boolean);
    const t = qt ? Math.max(0, ...titles.map((c) => titleScore(qt, c))) : 0;
    const a = qa ? titleScore(qa, normalize(book.author)) : 0;
    // Title carries the match; a matching author only lifts a plausible title (or stands in when no title).
    const score = qt ? (a > 0.6 ? Math.min(1, t + 0.15) : t) : a * 0.8;
    if (score >= threshold) hits.push({ book, score });
  }
  hits.sort((x, y) => y.score - x.score || x.book.title_en.localeCompare(y.book.title_en));
  return hits.slice(0, limit);
}
