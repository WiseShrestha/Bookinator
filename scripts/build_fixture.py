#!/usr/bin/env python3
"""Build the 10-book DEVELOPMENT FIXTURE catalog from the question bank + fixture labels.

    python3 scripts/build_fixture.py

Writes src/data/fixture.catalog.json. Every feature is status "unreviewed_fixture",
reviewed=false and has no sources: this file must never be presented as verified data.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "data" / "question_bank.json"
LABELS = ROOT / "data" / "curation" / "fixture_labels.json"
OUT = ROOT / "src" / "data" / "fixture.catalog.json"

NOTICE = (
    "Development fixture: 10 books labeled from general knowledge by an AI assistant. "
    "Not source-checked or human-reviewed. Replace with a reviewed catalog before any accuracy claim."
)


def main() -> None:
    bank = json.loads(BANK.read_text(encoding="utf-8"))["questions"]
    spec = json.loads(LABELS.read_text(encoding="utf-8"))["books"]
    books, features = [], []
    for b in spec:
        books.append(
            {
                "id": b["id"],
                "title_en": b["title_en"],
                "title_ko": None,  # verify before filling; never invent translations
                "aliases": [],
                "author": b["author"],
                "original_language": b["original_language"],
                "first_publication_year": b["first_publication_year"],
                "series_id": b["series_id"],
                "series_number": b["series_number"],
                "openlibrary_work_id": None,  # verify before filling
                "editions": [],
                "sources": [],
            }
        )
        for qid in sorted(b["labels"]):
            features.append(
                {
                    "book_id": b["id"],
                    "question_id": qid,
                    "p_yes": b["labels"][qid],
                    "status": "unreviewed_fixture",
                    "source_ids": [],
                    "reviewed": False,
                }
            )
    catalog = {
        "catalog_version": "fixture-2026-11-14",
        "data_status": "development_fixture",
        "notice": NOTICE,
        "books": books,
        "questions": bank,
        "features": features,
    }
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(books)} books, {len(bank)} questions, {len(features)} labeled cells")


if __name__ == "__main__":
    main()
