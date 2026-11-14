# CLAUDE.md — Bookinator (formerly That Book)

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

The project was first built in an environment without npm registry access. On 14 Nov 2026 the real
toolchain ran for the first time (Node 22, Python 3.13, Linux) and `npm run verify` is fully green:

- `npm install` resolved every declared range unchanged: vite 7.3.8, @vitejs/plugin-react 5.2.0,
  typescript 5.9.3, tsx 4.23.15, react 19.3.1. `package-lock.json` is committed.
- `tsc` 5.9 (both tsconfigs), 49 node tests, 15 python tests, validation and `vite build` all pass with no code changes.
- `vite dev` was playtested in Chromium at 1280×860 and 390×844: Undo, guess, rejection, undo of a rejection,
  18-question shortlist, reload-resume, no-match exit; no console errors.
- Python npm scripts go through `scripts/py.mjs`, which finds `python3`, `python` or `py -3` (3.10+; override
  with `PYTHON`). **Not yet run on a real Windows machine.**

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
- `src/components/` UI screens (`Folio.tsx` = SVG mascot, mood from game state only); `src/App.tsx` state + keyboard; `src/game.ts` wiring + env vars.
- `src/data/index.ts` — the one line choosing the shipped catalog (currently `fixture.catalog.json`).
- `server/library-proxy.mjs` — stdlib Node proxy keeping the Data4Library key server-side.
- `research/chatgpt_source/` — ChatGPT's research code, unchanged; tests via `npm run test:research`.
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

## Research catalog (500 imported records → 27 playable books)

Two catalogs ship. The **10-book fixture** stays the default (`npm run dev`). The **CMU / research catalog**
is selected with `npm run dev:cmu` (or `VITE_CATALOG=cmu`). Never report imported records as game coverage:

| Measure (14 Nov 2026) | Count |
| --- | ---: |
| Source records imported (CMU Core priority 500) | 500 |
| Records with a validated question matrix | 500 (7,348 source-linked cells; 468 have ≥12) |
| Form holds kept out of the novel pool | 8 |
| Cells reviewed by a person | **0** |
| **Playable game targets** | **27** (17 with the base 64 questions only) |

Pipeline (`npm run catalog:research`; needs the research and Core packs next to the repo, not committed):
1. `scripts/merge_research.py`: researched matrix (`core500_researched_labels.json`) merged by stable ID with
   this project's own 160 labelled books (`data/cmu/responses/`). 312 of our cells added where research had 0.5,
   none where research withheld or flagged a cell; 1 direction conflict (Water for Elephants q06) set to
   ambiguous; 497 agreeing cells keep the stronger value. **Calibration:** 3,200 cells whose recorded method is
   an explicit field or closed official list (language field, Nobel list, named series, corroborated publication
   period) go from qualified 0.7/0.3 to strong 0.9/0.1, as the labelling prompt's own scale defines. AI
   interpretations stay 0.7/0.3. The result passes the research pack's own `validate_evidence_matrix`.
2. `scripts/build_cmu_catalog.py --limit 500 --gate none`: compact runtime catalog, no plot text or quotes.
3. `scripts/gate_catalog.ts`: **engine gate** with the real engine and unchanged `config.ts` thresholds. A book
   is playable only if answering exactly from its own labels makes it the engine's first guess (backward seed,
   then forward retry in priority order). `tests/cmu_catalog.test.ts` re-checks this on every `npm test`.

Simulation (`reports/simulation_research.json`, seed 42, 30 games/book): see the motif table below.
Machine-labelled data: these are not accuracy claims. Why so few: most research labels are qualified 0.7/0.3, which the engine cannot turn into a
confident guess within 18 questions. More playable books need **stronger, distinguishing plot labels reviewed by
a person**, not lower thresholds. Every book's status and reason is in `data/cmu/coverage_report.json`.

### Motif questions (52 concrete story elements)

`scripts/motif_labels.py` adds 52 questions about things a reader remembers ("Does a dragon appear?", "Are
there vampires?", "Is someone kidnapped?", "Is there a courtroom trial?" …; full list in
`data/motifs/motif_questions.json`). Evidence comes only from story text: the CMU plot synopsis and the premise
paragraph that opens the Wikipedia article, never reception, background or category lines. Labels are
**positive only** (an explicit mention gives 0.9 with an exact quote); a summary not mentioning a dragon stays
unknown, never No. Patterns were tuned against their hits and 52 figurative or off-story hits were rejected by
an AI assistant (`data/motifs/rejected.json`); random samples of the broad motifs were checked. No person has
reviewed them. Result: 2,146 motif labels on 467 books.

| | base 64 questions | + 52 motif questions |
| --- | ---: | ---: |
| Playable books (engine gate, thresholds unchanged) | 17 | **27** |
| Clear memory: first guess right / found by any route | 26.3% / 92.7% | 31.9% / 82.7% |
| Half memory: first guess right / found by any route | 6.9% / 82.9% | 6.7% / 67.0% |

Experiment, **not shipped**: counting "the summary never mentions it" as a weak No (0.3) on motif questions
makes 178 books pass the gate, but clear-memory play falls to 8.6% first guess / 57.1% found. That breaks the
brief's "missing evidence is unknown, not No" rule and is a product decision, not a default.

## Known open items (not errors — need people or keys)

- Fixture: 171/589 labels AI-checked against cited sources; 414 unchecked; **no human review**.
- Research catalog: 500 imported, 27 playable (with motif questions), 0 reviewed. Human review of distinguishing labels is the next lever.
- LLM labelling and Data4Library proxy were tested only against mock servers; try one real call each.
- Human playtests, rehearsals, QR code (live site: https://wiseshrestha.github.io/Bookinator/, redeployed on every push to main).
