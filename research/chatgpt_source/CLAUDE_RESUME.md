# That Book — FINAL Claude data handoff

Updated 14 November 2026. This supersedes the earlier 3,101-answer continuation package.

The 500-record AI labeling and source-research pass is complete. Import the preferred files below into the existing project. Human approval and integration into Claude's unavailable app remain separate work.

## Final measured results

| Measure | Result |
| --- | ---: |
| Stable book records / unchanged questions | 500 / 64 |
| Source-linked, non-unknown draft labels | 7,037 |
| Unknown cells preserved | 24,963 |
| Records with at least 12 known labels | 463 |
| Default novel-scope records / form holds | 492 / 8 |
| Remaining unresolved publication-period predicates | 0 of 1,000 |
| Exact publication-year disagreements retained | 18 records |
| Identical feature-vector groups | 6 groups / 12 records |
| Human-reviewed labels / activated targets | 0 / 0 |
| Python tests / demo checks passing | 39 / 15 |

The 12-label threshold measures coverage. It does not establish playability, independent factual approval, or sufficient information to distinguish a title among 500 candidates.

## Import exactly these files

| File | Purpose |
| --- | --- |
| `data/core500_researched_labels.json` | Preferred final matrix: `books`, `book_id`, 64 `answers` per row, exact evidence references. |
| `data/priority_500_researched.jsonl` | Matching source catalog, evidence registry, corrected identities, revision URLs and license information. |
| `questions_64.json` | Question text, definitions, grouping, recallability and spoiler policy; unchanged. |
| `data/research_label_methods.json` | Distinguishes explicit source facts, AI interpretations and deterministic derivations. |
| `reports/form_quarantine.json` | Eight retained records excluded from the default novel candidate pool. |

`data/after_145_researched_labels.json` is the incoming subset for original zero-based indices 145–499. Prefer stable IDs over row numbers. `data/core500_researched_candidate_matrix.json` contains compact inactive vectors for adapters and diagnostics. It is not an activated game catalog.

The older `core500_draft_labels.json`, `core500_labels_with_metadata.json`, their old catalogs, and older reports remain historical stages for reproducibility. They are superseded: **do not import them in place of the researched pair.** The original Core validator only supports synopsis quotes and therefore requires an evidence-registry adapter for the final matrix. Do not disguise metadata quotes as CMU quotes to bypass validation.

## What the research completed

- AI passage review across all 500 original priority records, followed by 371 current-source context panels and 93 additional weak-record panels. These are selected-context reviews, not full-novel reading or exhaustive source fact checking.
- Current Wikipedia revision caches and normalized text, with exact source/revision links. The cache contains 501 parsed pages, including corrective/redirect lookups; this is not 501 extra books. Five hundred matched Wikidata work entities are cached for cross-checks.
- Original-language evidence is taken from explicit work-level language fields/statements, rather than edition or summary language. Four records retain some language unknowns: Chamber of Secrets, A Christmas Carol, Silence, and As I Lay Dying. Conflicting or unrecognized dialect/multiple-language claims are preserved rather than silently collapsed.
- All 1,000 q60/q61 publication-period predicates now have current corroborating work evidence, with an official publisher hardcover date for Silence. These answer before-1900 / 2000-onward questions. They do **not** resolve a unique exact first-publication year for every work. Eighteen disagreements remain recorded; serial, original-language and translated editions need distinction if exact years are used later.
- Nobel Literature q64 uses the complete official 1901–2026 prize API list, including no-award years. Source text for these 500 cells is an explicitly marked deterministic author-name lookup, not a verbatim sentence from the API. Author identity follows the matched record; no author-nationality inference is used.
- Explicit series, genre, narration, released film/series adaptations and narrative setting evidence were added where supported. Planned adaptations, another volume's film, standalone TV-film/series ambiguities, and figurative supernatural language are not automatically admitted.
- A single supported majority setting era entails No for other mutually exclusive q17–q20 majority-era bins. Imagined future q21 excludes real-world present q20, but does not exclude historical calendar bins relative to a work's publication. Derived cells retain their dependency and source quote.

