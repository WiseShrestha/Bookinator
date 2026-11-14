#!/usr/bin/env python3
"""Structural check of a labelling response against its job file (stdlib only).

    python3 scripts/check_pilot_matrix.py data/pilot/job_books-00000-00004.json data/pilot/response_books-00000-00004.json

Checks the job's output rules: exact book and question IDs, allowed p_yes values, status/field
consistency, reviewed=false, quote length, and that every evidence_quote is an exact substring of
that book's supplied synopsis. This proves provenance and structure only. It does NOT prove a label
is a correct interpretation, and it is not the catalog pack's own scripts/validate_matrix.py.
"""
import json
import sys
from collections import Counter
from pathlib import Path

ALLOWED = {0.1, 0.3, 0.5, 0.7, 0.9}
FIELDS = {"question_id", "p_yes", "status", "source_id", "evidence_quote", "premise_safe", "reviewed"}
MAX_QUOTE = 220


def check(job: dict, resp: dict) -> tuple[list[str], dict]:
    errors: list[str] = []
    qids = [q["id"] for q in job["question_definitions"]]
    books = {b["id"]: b for b in job["books"]}
    stats: dict = {}
    got = [b.get("book_id") for b in resp.get("books", [])]
    if sorted(got) != sorted(books):
        errors.append(f"book ids differ from job: {got}")
    for rb in resp.get("books", []):
        bid = rb.get("book_id")
        src = books.get(bid)
        if src is None:
            continue
        text, sid = src["synopsis"]["text"], src["synopsis"]["source_id"]
        answers = rb.get("answers", [])
        if [a.get("question_id") for a in answers] != qids:
            errors.append(f"{bid}: question ids must be exactly the job's {len(qids)} ids, in order")
        values: Counter = Counter()
        for a in answers:
            where = f"{bid} {a.get('question_id')}"
            if set(a) != FIELDS:
                errors.append(f"{where}: fields must be exactly {sorted(FIELDS)}")
                continue
            p = a["p_yes"]
            values[p] += 1
            if p not in ALLOWED:
                errors.append(f"{where}: p_yes {p} not allowed")
            if a["reviewed"] is not False:
                errors.append(f"{where}: reviewed must be false for generated cells")
            if p == 0.5:
                if a["status"] not in ("ambiguous", "insufficient_evidence"):
                    errors.append(f"{where}: 0.5 needs status ambiguous or insufficient_evidence")
                if a["source_id"] is not None or a["evidence_quote"] is not None or a["premise_safe"] is not False:
                    errors.append(f"{where}: 0.5 needs null source/quote and premise_safe=false")
            else:
                if a["status"] != "supported" or a["premise_safe"] is not True:
                    errors.append(f"{where}: non-0.5 needs status supported and premise_safe=true")
                if a["source_id"] != sid:
                    errors.append(f"{where}: source_id must be the synopsis source {sid}")
                quote = a["evidence_quote"]
                if not isinstance(quote, str) or not quote.strip():
                    errors.append(f"{where}: missing evidence_quote")
                elif len(quote) >= MAX_QUOTE:
                    errors.append(f"{where}: quote is {len(quote)} chars (limit {MAX_QUOTE})")
                elif quote not in text:
                    errors.append(f"{where}: quote is not an exact substring of the synopsis")
        stats[bid] = {"title": src["title"], "supported": sum(n for v, n in values.items() if v != 0.5),
                      "unknown": values[0.5], "values": dict(sorted(values.items()))}
    return errors, stats


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    job = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    resp = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    errors, stats = check(job, resp)
    for bid, s in stats.items():
        print(f"info: {s['title']} ({bid}): {s['supported']} supported, {s['unknown']} unknown, values {s['values']}")
    for e in errors:
        print("ERROR:", e)
    print(f"{'OK' if not errors else 'FAILED'}: {len(errors)} error(s). Structure and quote provenance only; no cell is human-reviewed.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
