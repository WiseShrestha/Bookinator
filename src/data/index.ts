// The single place that decides which catalog the app ships.
//
// Today: the 10-book DEVELOPMENT FIXTURE. When a reviewed catalog exists, run
//   python3 scripts/prepare_catalog.py merge ... --out src/data/catalog.json
// then change the import below to "./catalog.json". The UI reads `data_status`
// and shows a warning banner for anything that is not "production".
import type { Catalog } from "../engine/model.ts";
import raw from "./fixture.catalog.json";

export const ACTIVE_CATALOG = raw as unknown as Catalog;
