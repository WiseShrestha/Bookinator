// The single place that decides which catalog the app ships.
//
//   default            the 10-book DEVELOPMENT FIXTURE (labels from general knowledge, partly source-checked)
//   VITE_CATALOG=cmu   the machine-labelled CMU catalog built by scripts/build_cmu_catalog.py
//                      (only the books that pass its playability gate; see data/cmu/coverage_report.json)
//
// The UI reads `data_status` and shows a warning banner for anything that is not "production".
import type { Catalog } from "../engine/model.ts";
import cmu from "./cmu.catalog.json";
import fixture from "./fixture.catalog.json";

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

export const ACTIVE_CATALOG = (env.VITE_CATALOG === "cmu" ? cmu : fixture) as unknown as Catalog;
