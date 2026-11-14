#!/usr/bin/env python3
"""Merge the researched 500-book matrix with this project's own CMU labels, by stable book ID.

    python3 scripts/merge_research.py [--research <continuation pack root>]

Inputs (the research pack is not committed: ~130 MB of cached source text; default path
../packs/research/That_Book_Continuation_Preparation, or THAT_BOOK_RESEARCH_PACK):
  <pack>/data/core500_researched_labels.json      preferred final matrix (books / book_id / answers)
  <pack>/data/priority_500_researched.jsonl       matching catalog + evidence registry
  <pack>/reports/withheld_legacy_cells.json       cells the research pass deliberately withheld
  data/cmu/responses/*.json                       this project's labels (CMU synopsis quotes)

Policy, per cell (nothing here is human-reviewed, so there is no reviewed work to protect):
  * researched cell known (≠0.5)               -> keep it (it carries the documented corrections)
  * researched 0.5, ours known                 -> add ours, unless the research pass withheld that
                                                  exact cell or marked it ambiguous
  * both known, opposite directions            -> 0.5 "ambiguous" (listed in the merge report)
  * both known, same direction                 -> the more extreme value, with that pass's own quote
                                                  (two independent passes agree, and one judged the
                                                  evidence explicit: 0.9/0.1 rather than 0.7/0.3)
Then every merged book is re-validated with the pack's own validate_evidence_matrix.validate():
registered source, exact quote, field rules, 64 cells. Validation is structural, not factual.

Writes data/research/merged_labels.json and data/research/merge_report.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "research"
ERA = ["q17", "q18", "q19", "q20"]  # mutually exclusive majority-setting bins

# Calibration. The labelling prompt defines 0.9/0.1 as STRONG evidence and 0.7/0.3 as QUALIFIED
# evidence, but the research pass stored almost every cell as 0.7/0.3, including facts read from an
# explicit field or a complete official list. For exactly these recorded methods
# (data/research_label_methods.json) the evidence is explicit, so the strength becomes 0.9/0.1.
# Direction never changes; AI interpretations, derivations, genre/geography mappings and
# year-disagreement cases keep 0.7/0.3.
EXPLICIT_METHODS = {
    "explicit_work_language_field",
    "explicit_work_language_statement",
    "closed_complete_official_laureate_list_lookup",
    "explicit_named_series_field",
    "explicit_series_position",
    "current_work_publication_date_corroborates_original_year",
    "work_publication_statement_corroborates_original_year",
    "publisher_original_hardcover_date_corroborates_original_year",
}


def pack_root(arg: str | None) -> Path:
    p = Path(arg or os.environ.get("THAT_BOOK_RESEARCH_PACK")
             or ROOT.parent / "packs" / "research" / "That_Book_Continuation_Preparation")
    if not (p / "data" / "core500_researched_labels.json").exists():
        sys.exit(f"research pack not found at {p} (pass --research or set THAT_BOOK_RESEARCH_PACK)")
    return p


def unknown(qid: str, status: str) -> dict:
    return {"question_id": qid, "p_yes": 0.5, "status": status, "source_id": None,
            "evidence_quote": None, "premise_safe": False, "reviewed": False}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--research")
    args = ap.parse_args()
    pack = pack_root(args.research)
    sys.path.insert(0, str(pack / "scripts"))
    from validate_evidence_matrix import validate  # the research pack's own validator

    research = json.loads((pack / "data" / "core500_researched_labels.json").read_text(encoding="utf-8"))["books"]
    catalog = {r["id"]: r for r in map(json.loads, (pack / "data" / "priority_500_researched.jsonl")
                                       .read_text(encoding="utf-8").splitlines())}
    questions = json.loads((pack / "questions_64.json").read_text(encoding="utf-8"))
    withheld = {(w["book_id"], w["cell"]["question_id"])
                for w in json.loads((pack / "reports" / "withheld_legacy_cells.json").read_text(encoding="utf-8"))}

    ours: dict[str, dict[str, dict]] = {}
    for f in sorted((ROOT / "data" / "cmu" / "responses").glob("books-*.json")):
        for b in json.loads(f.read_text(encoding="utf-8"))["books"]:
            ours[b["book_id"]] = {a["question_id"]: a for a in b["answers"]}

    methods = json.loads((pack / "data" / "research_label_methods.json").read_text(encoding="utf-8"))
    recalibrated = 0
    for row in research:
        for c in row["answers"]:
            meta = methods.get(row["book_id"], {}).get(c["question_id"])
            if c["p_yes"] in (0.7, 0.3) and isinstance(meta, dict) and meta.get("method") in EXPLICIT_METHODS:
                c["p_yes"] = 0.9 if c["p_yes"] == 0.7 else 0.1
                recalibrated += 1

    added, conflicts, skipped, strengthened = [], [], [], []
    merged = []
    for row in research:
        bid = row["book_id"]
        mine = ours.get(bid, {})
        cells = []
        for r in row["answers"]:
            q = r["question_id"]
            m = mine.get(q)
            if m is None or m["p_yes"] == 0.5:
                cells.append(r)
            elif r["p_yes"] == 0.5:
                if (bid, q) in withheld or r["status"] == "ambiguous":
                    skipped.append({"book_id": bid, "question_id": q, "ours": m["p_yes"],
                                    "reason": "withheld" if (bid, q) in withheld else "research marked ambiguous"})
                    cells.append(r)
                else:
                    cells.append(m)
                    added.append({"book_id": bid, "question_id": q, "p_yes": m["p_yes"]})
            elif (m["p_yes"] - 0.5) * (r["p_yes"] - 0.5) < 0:
                cells.append(unknown(q, "ambiguous"))
                conflicts.append({"book_id": bid, "title": catalog[bid]["title"], "question_id": q,
                                  "ours": {"p_yes": m["p_yes"], "quote": m["evidence_quote"]},
                                  "research": {"p_yes": r["p_yes"], "source_id": r["source_id"], "quote": r["evidence_quote"]},
                                  "resolution": "set to 0.5 ambiguous until a person decides"})
            elif abs(m["p_yes"] - 0.5) > abs(r["p_yes"] - 0.5):
                cells.append(m)
                strengthened.append({"book_id": bid, "question_id": q, "research": r["p_yes"], "ours": m["p_yes"]})
            else:
                cells.append(r)
        # A merge must not create two "majority setting era" Yes labels for one book.
        yes_eras = [c["question_id"] for c in cells if c["question_id"] in ERA and c["p_yes"] > 0.5]
        if len(yes_eras) > 1:
            for c in cells:
                if c["question_id"] in yes_eras and mine.get(c["question_id"]) is c:
                    cells[cells.index(c)] = unknown(c["question_id"], "ambiguous")
                    conflicts.append({"book_id": bid, "question_id": c["question_id"],
                                      "resolution": "ours dropped: second majority-era Yes"})
        merged.append({"book_id": bid, "answers": cells})

    report = validate({"books": merged}, catalog, questions)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "merged_labels.json").write_text(json.dumps({"books": merged}, ensure_ascii=False, separators=(",", ":")) + "\n",
                                            encoding="utf-8")
    summary = {
        "inputs": {"research_books": len(research), "our_labelled_books": len(ours)},
        "explicit_method_cells_recalibrated_to_0.9_or_0.1": recalibrated,
        "cells_added_from_ours": len(added), "conflicts_set_ambiguous": len(conflicts),
        "ours_not_added": len(skipped),
        "agreeing_cells_strengthened_from_ours": len(strengthened),
        "validation": {k: report[k] for k in ("valid", "books", "non_unknown_cells", "count_gate_12", "scope")},
        "validation_errors": report["errors"][:50],
        "conflicts": conflicts, "strengthened": strengthened, "not_added": skipped, "added": added,
    }
    (OUT / "merge_report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("inputs", "explicit_method_cells_recalibrated_to_0.9_or_0.1", "cells_added_from_ours", "conflicts_set_ambiguous",
                                               "ours_not_added", "agreeing_cells_strengthened_from_ours", "validation")}, indent=1))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
