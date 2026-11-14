#!/usr/bin/env python3
"""Build the runtime catalog for the CMU "Core" pack from validated matrix responses.

    python3 scripts/build_cmu_catalog.py --limit 100      # consider the first 100 priority records

Reads   <pack>/data/priority_500.jsonl, <pack>/questions_64.json, data/cmu/responses/*.json
Writes  src/data/cmu.catalog.json     compact runtime catalog: PLAYABLE books only, no plot text, no quotes
        data/cmu/coverage_report.json every imported record with its status and the reason

Four different numbers, never to be confused:
  imported   source records considered (evidence only)
  labelled   records with a validated question matrix (machine-made, exact-quote checked)
  reviewed   records with at least one human-reviewed cell (0 until someone reviews)
  playable   records the engine can tell apart from every other playable book (the gate below)

Playability gate, applied in priority order (greedy):
  1. at least --min-supported supported cells on active questions, and
  2. against every already-playable book, in BOTH directions: if a reader answers Yes/No exactly as
     book A's supported labels say (one question per correlation group, as the engine asks them),
     A's likelihood beats B's by at least the engine's guess ratio (4x).
A book that fails is still imported and labelled; it is just not offered as a game target.
The gate is a necessary condition measured on the labels themselves, not a measured success rate:
run the simulator on the output, and playtest with people, before claiming anything more.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cmu_labels import RESPONSES, ROOT, pack_dir, read_jsonl  # noqa: E402
from merge_research import pack_root as research_root  # noqa: E402

LANG = {"English": "en", "French": "fr", "Spanish": "es", "Russian": "ru", "German": "de", "Japanese": "ja",
        "Korean": "ko", "Italian": "it", "Swedish": "sv", "Portuguese": "pt", "Chinese": "zh", "Norwegian": "no",
        "Danish": "da", "Dutch": "nl", "Czech": "cs", "Polish": "pl", "Hebrew": "he", "Greek": "el"}

# Mirrors DEFAULT_CHANNEL / guessMinRatio in src/engine/config.ts (tests/test_cmu.py checks they agree).
CH_YES = {"yes": 0.55, "no": 0.05}
CH_NO = {"yes": 0.05, "no": 0.55}
GUESS_RATIO = 4.0
UNDETERMINED = "und"  # ISO 639-2 "undetermined": the pack deliberately leaves original language unresolved

CREDITS = "Book evidence: CMU Book Summary Corpus (Bamman & Smith, 2013) and current Wikipedia articles / Wikipedia contributors, CC BY-SA; metadata: goodbooks-10k (Zygmunt Zając, 2017), CC BY-SA 4.0; Wikidata, CC0; Nobel Prize API. Details: data/cmu/ATTRIBUTION.md, data/research/ATTRIBUTION.md"


def lik(x: float, answer: str) -> float:
    return x * CH_YES[answer] + (1 - x) * CH_NO[answer]


def advantage(a: dict[str, float], b: dict[str, float], group: dict[str, str]) -> float:
    """log likelihood ratio in favour of A when answers follow A's supported labels, best question per group."""
    best: dict[str, float] = {}
    for qid, x in a.items():
        ans = "yes" if x > 0.5 else "no"
        llr = math.log(lik(x, ans) / lik(b.get(qid, 0.5), ans))
        g = group[qid]
        best[g] = max(best.get(g, -math.inf), llr)
    return sum(best.values())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack")
    ap.add_argument("--catalog", default="priority_500.jsonl")
    ap.add_argument("--limit", type=int, required=True, help="number of priority records to import (5, 100, 500 ...)")
    ap.add_argument("--labels", choices=["cmu", "research"], default="research",
                    help="cmu: this project's own responses only; research: data/research/merged_labels.json "
                         "(researched 500-book matrix merged with ours, see scripts/merge_research.py)")
    ap.add_argument("--research")
    ap.add_argument("--gate", choices=["llr", "none"], default="llr",
                    help="llr: pairwise likelihood-ratio gate here; none: emit every candidate that passes the basic "
                         "checks and let scripts/gate_catalog.ts prune it with the real engine")
    ap.add_argument("--min-supported", type=int, default=6)
    ap.add_argument("--version")
    ap.add_argument("--out", default="src/data/cmu.catalog.json")
    ap.add_argument("--report", default="data/cmu/coverage_report.json")
    args = ap.parse_args()

    pack = pack_dir(args.pack)
    quarantine: dict[str, str] = {}
    if args.labels == "research":
        rpack = research_root(args.research)
        records = read_jsonl(rpack / "data" / "priority_500_researched.jsonl")[: args.limit]
        quarantine = {q["book_id"]: q["form_reason"] for q in
                      json.loads((rpack / "reports" / "form_quarantine.json").read_text(encoding="utf-8"))}
    else:
        records = read_jsonl(pack / "data" / args.catalog)[: args.limit]
    pack_q = json.loads((pack / "questions_64.json").read_text(encoding="utf-8"))
    bank = {q["id"]: q for q in json.loads((ROOT / "data" / "question_bank.json").read_text(encoding="utf-8"))["questions"]}
    if [q["id"] for q in pack_q] != list(bank):
        sys.exit("question ids differ between the pack and data/question_bank.json")

    questions = []
    for q in pack_q:
        b = bank[q["id"]]
        row = {"id": q["id"], "category": b.get("category", q["category"]), "group": b["group"],
               "recallability": q["recallability"], "adaptation_sensitive": b["adaptation_sensitive"],
               "text": q["text"], "definition": q["definition"]}
        if b.get("active") is False:
            row["active"] = False
            row["inactive_reason"] = b.get("inactive_reason", "inactive in the app's question bank")
        questions.append(row)
    active = {q["id"] for q in questions if q.get("active", True)}
    group = {q["id"]: q["group"] for q in questions}

    cells: dict[str, list[dict]] = {}
    label_files = ([ROOT / "data" / "research" / "merged_labels.json"] if args.labels == "research"
                   else sorted(RESPONSES.glob("books-*.json")))
    for f in label_files:
        for b in json.loads(f.read_text(encoding="utf-8"))["books"]:
            if b["book_id"] in cells:
                sys.exit(f"book {b['book_id']} appears in two responses")
            cells[b["book_id"]] = b["answers"]

    playable: list[dict] = []
    vec: dict[str, dict[str, float]] = {}
    rows = []
    need = math.log(GUESS_RATIO) - 1e-9
    for rank, r in enumerate(records):
        bid = r["id"]
        row = {"rank": rank, "id": bid, "title": r["title"], "authors": r["authors"],
               "labelled": bid in cells, "supported_cells": 0, "reviewed_cells": 0, "playable": False, "reason": None}
        rows.append(row)
        if bid not in cells:
            row["reason"] = "no question matrix yet (evidence only)"
            continue
        known = {c["question_id"]: c["p_yes"] for c in cells[bid] if c["p_yes"] != 0.5 and c["question_id"] in active}
        row["supported_cells"] = len(known)
        row["reviewed_cells"] = sum(1 for c in cells[bid] if c["reviewed"])
        if not r["authors"]:
            row["reason"] = "no author in the source record"
            continue
        if bid in quarantine:
            row["reason"] = f"form hold: {quarantine[bid]}"
            continue
        if len(known) < args.min_supported:
            row["reason"] = f"only {len(known)} supported cells (minimum {args.min_supported})"
            continue
        clash = None if args.gate == "none" else next((p for p in playable
                      if advantage(known, vec[p["id"]], group) < need or advantage(vec[p["id"]], known, group) < need), None)
        if clash:
            row["reason"] = f"labels cannot separate it from the higher-priority book {clash['title']!r} ({clash['id']})"
            continue
        row["playable"] = True
        vec[bid] = known
        playable.append(r)

    counts = {
        "imported_source_records": len(records),
        "labelled_with_validated_matrix": sum(r["labelled"] for r in rows),
        "records_with_human_reviewed_cells": sum(1 for r in rows if r["reviewed_cells"]),
        "playable_game_targets": len(playable),
    }
    supported_total = sum(r["supported_cells"] for r in rows)
    version = args.version or f"cmu-priority{len(records)}-v1"
    made_from = ("from Wikipedia, Wikidata and other cited sources" if args.labels == "research"
                 else "from the opening of a Wikipedia-derived plot summary")
    notice = (f"Machine-labelled, unreviewed data. {counts['imported_source_records']} source records imported; "
              f"{counts['labelled_with_validated_matrix']} have a question matrix made by AI assistants {made_from}; "
              f"the game can currently tell apart {counts['playable_game_targets']} of them. No human has reviewed any label.")
    catalog = {
        "catalog_version": version,
        "data_status": "machine_labelled_unreviewed",
        "notice": notice,
        "credits": CREDITS,
        "coverage": counts,
        "books": [{
            "id": r["id"], "title_en": r["title"], "title_ko": r["title_ko"], "aliases": r["aliases"],
            "author": ", ".join(r["authors"]),
            "original_language": r["original_language"] or LANG.get(str(r.get("original_language_claim")), UNDETERMINED),
            "first_publication_year": r["first_publication_year"], "series_id": None, "series_number": None,
            "openlibrary_work_id": None, "editions": [],
            "sources": [{"id": s["id"], "url": s.get("article_url") or s["url"], "license": s["license"],
                         "attribution": s.get("attribution", "")} for s in r["sources"]
                        if s["id"] in {c["source_id"] for c in cells[r["id"]] if c["p_yes"] != 0.5}],
        } for r in playable],
        "questions": questions,
        "features": [{"book_id": r["id"], "question_id": c["question_id"], "p_yes": c["p_yes"], "status": "supported",
                      "source_ids": [c["source_id"]], "reviewed": c["reviewed"]}
                     for r in playable for c in cells[r["id"]] if c["p_yes"] != 0.5],
    }
    out = ROOT / args.out
    out.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    reasons = Counter((r["reason"] or "playable").split(" (cmu:")[0].split(" 'the higher")[0] for r in rows)
    grouped = Counter("playable" if r["playable"] else "not separable from a higher-priority book" if r["reason"].startswith("labels cannot")
                      else "form hold (not a novel)" if r["reason"].startswith("form hold")
                      else "too few supported cells" if r["reason"].startswith("only") else r["reason"] for r in rows)
    del reasons
    report = {
        "catalog_version": version, "source": f"{args.catalog} (first {len(records)} records)",
        "counts": counts, "supported_cells_total": supported_total,
        "supported_cells_per_labelled_book_mean": round(supported_total / max(1, counts["labelled_with_validated_matrix"]), 2),
        "books_meeting_handoff_heuristic_12_supported": sum(1 for r in rows if r["supported_cells"] >= 12),
        "gate": {"min_supported": args.min_supported, "pairwise_likelihood_ratio": GUESS_RATIO},
        "status_breakdown": dict(grouped),
        "scope": "Counts of records and labels. Not a measure of factual correctness or of game success.",
        "records": rows,
    }
    (ROOT / args.report).write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({**counts, "status_breakdown": dict(grouped), "runtime_bytes": out.stat().st_size}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
