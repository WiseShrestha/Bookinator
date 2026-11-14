import { makeConfig, type EngineConfig } from "../src/engine/config.ts";
import { compileCatalog, type Catalog, type CompiledCatalog } from "../src/engine/model.ts";

/** Build a synthetic catalog from an x matrix: rows = books, columns = questions. */
export function synthetic(
  matrix: number[][],
  opts: { groups?: string[]; recall?: number[]; adaptation?: boolean[]; inactive?: boolean[] } = {},
): Catalog {
  const nq = matrix[0].length;
  return {
    catalog_version: "test",
    data_status: "development_fixture",
    books: matrix.map((_, i) => ({
      id: `b${i}`,
      title_en: `Book ${i}`,
      title_ko: null,
      aliases: [],
      author: "Test",
      original_language: "en",
      first_publication_year: null,
      series_id: null,
      series_number: null,
      openlibrary_work_id: null,
      editions: [],
      sources: [],
    })),
    questions: Array.from({ length: nq }, (_, j) => ({
      id: `q${j}`,
      text: `Question ${j}?`,
      definition: "",
      group: opts.groups?.[j] ?? `g${j}`,
      recallability: opts.recall?.[j] ?? 1,
      adaptation_sensitive: opts.adaptation?.[j] ?? false,
      active: opts.inactive?.[j] ? false : undefined,
    })),
    features: matrix.flatMap((row, b) =>
      row.map((p, q) => ({
        book_id: `b${b}`,
        question_id: `q${q}`,
        p_yes: p,
        status: "unreviewed_fixture" as const,
        source_ids: [],
        reviewed: false,
      })),
    ),
  };
}

export function setup(
  matrix: number[][],
  opts: Parameters<typeof synthetic>[1] = {},
  overrides: Partial<EngineConfig> = {},
): { cc: CompiledCatalog; config: EngineConfig } {
  const config = makeConfig(overrides);
  return { cc: compileCatalog(synthetic(matrix, opts), config.channel, config.unknownPYes), config };
}

/** 2^k books distinguished by k perfectly informative binary questions. */
export function binaryMatrix(k: number, extraQuestions = 0): number[][] {
  const rows: number[][] = [];
  for (let b = 0; b < 2 ** k; b++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) row.push((b >> j) & 1 ? 0.9 : 0.1);
    for (let e = 0; e < extraQuestions; e++) row.push(0.5);
    rows.push(row);
  }
  return rows;
}
