#!/usr/bin/env python3
"""Human review of catalog labels (build brief section 6).

  export  Write a CSV of cells to review:
            • every informative label for the demo books (--demo ids, or titles.csv demo_pool=yes)
            • --random N seeded random cells elsewhere (default 100)
            • the distinguishing cells for the --pairs most similar book pairs (default 10)
  apply   Read the CSV back. Fill `verdict` with ok | fix | unknown (and corrected_p_yes for fix).
            ok      → reviewed = true
            fix     → p_yes = corrected_p_yes, reviewed = true
            unknown → p_yes 0.5, status insufficient_evidence, no sources, reviewed = true

  python3 scripts/review.py export --catalog data/catalog.full.json --out data/work/review.csv
  python3 scripts/review.py apply  --catalog data/catalog.full.json --csv data/work/review.csv

A second LLM pass may flag disagreements, but it does not replace checking the sources.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from validate_catalog import ALLOWED_P, validate  # noqa: E402

COLUMNS = ["book_id", "book_title", "question_id", "question_text", "definition", "p_yes", "status",
           "source_ids", "source_urls", "note", "reason", "verdict", "corrected_p_yes", "reviewer", "comment"]


def demo_ids_from_titles() -> list[str]:
    p = ROOT / "data" / "curation" / "titles.csv"
    if not p.exists():
        return []
    with p.open(newline="", encoding="utf-8") as fh:
        return [r["id"] for r in csv.DictReader(fh) if (r.get("demo_pool") or "").strip().lower() in {"yes", "y", "1", "true"}]


def cmd_export(args: argparse.Namespace) -> int:
    cat = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
    books = {b["id"]: b for b in cat["books"]}
    qs = {q["id"]: q for q in cat["questions"]}
    feats = {(f["book_id"], f["question_id"]): f for f in cat["features"]}
    picked: dict[tuple[str, str], str] = {}

    demo = args.demo or demo_ids_from_titles()
    for bid in demo:
        if bid not in books:
            print(f"WARNING: demo book {bid} not in catalog")
        for (b, q), f in feats.items():
            if b == bid and f["p_yes"] != 0.5 and not f.get("reviewed"):
                picked.setdefault((b, q), "demo book")

    active = [q for q in qs if qs[q].get("active", True)]
    vec = {b: {q: feats.get((b, q), {}).get("p_yes", 0.5) for q in active} for b in books}
    pairs = []
    for a, b in itertools.combinations(books, 2):
        sep = [q for q in active if (vec[a][q] - 0.5) * (vec[b][q] - 0.5) < 0 and abs(vec[a][q] - vec[b][q]) >= 0.4]
        pairs.append((len(sep), a, b, sep))
    pairs.sort(key=lambda t: (t[0], t[1], t[2]))
    for _, a, b, sep in pairs[: args.pairs]:
        for q in sep:
            for bid in (a, b):
                if (bid, q) in feats and not feats[(bid, q)].get("reviewed"):
                    picked.setdefault((bid, q), f"separates {a} / {b}")

    rng = random.Random(args.seed)
    rest = sorted(k for k, f in feats.items() if k not in picked and not f.get("reviewed"))
    for k in rng.sample(rest, min(args.random, len(rest))):
        picked[k] = "random sample"

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        for (b, q), reason in sorted(picked.items()):
            f = feats[(b, q)]
            src = {s["id"]: s["url"] for s in books[b].get("sources", [])}
            w.writerow({
                "book_id": b, "book_title": books[b]["title_en"], "question_id": q,
                "question_text": qs[q]["text"], "definition": qs[q]["definition"], "p_yes": f["p_yes"],
                "status": f["status"], "source_ids": ";".join(f.get("source_ids", [])),
                "source_urls": " ".join(src.get(s, "?") for s in f.get("source_ids", [])),
                "note": f.get("note", ""), "reason": reason,
                "verdict": "", "corrected_p_yes": "", "reviewer": "", "comment": "",
            })
    print(f"wrote {len(picked)} cells to {out}")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    path = Path(args.catalog)
    cat = json.loads(path.read_text(encoding="utf-8"))
    feats = {(f["book_id"], f["question_id"]): f for f in cat["features"]}
    counts = {"ok": 0, "fix": 0, "unknown": 0, "blank": 0}
    errors = []
    with open(args.csv, newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh), start=2):
            key = (row["book_id"], row["question_id"])
            verdict = (row.get("verdict") or "").strip().lower()
            if not verdict:
                counts["blank"] += 1
                continue
            if not (row.get("reviewer") or "").strip():
                errors.append(f"line {i}: reviewer is required")
                continue
            f = feats.get(key)
            if f is None:
                errors.append(f"line {i}: {key} not in catalog")
                continue
            if verdict == "ok":
                f["reviewed"] = True
            elif verdict == "fix":
                try:
                    p = round(float(row["corrected_p_yes"]), 6)
                except ValueError:
                    p = -1
                if p not in ALLOWED_P:
                    errors.append(f"line {i}: corrected_p_yes must be one of {sorted(ALLOWED_P)}")
                    continue
                f["p_yes"] = p
                f["reviewed"] = True
                if f.get("status") == "insufficient_evidence" and p != 0.5:
                    f["status"] = "ambiguous"  # human judgement without a cited source
                elif p == 0.5 and f.get("status") == "supported":
                    f["status"] = "ambiguous"
            elif verdict == "unknown":
                f.update({"p_yes": 0.5, "status": "insufficient_evidence", "source_ids": [], "reviewed": True})
            else:
                errors.append(f"line {i}: verdict must be ok, fix or unknown")
                continue
            f["reviewed_by"] = row["reviewer"].strip()
            if row.get("comment"):
                f["review_comment"] = row["comment"].strip()
            counts[verdict] += 1
    for e in errors:
        print(f"ERROR: {e}")
    if errors and not args.partial:
        print("No changes written (fix the errors or pass --partial).")
        return 1
    rep = validate(cat)
    if rep.errors:
        for e in rep.errors:
            print(f"ERROR: {e}")
        print("No changes written: catalog would become invalid.")
        return 1
    path.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"applied {counts}. Re-run `prepare_catalog.py merge --runtime-out …` to rebuild the runtime file.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("export")
    ex.add_argument("--catalog", default=str(ROOT / "data" / "catalog.full.json"))
    ex.add_argument("--out", default=str(ROOT / "data" / "work" / "review.csv"))
    ex.add_argument("--demo", nargs="*")
    ex.add_argument("--random", type=int, default=100)
    ex.add_argument("--pairs", type=int, default=10)
    ex.add_argument("--seed", type=int, default=1)
    ap_ = sub.add_parser("apply")
    ap_.add_argument("--catalog", default=str(ROOT / "data" / "catalog.full.json"))
    ap_.add_argument("--csv", default=str(ROOT / "data" / "work" / "review.csv"))
    ap_.add_argument("--partial", action="store_true", help="apply valid rows even if some rows have errors")
    args = ap.parse_args()
    return {"export": cmd_export, "apply": cmd_apply}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
