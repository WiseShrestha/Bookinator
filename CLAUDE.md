# CLAUDE.md — That Book

Hackathon project (IST-Tech IT Arena, theme "Library + Because I'm Lazy"). Deadline: **Sun 15 Nov 2026, 14:00 KST**.
An Akinator-style game: the reader answers Yes / Probably / Don't know / Probably not / No, a local Bayesian
engine narrows a fixed book catalog, proposes a best match with source-linked clues, and links to library catalogs.
No LLM calls at runtime. Full spec: `README.md` (product + engine) — read it before changing behaviour.

## First thing to do in a fresh checkout

```bash
npm install
npm run verify      # tsc + node tests + python tests + catalog validation + vite build
npm run dev         # http://localhost:5173
```

This project was built in an environment **without npm registry access**. These were verified there:
full strict `tsc` against real @types/react 19, 49 node tests, 15 python tests, validation, a Chromium
playtest of an esbuild bundle. These were **never run** and are the most likely sources of errors:

1. `npm install` itself (dependency versions in package.json were chosen, not resolved: vite ^7,
   @vitejs/plugin-react ^5, typescript ^5.6, tsx ^4.19). If resolution fails, pin to the latest working versions.
2. `vite build` / `vite dev` (only esbuild was run). Check `index.html`, `vite.config.ts` (`base: "./"`).
3. `tsc` with **TypeScript 5.x** (only TS 7.0 was available). Watch `allowImportingTsExtensions`,
   `moduleResolution: "Bundler"`, the `@ts-expect-error` on the `.mjs` import in `tests/proxy.test.ts`,
   and `types: ["node", "vite/client"]`.
4. Windows: scripts call `python3` (may need `python`/`py`); paths in Python use pathlib (fine).

When fixing, run `npm run verify` until green. Don't "fix" errors by deleting tests or weakening checks.

## Commands

| Command | What |
| --- | --- |
| `npm run verify` | everything CI runs |
| `npm run typecheck` / `npm run typecheck:engine` | full tsc / React-free strict tsc |
| `npm test` | node:test via tsx: engine, simulator, availability client, library proxy |
| `npm run test:py` | Python stdlib unittest: validator, pipeline (mocked LLM), HTTP clients vs mock server |
| `npm run validate` | `scripts/validate_catalog.py` on the fixture |
| `npm run simulate` / `npm run simulate:truth` | seeded simulations (same engine as UI) |
| `npm run proxy` | optional Data4Library proxy (`DATA4LIBRARY_AUTH_KEY` env) |
| `python3 scripts/build_fixture.py` | regenerate fixture catalog + titles.csv + evidence from `data/curation/fixture_labels.json` |

## Architecture (where things live)

- `src/engine/` — pure TS, shared by UI, tests and `scripts/simulate.ts`. Never import React here.
  - `model.ts` types + channel + `compileCatalog`; `config.ts` **all thresholds**; `posterior.ts` log-space replay;
    `selectQuestion.ts` expected information gain × recallability; `session.ts` event log, Undo, rejection,
    18-question cap, shortlist, no-match; `explain.ts` clues; `links.ts` catalog links.
- `src/components/` UI screens; `src/App.tsx` state + keyboard; `src/game.ts` wiring + env vars.
- `src/data/index.ts` — the one line choosing the shipped catalog (currently `fixture.catalog.json`).
- `server/library-proxy.mjs` — stdlib Node proxy keeping the Data4Library key server-side.
- `scripts/` — Python data pipeline (stdlib only) + simulator. `data/` — question bank, curation, evidence, truth set.

## Rules (from the build brief — keep them)

- **Never invent** book facts, ISBNs, Open Library IDs, Korean titles, citations, API parameters, availability,
  or benchmark numbers. Unknown = p_yes 0.5 / null. Fixture data stays visibly marked as development data.
- Thresholds stay configurable in `config.ts`. Don't lower the guess threshold to make numbers look better.
- No normal answer may hard-eliminate a book (channel entries must stay > 0). Don't-know must stay neutral.
- Simulations must use the same engine module as the UI.
- Secrets server-side only. Every external integration must fail gracefully (show catalog link, not a guess).
- Don't add accounts, vector databases, online learning or a live LLM chatbot.
- UI must not show raw posterior percentages as accuracy.

## Known open items (not errors — need people or keys)

- Fixture: 171/589 labels AI-checked against cited sources; 414 unchecked; **no human review**.
- Real 200-book catalog not built (Person B: titles.csv + evidence → `prepare_catalog.py label` → review).
- LLM labelling and Data4Library proxy were tested only against mock servers; try one real call each.
- Human playtests, rehearsals, QR code (from the GitHub Pages URL via `deploy-pages.yml`).
