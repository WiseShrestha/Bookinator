#!/usr/bin/env python3
"""Labelling workflow for the CMU "Core" catalog pack (stdlib only, no API calls).

The pack (not committed here: ~75 MB of CC BY-SA plot text) lives outside the repo; pass --pack or
set THAT_BOOK_CORE_PACK. Default: ../packs/core next to this checkout.

  window   Print the premise window of each book in a 5-book job as numbered sentences.
  apply    Turn a compact label file (data/cmu/labels/<job>.txt) into the pack's matrix response
           JSON (data/cmu/responses/<job>.json). Quotes are cut from the numbered sentences, so
           they are exact substrings of the synopsis by construction.
  validate Run the pack's own validate_matrix.validate() over every response.

Compact label file, one block per book:

    @ cmu:enwiki:123  Title (free text, ignored)
    q01 .9 3 six-year-old      # question, p_yes, sentence number, optional anchor phrase
    q14 ?                      # 0.5 with status "ambiguous" (default for unlisted cells is
                               # 0.5 / insufficient_evidence)

PREMISE WINDOW: labels for jobs after the first are made from the opening sentences only (about
WINDOW_CHARS characters). The pack's prompt says only premise-level facts may influence the game,
and the opening of a plot summary is where the premise is. Nothing outside the window is ever
treated as evidence for No. Job books-00000-00004 was labelled from the full text.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LABELS = ROOT / "data" / "cmu" / "labels"
RESPONSES = ROOT / "data" / "cmu" / "responses"
WINDOW_CHARS = 1500
MAX_QUOTE = 215
ALLOWED = {0.1, 0.3, 0.7, 0.9}
SENT_END = re.compile(r"(?<=[.!?])[\"')\]]*\s+")


def pack_dir(arg: str | None) -> Path:
    p = Path(arg or os.environ.get("THAT_BOOK_CORE_PACK") or ROOT.parent / "packs" / "core")
    if not (p / "questions_64.json").exists():
        sys.exit(f"Core pack not found at {p} (pass --pack or set THAT_BOOK_CORE_PACK)")
    return p


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sentences(text: str) -> list[str]:
    """Split into sentences; each one is an exact substring of text."""
    out, start = [], 0
    for m in SENT_END.finditer(text):
        seg = text[start : m.start() + len(m.group().rstrip())].strip()
        if seg:
            out.append(seg)
        start = m.end()
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return out


def window(text: str) -> list[str]:
    out, n = [], 0
    for s in sentences(text):
        out.append(s)
        n += len(s)
        if n >= WINDOW_CHARS:
            break
    return out


def job_id(start: int, count: int) -> str:
    return f"books-{start:05d}-{start + count - 1:05d}"


def cmd_window(args: argparse.Namespace) -> int:
    rows = read_jsonl(pack_dir(args.pack) / "data" / args.catalog)
    for i in range(args.start, min(args.end, len(rows))):
        r = rows[i]
        text = r["synopsis"]["text"]
        win = window(text)
        shown = sum(len(s) for s in win)
        print(f"\n@ {r['id']}  #{i} {r['title']} — {', '.join(r['authors'])} [{shown}/{len(text)} chars]")
        for k, s in enumerate(win, 1):
            print(f"[{k}] {s}")
    return 0


def cut_quote(sentence: str, anchor: str | None, where: str) -> str:
    if anchor and anchor not in sentence:
        raise ValueError(f"{where}: anchor {anchor!r} is not in the sentence")
    if len(sentence) <= MAX_QUOTE:
        return sentence
    if not anchor:
        raise ValueError(f"{where}: sentence is {len(sentence)} chars; give an anchor phrase")
    if len(anchor) > MAX_QUOTE:
        raise ValueError(f"{where}: anchor too long")
    pos = sentence.index(anchor)
    spare = MAX_QUOTE - len(anchor)
    lo = max(0, pos - spare // 2)
    hi = min(len(sentence), lo + MAX_QUOTE)
    lo = max(0, hi - MAX_QUOTE)
    # snap to word boundaries without cutting into the anchor
    while lo > 0 and lo < pos and not sentence[lo - 1].isspace():
        lo += 1
    while hi < len(sentence) and hi > pos + len(anchor) and not sentence[hi].isspace():
        hi -= 1
    return sentence[lo:hi].strip()


def parse_labels(path: Path) -> dict[str, dict[str, tuple]]:
    books: dict[str, dict[str, tuple]] = {}
    cur: dict[str, tuple] | None = None
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split("  #", 1)[0].rstrip() if not raw.startswith("@") else raw.rstrip()
        if not line.strip():
            continue
        where = f"{path.name}:{n}"
        if line.startswith("@"):
            bid = line[1:].split()[0]
            if bid in books:
                raise ValueError(f"{where}: duplicate book {bid}")
            cur = books[bid] = {}
            continue
        if cur is None:
            raise ValueError(f"{where}: label before any '@ book' line")
        parts = line.split(None, 3)
        qid = parts[0]
        if not re.fullmatch(r"q(0[1-9]|[1-5]\d|6[0-4])", qid) or qid in cur:
            raise ValueError(f"{where}: bad or duplicate question id {qid}")
        if len(parts) == 2 and parts[1] == "?":
            cur[qid] = ("ambiguous",)
            continue
        if len(parts) < 3:
            raise ValueError(f"{where}: expected 'qNN p sentence [anchor]'")
        p = float(parts[1])
        if p not in ALLOWED:
            raise ValueError(f"{where}: p_yes {parts[1]} not allowed")
        cur[qid] = ("supported", p, int(parts[2]), parts[3].strip() if len(parts) > 3 else None, where)
    return books


def build_response(job_rows: list[dict], labels: dict[str, dict[str, tuple]], qids: list[str], full_text: bool) -> dict:
    if set(labels) != {r["id"] for r in job_rows}:
        raise ValueError(f"label file books {sorted(labels)} do not match the job's books")
    out = []
    for r in job_rows:
        text, sid = r["synopsis"]["text"], r["synopsis"]["source_id"]
        sents = sentences(text) if full_text else window(text)
        answers = []
        for qid in qids:
            cell = labels[r["id"]].get(qid)
            if cell is None or cell[0] == "ambiguous":
                answers.append({"question_id": qid, "p_yes": 0.5,
                                "status": "ambiguous" if cell else "insufficient_evidence",
                                "source_id": None, "evidence_quote": None, "premise_safe": False, "reviewed": False})
                continue
            _, p, k, anchor, where = cell
            if not 1 <= k <= len(sents):
                raise ValueError(f"{where}: sentence {k} is outside the window (1..{len(sents)})")
            quote = cut_quote(sents[k - 1], anchor, where)
            assert quote and quote in text and len(quote) <= 220
            answers.append({"question_id": qid, "p_yes": p, "status": "supported", "source_id": sid,
                            "evidence_quote": quote, "premise_safe": True, "reviewed": False})
        out.append({"book_id": r["id"], "answers": answers})
    return {"books": out}


def cmd_apply(args: argparse.Namespace) -> int:
    pack = pack_dir(args.pack)
    rows = read_jsonl(pack / "data" / args.catalog)
    qids = [q["id"] for q in json.loads((pack / "questions_64.json").read_text(encoding="utf-8"))]
    RESPONSES.mkdir(parents=True, exist_ok=True)
    done = 0
    for path in sorted(LABELS.glob("books-*.txt")):
        start, last = (int(x) for x in path.stem.split("-")[1:])
        job_rows = rows[start : last + 1]
        try:
            resp = build_response(job_rows, parse_labels(path), qids, full_text=False)
        except ValueError as e:
            print("ERROR:", e)
            return 1
        (RESPONSES / f"{path.stem}.json").write_text(
            json.dumps(resp, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        done += 1
    print(f"wrote {done} response file(s) to {RESPONSES.relative_to(ROOT)}")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    pack = pack_dir(args.pack)
    sys.path.insert(0, str(pack / "scripts"))
    from validate_matrix import validate  # the pack's own validator

    catalog = {r["id"]: r for r in read_jsonl(pack / "data" / args.catalog)}
    questions = json.loads((pack / "questions_64.json").read_text(encoding="utf-8"))
    files = sorted(RESPONSES.glob("books-*.json"))
    books = cells = bad = 0
    seen: set[str] = set()
    for f in files:
        rep = validate(json.loads(f.read_text(encoding="utf-8")), catalog, questions)
        dup = seen & set(rep["supported_cells_by_book"])
        seen |= set(rep["supported_cells_by_book"])
        if not rep["valid"] or dup:
            bad += 1
            for e in rep["errors"][:10] + [f"book in two responses: {d}" for d in dup]:
                print(f"ERROR {f.name}: {e}")
        books += rep["books"]
        cells += sum(rep["supported_cells_by_book"].values())
    print(f"{'OK' if not bad else 'FAILED'}: {len(files)} response file(s), {books} books, {cells} supported cells, "
          f"{bad} invalid file(s). Structural and exact-quote validation only (pack validate_matrix.py); "
          "no factual, spoiler or accuracy validation.")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack")
    ap.add_argument("--catalog", default="priority_500.jsonl", help="file inside <pack>/data (the 100/300/500 sets are nested)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("window")
    w.add_argument("start", type=int)
    w.add_argument("end", type=int)
    sub.add_parser("apply")
    sub.add_parser("validate")
    args = ap.parse_args()
    return {"window": cmd_window, "apply": cmd_apply, "validate": cmd_validate}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
