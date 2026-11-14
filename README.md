# That Book

**Remember the story. Forget the title.**

A reader half-remembers a novel. That Book asks short questions (Yes / Probably / Don't know / Probably not / No), narrows down a fixed collection with a local Bayesian engine, proposes a best match with the clues that support it, and links to a library catalog. Undo, wrong-guess recovery, a top-3 shortlist and an honest "not in this collection" exit are built in.

Theme: **Library + "Because I'm Lazy"**: the system chooses the search questions, so the reader doesn't need an author, title, ISBN or a good search query. There are no LLM calls during play.

> ⚠ **Current data is a 10-book DEVELOPMENT FIXTURE.** It was labeled from general knowledge by an AI assistant, with no sources and no human review. The app shows a banner saying so. Don't quote its labels as facts or its numbers as accuracy. Replace it with the reviewed catalog (see *Data pipeline*).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # engine + simulator tests (node:test via tsx)
npm run simulate     # seeded simulations on the active catalog
npm run validate     # validate the fixture catalog
npm run build        # type-check + production build into dist/ (static, works offline)
python3 -m unittest discover -s tests -p "test_*.py"   # data-pipeline tests (stdlib only)
```

Requires Node 20+ and Python 3.10+. The Python scripts use only the standard library.

`dist/` is a static site that can be served from anywhere, such as GitHub Pages, Netlify or `npx serve dist`. After the page loads, the game needs no network; only the outbound catalog links do.

### Optional: local library search link

Copy `.env.example` to `.env.local` and set `VITE_LOCAL_LIBRARY_SEARCH_URL` to a catalog search URL **you have verified by hand**, with `{query}` where the title goes. If you leave it unset, only the Open Library link is shown. Malformed or non-https templates are ignored.

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`5` | Yes, Probably, Don't know, Probably not, No |
| `Y` / `N` | Accept / reject a guess |
| `U` | Undo |
| `Tab` | All controls are native buttons and reachable in order |

Focus moves to each new question or result heading, so screen readers announce it. The layout is a single column on phones and adds a history sidebar from 860 px.

---

## Project layout

```
src/engine/            pure TypeScript, shared by UI, tests and simulator
  model.ts             types, catalog schema, five-answer channel, likelihood, compileCatalog
  config.ts            ALL thresholds (configurable; brief's unvalidated defaults)
  posterior.ts         log-space replay from the uniform prior, softmax, entropy, ranking
  selectQuestion.ts    expected information gain × recallability, deterministic argmax
  session.ts           event log, guess/reject/accept/exit, Undo, 18-question cap, shortlist, no-match
  explain.ts           "Why this book" clues chosen from stored labels (never generated)
  links.ts             Open Library work link or documented title+author search; optional local link
src/components/        start, question, history, guess, shortlist, found and no-match screens
src/data/index.ts      the ONE line that chooses which catalog ships
src/data/fixture.catalog.json   10-book development fixture (generated)
data/question_bank.json         canonical 64 questions, groups, recallability, flags
data/curation/fixture_labels.json  fixture labels (compact, reviewable)
data/curation/titles.example.csv   format for the real title list
data/evidence/_example.json        format for per-book source evidence
scripts/build_fixture.py        bank + fixture labels → fixture catalog
scripts/validate_catalog.py     data-contract validator
scripts/prepare_catalog.py      check → label (batched LLM) → merge
scripts/prompts/matrix_prompt.txt  the matrix-generation prompt (from the brief)
scripts/review.py               export cells for human review → apply verdicts
scripts/openlibrary_lookup.py   suggest OL work IDs for human confirmation
scripts/simulate.ts             seeded simulations on the runtime engine
tests/                          engine.test.ts, simulate.test.ts, test_pipeline.py
reports/                        latest simulation outputs (fixture)
```

---

## Engine (exactly as specified)

- **Channel** (`config.ts`). The table gives P(answer | fact Yes) / P(answer | fact No) for each answer: Yes .55/.05, Probably .20/.10, Don't know .10/.10, Probably not .10/.20, No .05/.55. Each column must sum to 1 and every entry must be > 0, or the engine refuses to load. This guarantees that no normal answer can eliminate a book.
- **Likelihood:** `L = x·ch[a].yes + (1−x)·ch[a].no`, where unlabeled cells use x = 0.5.
- **Posterior:** recomputed by replaying the whole history from a uniform prior, in log space with a stable softmax. Rejected books get −∞. If nothing finite is left, the result is **no-match**, never an empty normalization. Don't know is exactly neutral, and Probably is weaker than Yes.
- **Selection:** maximize `IG(q) × recallability[q]`, where IG = H(p) − Σₐ P(a|q)·H(p after a). It only considers questions that are active, unasked, outside film mode if adaptation-sensitive, and whose correlation group hasn't been used (one per group by default). Ties within 1e-12 go to the earlier question. Books with p < 1e-15 are skipped in the inner loop, which doesn't change results. A test checks the optimized IG against the brief's direct formula.
- **Next action**, in order:
  1. Two rejections → shortlist.
  2. Guess when there are ≥6 informative (non-Don't-know) answers, top p ≥ 0.80, top/second ≥ 4, and at least 1 answer since the last rejection.
  3. 18 questions asked, or no eligible questions → shortlist.
  4. Best score < 0.01 → shortlist.
  5. Otherwise ask.
- **Session:** an append-only event log (answer, reject, accept, exit). Undo drops the last event, so undoing a rejection restores the book. Events that don't fit the current action throw.

**One addition to the brief:** `questionsAfterRejection = 1`. The brief's pseudocode would let the engine re-guess immediately after a rejection without asking anything. The brief's text says to "continue questioning", so I required one answer first. Set it to 0 to match the pseudocode literally.

The UI never shows posterior percentages. It says "My best match".

---

## Data pipeline (Person B)

1. **Titles.** Copy `data/curation/titles.example.csv` to `titles.csv`, with one row per *work* (not edition). Fill `title_ko`, `openlibrary_work_id` and aliases **only when verified**. Mark the demo pool with `demo_pool=yes`.
2. **Evidence.** Create one `data/evidence/<id>.json` per book with real https URLs you opened, the license or terms you checked, and short excerpts (format in `_example.json`). Then run `python3 scripts/prepare_catalog.py check`.
3. **Pilot.** Run `prepare_catalog.py label --dry-run` to print the first prompt and a rough token estimate. Then label a 10-book pilot:
   ```bash
   ANTHROPIC_API_KEY=… python3 scripts/prepare_catalog.py label --only <10 ids> \
     --provider anthropic --model <exact model id> --input-rate <$/M in> --output-rate <$/M out> --cap 10
   ```
   Prices are **not** hard-coded; pass your provider's current rates, and with no rates the script makes no call. Batches are 1–10 books (8 by default). Each batch is checked for exact question IDs, allowed values and only-supplied source IDs, retried up to 3 times, and checkpointed in `data/work/labels/`. The script stops *before* any call whose worst-case cost would break the cap. Re-runs skip finished batches. `--provider openai` is also supported. Keys come only from the environment.
4. **Merge and validate.** `prepare_catalog.py merge --runtime-out src/data/catalog.json` writes `data/catalog.full.json` (with notes) and a compact runtime file. It refuses to write the runtime file if validation fails, and it keeps earlier review decisions.
5. **Review.** `scripts/review.py export` writes a CSV with every informative label of the demo books, 100 seeded random cells, and the separating cells of the 10 closest book pairs. Fill in `verdict` (ok / fix / unknown) and `reviewer`, then run `review.py apply`. Re-merge after applying.
6. **Ship.** Change the import in `src/data/index.ts` to `./catalog.json`. Use `merge --production` only when review is done; the banner disappears only for production catalogs.

`python3 scripts/validate_catalog.py <catalog> --bank data/question_bank.json [--strict]` checks:
- unique IDs and reference integrity;
- p_yes ∈ {0.1, 0.3, 0.5, 0.7, 0.9} and allowed statuses;
- "supported" cells cite one of the book's own sources;
- no placeholder URLs or licenses, and Open Library ID format;
- no fixture labels in production;
- books with too few labels, and book pairs the engine cannot tell apart. It also lists the 5 closest pairs.

---

## Test results (run on 14 Nov 2026 in the build environment)

| Check | Result |
| --- | --- |
| `npm test` (engine + simulator, node:test) | **41/41 pass** |
| Python pipeline + validator tests (mocked LLM, no network) | **10/10 pass** |
| Strict `tsc` on engine, scripts and tests (`tsconfig.engine.json`) | **pass** |
| `validate_catalog.py` on fixture with `--bank` | **OK**, 0 errors, 0 warnings |
| Browser playtest, Chromium at 390×844 and 1280×860 (keyboard-driven full games, Undo, guess, 2 rejections → shortlist → no-match, reload-resume) | **all pass, no console errors** |

Engine tests cover:
- normalized finite posteriors and neutral Don't know;
- weaker Probably, and no hard elimination after 40 contradicting answers;
- stability over 2,000 answers, deterministic replay, and Undo (including un-reject);
- rejection exclusion, all-rejected → no-match, two rejections → shortlist;
- tie-breaking, correlation groups, inactive and film-mode filtering;
- the 18-question cap, exhausted questions, low information, and recovery from one wrong answer;
- invalid-event rejection, clue selection, and link safety.

### Simulation on the fixture (seed 42, 30 games × 10 books × scenario)

This is **internal consistency only**: the simulated users answer from the same unreviewed labels the engine uses. For each game the simulator samples a latent truth from each label, so a 0.7 label is "false" in 30% of games.

| scenario | top-1 | found incl. shortlist | mean Q (all) | p90 Q |
| --- | --- | --- | --- | --- |
| clear (5% unknown, 0 wrong) | 93.3% (280/300) | 99.7% (299/300) | 8.9 | 14 |
| half (25% unknown, 5% wrong) | 62.3% (187/300) | 95.7% (287/300) | 13.5 | 18 |
| difficult (40% unknown, 10% wrong) | 38.0% (114/300) | 88.0% (264/300) | 16.1 | 18 |
| one mistake in first 6 | 79.7% (239/300) | 97.3% (292/300) | 12.0 | 18 |
| sampled from engine channel | 63.0% (189/300) | 95.0% (285/300) | 12.9 | 18 |

Against the brief's provisional targets, clear top-1 (95%) and half top-1 (80%) are **not met**, and half found-incl.-shortlist (90%) **is met**. With `--crisp-truth` (labels ≠ 0.5 treated as certain), clear reaches 100% top-1 in 6.7 questions and half reaches 93.7%. So on the fixture, most of the gap comes from uncertain 0.7/0.3 labels, not the engine. Full outputs, including confusion pairs, are in `reports/`.

**Scale warning, from a synthetic test, not a prediction:** on a *random* 200-book catalog with crisp truth, clear top-1 was only 62.7% and needed about 16 questions. Under this channel a single strong answer moves the odds by at most about 5×. So at 200 books, the 18-question cap plus the 0.80 / ×4 guess rule may leave little headroom, and many games will end on the shortlist. Measure it on the real catalog as soon as it loads (the 21:00 checkpoint). The levers are stronger well-sourced labels (0.9/0.1 where evidence is clear), sharper questions, a narrower demo pool, and channel tuning from playtests, not just lowering the guess threshold. A full 200-book run takes about 10 ms per game, roughly 5 minutes for all scenarios; use `--scenario` and `--games` for quicker passes.

---

## Milestone status

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Schema and engine tests | ✅ done |
| 2 | Complete small-catalog UI | ✅ done, browser-verified |
| 3 | Data validation and ingestion | ✅ scripts done and tested offline (mocked LLM). ❗ No real titles, evidence or labels yet; that's Person B's work |
| 4 | Simulation | ✅ done on fixture. ❗ needs the real catalog plus an independent 20-book truth fixture (`--truth`) |
| 5 | Catalog links | ✅ Open Library work or search link; optional verified local link. Data4Library proxy **not built** (no key; brief: only after a key works) |
| 6 | Playtest fixes | ✅ automated playtest fixes made (clue ranking, mobile progress bar). ❗ **No human playtests yet** |
| 7 | Presentation readiness | 🟡 offline single-file build works. ❗ Backup recording, timed rehearsals, QR code and demo pool still to do |

## Limitations and things that were not verified

- **Vite was not run in the build environment**, which had no package-registry access. The same sources were bundled with esbuild and tested in Chromium. Run `npm install && npm run build` once on a team machine to confirm, and especially run the full `tsc -p tsconfig.json` (React typings were unavailable there).
- **Fixture labels are unverified.** Korean titles, Open Library IDs and ISBNs are deliberately null.
- **Not executed against real services:** the LLM calls in `prepare_catalog.py` (request formats follow the providers' public message/chat APIs; try a 1-book pilot first) and `openlibrary_lookup.py`.
- `q56` (short novel) is **inactive** until "short" is defined consistently. Adaptation-sensitive flags (q49–q52, q56) are a judgment call; review them.
- Simulated users are stress scenarios, not human behavior. They can't show that the labels are correct.
- Session persistence uses localStorage when available and silently does nothing otherwise.
- Not built, per the brief: accounts, online learning, vector search, a live LLM, availability lookups, covers and related books.
