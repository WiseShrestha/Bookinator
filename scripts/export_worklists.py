#!/usr/bin/env python3
"""Export work lists for a second AI labeller (e.g. ChatGPT). See docs/GPT_LABELLING_BRIEF.md.

    python3 scripts/export_worklists.py

Reads data/cmu/coverage_report.json, data/cmu/question_bank_core.json and data/ai_recall/*.txt and writes, into
data/ai_recall/worklists/:
  questions.csv            code (as used in the label files), question, exact definition
  new_books.csv            in-scope books no labeller has answered yet, in priority order
  second_opinion.csv       books already answered by Claude (labels.txt), for an independent second pass
(All non-playable books currently fail the same way: the engine never becomes confident within 18 questions,
because too few of their answers are firm. More firm, distinguishing answers is the fix.)
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "ai_recall" / "worklists"


def wiki(bid: str) -> str:
    m = re.fullmatch(r"cmu:enwiki:(\d+)", bid)
    return f"https://en.wikipedia.org/?curid={m.group(1)}" if m else ""


def labelled_by(path: Path) -> set[str]:
    ids = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            bid = line.split("|", 1)[0].strip()
            ids.add(bid if ":" in bid else "cmu:enwiki:" + bid)
    return ids


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report = json.loads((ROOT / "data" / "cmu" / "coverage_report.json").read_text(encoding="utf-8"))
    rows = [r for r in report["records"] if not r["id"].startswith("series:")]
    bank = json.loads((ROOT / "data" / "cmu" / "question_bank_core.json").read_text(encoding="utf-8"))["questions"]
    claude = labelled_by(ROOT / "data" / "ai_recall" / "labels.txt")
    anyone = set().union(*(labelled_by(f) for f in (ROOT / "data" / "ai_recall").glob("*.txt")))

    with (OUT / "questions.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "question", "definition", "note"])
        for q in bank:
            code = q["id"][1:] if q["id"].startswith("q") else q["id"]
            note = "inactive: do not answer" if q["id"] == "q56" else ""
            w.writerow([code, q["text"], q["definition"], note])

    in_scope = [r for r in rows if not (r["reason"] or "").startswith("form hold")]
    with (OUT / "new_books.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["book_id", "title", "author", "priority_rank", "series_target", "answers_known_of_116", "playable_now", "wikipedia"])
        for r in in_scope:
            if r["id"] not in anyone:
                w.writerow([r["id"], r["title"], ", ".join(r["authors"]), r["rank"], r.get("series", ""),
                            r["supported_cells"], "yes" if r["playable"] else "no", wiki(r["id"])])

    with (OUT / "second_opinion.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["book_id", "title", "author", "priority_rank", "wikipedia"])
        for r in in_scope:
            if r["id"] in claude:
                w.writerow([r["id"], r["title"], ", ".join(r["authors"]), r["rank"], wiki(r["id"])])

    for f in sorted(OUT.glob("*.csv")):
        print(f"{f.relative_to(ROOT)}: {sum(1 for _ in f.open(encoding='utf-8')) - 1} rows")


if __name__ == "__main__":
    main()