Final source-family counts: CMU 2,762; current Wikipedia 3,456; goodbooks 211; Wikidata 106; official Nobel lookup 500; publisher factual metadata 2. All add to 7,037. Some old plot evidence remains where later passes did not change it.

## Corrections and scope holds

- **Little Women:** replaced the mistaken musical article as the current evidence source with the novel article. The stable book ID and original supplied synopsis remain archived. Novel facts use the correct current source; musical text was not rewritten into novel evidence.
- **The True Story of the Three Little Pigs:** corrected author to Jon Scieszka and retained Lane Smith as illustrator. It is held out of the default novel scope.
- **Silence:** its old Wikipedia article redirects to the series; series-wide facts were not imported as individual-book evidence. Publisher factual metadata supplies its publication-period predicates.
- **Lord of the Flies:** corrected the unsupported central-female label to qualified No using the explicit all-boy survivor premise.
- **The BFG:** secondary-world status remains unknown; an invented region on Earth does not establish a separate world.
- **2001: A Space Odyssey:** film-adaptation claim withheld because the novel/film were developed concurrently, and a selected 2010-film context concerned another volume.
- **The Green Mile:** 1996 framing scenes do not establish a majority 1946–1999 setting. The conflicting label was removed and the principal 1932-era constraint applied.
- Malformed numeric infobox `series` fields (`8` and `1`) were rejected. A Wrinkle in Time retains its earlier valid named-series evidence; The Lorax does not gain series membership from a number.
- Two first-series-volume conflicts remain unknown because chronological versus publication ordering differs.

The eight form holds are A Midsummer Night's Dream, Goodnight Moon, The Lorax, Fantastic Beasts and Where to Find Them, Love You Forever, The True Story of the Three Little Pigs, The Silmarillion, and Quidditch Through the Ages. These are retained for a deliberate scope decision. Little Women is no longer held solely for the old musical-source mistake. Form screening is an AI judgment, not a guarantee every other record is a conventional novel.

## Game audit: resolve this in the actual app

The earlier separate five-book demo still passes its 15 checks and five clean fixture games. Its stop rule does not scale directly to this sparse 492-candidate pool.

A deterministic audit used all 492 in-scope candidates, equal priors, the demo's response model, and an 18-question cap. Targets answer from their own data: qualified Yes becomes Yes, qualified No becomes No, unknown becomes Don't know. This is **fixture self-consistency**, not human accuracy or a test of Claude's app.

| Diagnostic | Target ranked first | Target in top 3 | Confident guesses |
| --- | ---: | ---: | ---: |
| Demo stop rule, weighted information-gain cutoff 0.008 | 40 / 492 | 92 / 492 | 0 |
| Early information cutoff disabled, full 18-question cap | 199 / 492 | 325 / 492 | 0 |

The first scenario averages about six questions and ends all games as shortlists. The second diagnostic improves coverage but still cannot confidently distinguish the catalog. It is an experiment, **not a production fix or a recommendation to lower confidence gates**. Both report every target and response trail.

For the real app: inspect early stopping, correlated questions, calibration and sparse unknown handling; review actual distinguishing plot features; test focused candidate pools before activating more titles. Language and publication metadata boost count coverage but often contribute little discrimination. Six identical-vector pairs require more distinguishing evidence. Preserve a shortlist/unsupported-title path. Do not fill unknowns with fabricated No answers or use a count threshold as a game-accuracy claim.

## Merge into Claude's existing project

The original app source, actual simulator and claimed 145-row checkpoint were unavailable here. This handoff completes the accessible data work and provides reproducible audits. It does not claim app integration, deployment or a new browser playtest.

1. Open the existing repository and checkpoint; compare its schema and question definitions with this package.
2. Merge by stable ID into a new output. Preserve whole existing rows and reviewed decisions. Inspect overlapping IDs separately for better incoming evidence and the important corrections above; preservation must not hide known erroneous old labels.
3. Combine source registries without dropping sources referenced by existing labels. Apply explicit identity corrections only after matching the work; keep original IDs and archived source claims.
4. Run the metadata-aware validator on the combined matching pair. Inspect interpretations, spoiler safety, form holds, low-coverage rows, year discrepancies and vector collisions.
5. Adapt reviewed/suitable candidates into the actual builder. Run its actual simulator and browser checks; report factual validation, count coverage, fixture ranking, human accuracy and active targets separately.

