#!/usr/bin/env python3
"""Build the 10-book DEVELOPMENT FIXTURE from the question bank + data/curation/fixture_labels.json.

    python3 scripts/build_fixture.py

Writes
  src/data/fixture.catalog.json   runtime catalog (data_status "development_fixture")
  data/curation/titles.csv         the same 10 books in the pipeline's title format
  data/evidence/<id>.json          per-book sources + paraphrased evidence notes (pipeline format)

Cell status: "supported" when the label was checked against a cited source, "ambiguous" when the
source leaves it debatable (note attached), otherwise "unreviewed_fixture". reviewed=false everywhere:
no human has reviewed these yet.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "data" / "question_bank.json"
LABELS = ROOT / "data" / "curation" / "fixture_labels.json"
OUT = ROOT / "src" / "data" / "fixture.catalog.json"
TITLES = ROOT / "data" / "curation" / "titles.csv"
EVIDENCE = ROOT / "data" / "evidence"
TITLE_FIELDS = ["id", "title_en", "title_ko", "aliases", "author", "original_language", "first_publication_year",
                "series_id", "series_number", "openlibrary_work_id", "demo_pool"]


def main() -> None:
    bank = json.loads(BANK.read_text(encoding="utf-8"))["questions"]
    spec = json.loads(LABELS.read_text(encoding="utf-8"))["books"]
    books, features, rows = [], [], []
    counts = {"supported": 0, "ambiguous": 0, "unreviewed_fixture": 0}
    for b in spec:
        sources = b.get("sources", [])
        books.append({
            "id": b["id"], "title_en": b["title_en"], "title_ko": b.get("title_ko"), "aliases": b.get("aliases", []),
            "author": b["author"], "original_language": b["original_language"],
            "first_publication_year": b["first_publication_year"], "series_id": b["series_id"],
            "series_number": b["series_number"], "openlibrary_work_id": b.get("openlibrary_work_id"),
            "editions": b.get("editions", []), "sources": [{"id": s["id"], "url": s["url"], "license": s["license"]} for s in sources],
        })
        supported, ambiguous = b.get("supported", {}), b.get("ambiguous", {})
        for qid in sorted(b["labels"]):
            f = {"book_id": b["id"], "question_id": qid, "p_yes": b["labels"][qid],
                 "status": "unreviewed_fixture", "source_ids": [], "reviewed": False}
            if qid in ambiguous:
                f.update(status="ambiguous", source_ids=ambiguous[qid]["source_ids"], note=ambiguous[qid]["note"])
            elif qid in supported:
                f.update(status="supported", source_ids=supported[qid])
            counts[f["status"]] += 1
            features.append(f)
        rows.append({
            "id": b["id"], "title_en": b["title_en"], "title_ko": b.get("title_ko") or "",
            "aliases": ";".join(b.get("aliases", [])), "author": b["author"],
            "original_language": b["original_language"], "first_publication_year": b["first_publication_year"] or "",
            "series_id": b["series_id"] or "", "series_number": b["series_number"] or "",
            "openlibrary_work_id": b.get("openlibrary_work_id") or "", "demo_pool": "yes",
        })
        if sources:
            EVIDENCE.mkdir(parents=True, exist_ok=True)
            (EVIDENCE / f"{b['id']}.json").write_text(json.dumps({
                "book_id": b["id"],
                "_comment": "Excerpts are paraphrased evidence notes written while checking the source, not quotations.",
                "sources": [{"id": s["id"], "url": s["url"], "license": s["license"], "excerpt": s["notes"]} for s in sources],
            }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    total = sum(counts.values())
    notice = (f"Development fixture: 10 books. {counts['supported']} of {total} labels checked by an AI assistant against "
              "cited Wikipedia/Open Library pages; the rest are unchecked. No human review yet.")
    catalog = {"catalog_version": "fixture-2026-11-14b", "data_status": "development_fixture", "notice": notice,
               "books": books, "questions": bank, "features": features}
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    with TITLES.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=TITLE_FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(books)} books, {len(bank)} questions, {total} cells {counts}")
    print(f"Wrote {TITLES.relative_to(ROOT)} and {len(rows)} evidence files in data/evidence/")


if __name__ == "__main__":
    main()
