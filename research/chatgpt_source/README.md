# That Book — source code for Claude

This is a compact extraction of the source code used for the 500-book catalog research and the independent five-book demo. It is also included in the full That_Book_Continuation_Preparation.zip.

## Included

- scripts/: labeling, research, source parsing, metadata enrichment, validation, non-overwriting merge, catalog diagnostics and 31 tests.
- core_tools/: original Core builder, validator, batch preparation and 8 tests.
- five_book_demo/: standalone HTML, Bayesian engine, five-title fixture and 15 checks. Open standalone.html locally to try it. This is a separate demo, not Claude's original game.
- questions_64.json, response schema, optional research dependency, source attribution/license notices, and the final handoff.

## Use with the final data

The large data/ and reports/ directories are intentionally in the separate full continuation package. Extract that package and keep these source paths alongside data/ and reports/. The preferred input pair is data/core500_researched_labels.json plus data/priority_500_researched.jsonl. Read CLAUDE_RESUME.md for exact import, correction and game-tuning instructions. Historical extraction scripts are retained for reproducibility; do not run a legacy rebuild over the final data or Claude's newer work.

Run from the extracted project root:

```bash
python -m unittest discover -s scripts -p 'test_*.py' -v
python -m unittest discover -s core_tools -p 'test_*.py' -v
node five_book_demo/test-engine.cjs
python scripts/validate_evidence_matrix.py --root .
```

The tests use the standard Python library and Node. Only optionally re-parsing live Wikipedia wikitext requires requirements-research.txt. No model API key is needed for cached validation or the five-book demo.

## Scope

The original Claude game repository, frontend/backend and its claimed 145-row checkpoint were not available. This archive contains the catalog tools and separate demo source available here, not a copy of that unavailable application. The complete 500-record data is AI draft evidence and not a human-reviewed, activated game catalog.