Example non-overwriting row merge, with real paths substituted:

```bash
python scripts/merge_labels.py --existing path/to/claude_labels.json --incoming data/core500_researched_labels.json --out path/to/merged_draft_labels.json
```

The helper expects Core's `books` / `book_id` / `answers` format. It preserves whole existing rows and writes an overlap report; it does not merge evidence registries or resolve semantic conflicts automatically. Write a schema adapter if the real app differs.

## Validate or reproduce locally

Python 3.10+ and Node; no API key, model call or paid service is needed to validate/import cached results.

```bash
python scripts/validate_evidence_matrix.py --root .
python -m unittest discover -s scripts -p 'test_*.py' -v
python -m unittest discover -s core_tools -p 'test_*.py' -v
node five_book_demo/test-engine.cjs
node scripts/audit_catalog_engine.cjs
node scripts/audit_catalog_engine.cjs --min-score=0 --report=catalog_engine_18_question_diagnostic.json
```

The validator defaults to the **researched** pair and checks all 500 stable IDs, all 64 questions, source registration, exact quote membership and field safety. Validation does not prove the associated literary interpretation. The 31 continuation tests plus eight original Core tests pass; the demo has 15 passing checks. Logs are in `reports/final_test_*.txt`.

Optional rebuild from cached source material, **in a copy**, overwrites the preferred draft pair:

```bash
python scripts/research_enrichment.py --root .
python scripts/apply_current_decisions.py --root .
python scripts/apply_current_decisions.py --root . --panels data/weak_record_review_panels.json --decisions data/weak_semantic_decisions --audit reports/weak_record_review_audit.json
python scripts/finalize_researched_data.py --root .
python scripts/validate_evidence_matrix.py --root .
```

The saved base/enriched historical stages are inputs. Do not run a rebuild over Claude's later edited labels. Re-parsing raw wikitext optionally requires `requirements-research.txt`; cached-label validation and import use the standard library. Live fetch scripts are optional and may retrieve newer revisions; final admitted source caches are pinned in this ZIP.

## Provenance and limitations

Read `ATTRIBUTION.md` and preserve record-level credits and license notices. The noncommercial expansion archive remains separate and was not merged. Wikipedia-derived synopsis/current text, goodbooks metadata, Wikidata structured facts, Nobel API facts and publisher fields have distinct provenance.

Every cell remains `reviewed=false`. Qualified probabilities 0.7/0.3 are AI judgments and are not calibrated model likelihoods; unknown is 0.5. `supported` denotes a source-linked AI interpretation. `premise_safe=true` is an AI judgment, not a human spoiler review. Internal quotations can contain spoilers and must not be displayed to players.

Negative answers require explicit support, an identified closed-list lookup or a valid recorded logical dependency. Missing mention is not No. Publication year is never story era; author nationality is never original language. A successful format check does not prove factual correctness.

No additional paid research-agent jobs were restarted. This final research pass used public-source retrieval, AI context adjudication and local processing; no paid Firecrawl agent calls were made in this pass.

## Prompt to paste into Claude

> Continue That Book in our existing project. Read CLAUDE_RESUME.md in the attached ZIP first. Import the preferred core500_researched_labels.json with priority_500_researched.jsonl, questions_64.json and research_label_methods.json. There are 500 records and 7,037 source-linked AI draft labels; 463 reach 12-label coverage, but this is not a playability approval. Preserve existing rows/reviewed work while merging by stable ID, then reconcile the documented identity and semantic corrections on overlaps. Preserve evidence registries, unknowns, attribution and eight form holds. Validate the matching pair and integrate suitable candidates into the actual game. Read both catalog-engine audit reports: the separate five-book engine stops too early on 492 candidates and full 18-question ranking remains imperfect. Use our real simulator and browser to improve question selection, calibration and distinguishing evidence before activation. Do not regenerate the completed research, manufacture missing No answers, or claim 500 game-ready targets.
