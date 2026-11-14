#!/usr/bin/env python3
"""Evidence-based catalog preparation: titles + evidence → LLM labels → validated catalog.

Pipeline (build brief section 6):
  curated titles (data/curation/titles.csv)
  → source evidence (data/evidence/<book_id>.json)
  → LLM attribute labeling in batches of 5–10 books, checkpointed, bounded retries, spend cap
  → schema validation of every batch
  → merge into data/catalog.full.json (with evidence notes) + compact runtime JSON
  → human review (scripts/review.py) → activate in src/data/index.ts

Subcommands
  check   Check titles.csv and evidence files are complete and well-formed.
  label   Generate labels. Use --dry-run first: prints prompts + a cost estimate, no API call.
  merge   Build the full and runtime catalogs from checkpoints, then validate.

Examples
  python3 scripts/prepare_catalog.py check
  python3 scripts/prepare_catalog.py label --dry-run --batch-size 8
  ANTHROPIC_API_KEY=... python3 scripts/prepare_catalog.py label --provider anthropic \\
      --model <model-id> --input-rate <USD per 1M input tokens> --output-rate <USD per 1M output tokens> --cap 10
  python3 scripts/prepare_catalog.py merge --runtime-out src/data/catalog.json

Prices are NOT hard-coded: pass your provider's current rates. Without rates no paid call is made.
Stdlib only. API keys are read from the environment and never written to disk.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from validate_catalog import ALLOWED_P, validate  # noqa: E402

TITLES = ROOT / "data" / "curation" / "titles.csv"
EVIDENCE = ROOT / "data" / "evidence"
BANK = ROOT / "data" / "question_bank.json"
PROMPT = ROOT / "scripts" / "prompts" / "matrix_prompt.txt"
WORK = ROOT / "data" / "work"
LABELS = WORK / "labels"
SPEND = WORK / "spend.json"
FULL_OUT = ROOT / "data" / "catalog.full.json"

TITLE_FIELDS = [
    "id", "title_en", "title_ko", "aliases", "author", "original_language", "first_publication_year",
    "series_id", "series_number", "openlibrary_work_id", "demo_pool",
]
LLM_STATUSES = {"supported", "ambiguous", "insufficient_evidence"}
CHARS_PER_TOKEN = 3.5  # conservative planning estimate for English-heavy prompts
MAX_RETRIES = 3


# ---------------------------------------------------------------------------- inputs

def load_titles(path: Path | None = None) -> list[dict]:
    path = path or TITLES
    if not path.exists():
        sys.exit(f"Missing {path}. Copy data/curation/titles.example.csv and fill it in.")
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    missing = [f for f in TITLE_FIELDS if rows and f not in rows[0]]
    if missing:
        sys.exit(f"{path} is missing columns: {missing}")
    return rows


def load_evidence(book_id: str) -> dict | None:
    p = EVIDENCE / f"{book_id}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def load_bank() -> list[dict]:
    return json.loads(BANK.read_text(encoding="utf-8"))["questions"]


def none_if_blank(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def book_record(row: dict, evidence: dict | None) -> dict:
    year = none_if_blank(row["first_publication_year"])
    sn = none_if_blank(row["series_number"])
    return {
        "id": row["id"].strip(),
        "title_en": row["title_en"].strip(),
        "title_ko": none_if_blank(row["title_ko"]),
        "aliases": [a.strip() for a in (row["aliases"] or "").split(";") if a.strip()],
        "author": row["author"].strip(),
        "original_language": row["original_language"].strip(),
        "first_publication_year": int(year) if year else None,
        "series_id": none_if_blank(row["series_id"]),
        "series_number": float(sn) if sn and "." in sn else (int(sn) if sn else None),
        "openlibrary_work_id": none_if_blank(row["openlibrary_work_id"]),
        "editions": [],
        "sources": [
            {"id": s["id"], "url": s["url"], "license": s["license"]} for s in (evidence or {}).get("sources", [])
        ],
    }


# ---------------------------------------------------------------------------- check

def cmd_check(_: argparse.Namespace) -> int:
    rows = load_titles()
    problems = 0
    ids = [r["id"].strip() for r in rows]
    for dup in {i for i in ids if ids.count(i) > 1}:
        print(f"ERROR: duplicate id {dup}")
        problems += 1
    for r in rows:
        bid = r["id"].strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", bid):
            print(f"ERROR: {bid!r}: ids must be lowercase letters, digits and hyphens")
            problems += 1
        ev = load_evidence(bid)
        if ev is None:
            print(f"MISSING evidence: data/evidence/{bid}.json")
            problems += 1
            continue
        srcs = ev.get("sources", [])
        if not srcs:
            print(f"ERROR: {bid}: evidence has no sources")
            problems += 1
        for s in srcs:
            if not str(s.get("url", "")).startswith("https://") or not s.get("license") or not s.get("excerpt"):
                print(f"ERROR: {bid}/{s.get('id')}: each source needs https url, license and excerpt")
                problems += 1
    print(f"{len(rows)} titles, {problems} problem(s)")
    return 1 if problems else 0


# ---------------------------------------------------------------------------- label

def render_prompt(batch: list[dict], bank: list[dict]) -> str:
    books_txt = []
    for row in batch:
        ev = load_evidence(row["id"]) or {"sources": []}
        lines = [
            f"- book_id: {row['id']}",
            f"  title: {row['title_en']}" + (f" / {row['title_ko']}" if none_if_blank(row["title_ko"]) else ""),
            f"  author: {row['author']}",
            f"  first published: {row['first_publication_year'] or 'unknown'}",
            f"  series: {row['series_id'] or 'none'}" + (f" #{row['series_number']}" if none_if_blank(row["series_number"]) else ""),
            "  evidence:",
        ]
        for s in ev["sources"]:
            excerpt = " ".join(str(s.get("excerpt", "")).split())
            lines.append(f"    [{s['id']}] ({s['url']}) <<<{excerpt}>>>")
        books_txt.append("\n".join(lines))
    q_txt = "\n".join(
        f"- {q['id']}: {q['text']} Definition: {q['definition']}" for q in bank if q.get("active", True)
    )
    template = PROMPT.read_text(encoding="utf-8")
    return template.replace("{{BOOKS}}", "\n".join(books_txt)).replace("{{QUESTIONS}}", q_txt)


def parse_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object in response")
    return json.loads(text[start : end + 1])


def check_batch(result: dict, batch: list[dict], bank: list[dict]) -> list[str]:
    """Validate one batch response: exact question ids, allowed values, known source ids."""
    errs: list[str] = []
    active = [q["id"] for q in bank if q.get("active", True)]
    expected_books = {r["id"] for r in batch}
    got_books = {b.get("book_id") for b in result.get("books", [])}
    if got_books != expected_books:
        errs.append(f"book ids mismatch: expected {sorted(expected_books)}, got {sorted(map(str, got_books))}")
    for b in result.get("books", []):
        bid = b.get("book_id")
        allowed_src = {s["id"] for s in (load_evidence(bid) or {}).get("sources", [])}
        answers = b.get("answers", [])
        qids = [a.get("question_id") for a in answers]
        if sorted(map(str, qids)) != sorted(active):
            errs.append(f"{bid}: question ids must be exactly the {len(active)} active ids (got {len(qids)})")
        for a in answers:
            p, st, src = a.get("p_yes"), a.get("status"), a.get("source_ids", [])
            if not isinstance(p, (int, float)) or round(float(p), 6) not in ALLOWED_P:
                errs.append(f"{bid}/{a.get('question_id')}: p_yes {p!r} not allowed")
            if st not in LLM_STATUSES:
                errs.append(f"{bid}/{a.get('question_id')}: status {st!r} not allowed")
            if not isinstance(src, list) or any(s not in allowed_src for s in src):
                errs.append(f"{bid}/{a.get('question_id')}: unknown source ids {src!r}")
            if st == "insufficient_evidence" and (p != 0.5 or src):
                errs.append(f"{bid}/{a.get('question_id')}: insufficient_evidence must be 0.5 with no sources")
            if st == "supported" and not src:
                errs.append(f"{bid}/{a.get('question_id')}: supported needs a source id")
    return errs


def call_llm(provider: str, model: str, prompt: str, max_tokens: int) -> tuple[str, int, int]:
    """Returns (text, input_tokens, output_tokens). Raises on HTTP/API failure."""
    if provider == "anthropic":
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise SystemExit("ANTHROPIC_API_KEY is not set")
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps({"model": model, "max_tokens": max_tokens,
                             "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read())
        text = "".join(c.get("text", "") for c in body.get("content", []) if c.get("type") == "text")
        u = body.get("usage", {})
        return text, int(u.get("input_tokens", 0)), int(u.get("output_tokens", 0))
    if provider == "openai":
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise SystemExit("OPENAI_API_KEY is not set")
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps({"model": model, "max_completion_tokens": max_tokens,
                             "response_format": {"type": "json_object"},
                             "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read())
        text = body["choices"][0]["message"]["content"]
        u = body.get("usage", {})
        return text, int(u.get("prompt_tokens", 0)), int(u.get("completion_tokens", 0))
    raise SystemExit(f"unknown provider {provider}")


def load_spend() -> dict:
    if SPEND.exists():
        return json.loads(SPEND.read_text(encoding="utf-8"))
    return {"input_tokens": 0, "output_tokens": 0, "usd": 0.0, "calls": 0}


def cmd_label(args: argparse.Namespace) -> int:
    if not 1 <= args.batch_size <= 10:
        sys.exit("--batch-size must be between 1 and 10 (brief: requests of 5–10 books)")
    rows = load_titles()
    bank = load_bank()
    missing_ev = [r["id"] for r in rows if load_evidence(r["id"]) is None]
    if missing_ev and not args.dry_run:
        sys.exit(f"Evidence missing for {len(missing_ev)} book(s), e.g. {missing_ev[:5]}. Run `check`.")
    if args.only:
        rows = [r for r in rows if r["id"] in set(args.only)]
    batches = [rows[i : i + args.batch_size] for i in range(0, len(rows), args.batch_size)]
    LABELS.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        total_in = 0
        for n, batch in enumerate(batches):
            prompt = render_prompt(batch, bank)
            total_in += int(len(prompt) / CHARS_PER_TOKEN)
            if n == 0:
                print("----- prompt for batch 000 -----")
                print(prompt[:4000] + ("\n…[truncated]" if len(prompt) > 4000 else ""))
                print("--------------------------------")
        est_out = len(rows) * 63 * 30  # ~30 output tokens per cell
        print(f"{len(batches)} batch(es), ~{total_in:,} input tokens, ~{est_out:,} output tokens (rough estimates)")
        if args.input_rate is not None and args.output_rate is not None:
            usd = total_in / 1e6 * args.input_rate + est_out / 1e6 * args.output_rate
            print(f"estimated cost before retries: ${usd:.2f}")
        return 0

    if not args.model or args.input_rate is None or args.output_rate is None:
        sys.exit("--model, --input-rate and --output-rate are required for real calls (no default prices).")
    spend = load_spend()
    for n, batch in enumerate(batches):
        out = LABELS / f"batch_{n:03d}.json"
        if out.exists() and not args.force:
            print(f"batch {n:03d}: checkpoint exists, skipping")
            continue
        prompt = render_prompt(batch, bank)
        worst_case = (len(prompt) / CHARS_PER_TOKEN) / 1e6 * args.input_rate + args.max_tokens / 1e6 * args.output_rate
        if spend["usd"] + worst_case > args.cap:
            print(f"STOP: spend ${spend['usd']:.2f} + worst-case ${worst_case:.2f} would exceed cap ${args.cap:.2f}")
            return 2
        last_err = ""
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                text, tin, tout = call_llm(args.provider, args.model, prompt, args.max_tokens)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as e:
                last_err = f"request failed: {e}"
                print(f"batch {n:03d} attempt {attempt}: {last_err}")
                time.sleep(2 ** attempt)
                continue
            spend["input_tokens"] += tin
            spend["output_tokens"] += tout
            spend["calls"] += 1
            spend["usd"] += tin / 1e6 * args.input_rate + tout / 1e6 * args.output_rate
            SPEND.write_text(json.dumps(spend, indent=1), encoding="utf-8")
            try:
                result = parse_json(text)
                errs = check_batch(result, batch, bank)
            except (ValueError, json.JSONDecodeError) as e:
                errs = [f"unparseable JSON: {e}"]
            if not errs:
                result["_meta"] = {"provider": args.provider, "model": args.model, "date": date.today().isoformat(),
                                   "input_tokens": tin, "output_tokens": tout}
                out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
                print(f"batch {n:03d}: ok ({tin} in / {tout} out tokens) — total ${spend['usd']:.2f}")
                break
            last_err = "; ".join(errs[:5])
            print(f"batch {n:03d} attempt {attempt}: invalid output: {last_err}")
            if spend["usd"] >= args.cap:
                break
        else:
            (WORK / f"batch_{n:03d}.failed.txt").write_text(last_err, encoding="utf-8")
            print(f"batch {n:03d}: giving up after {MAX_RETRIES} attempts (see data/work/)")
    print(f"done. total spend ${spend['usd']:.2f} over {spend['calls']} call(s)")
    return 0


# ---------------------------------------------------------------------------- merge

def cmd_merge(args: argparse.Namespace) -> int:
    rows = load_titles()
    bank = load_bank()
    labels: dict[str, list[dict]] = {}
    for f in sorted(LABELS.glob("batch_*.json")):
        for b in json.loads(f.read_text(encoding="utf-8")).get("books", []):
            labels[b["book_id"]] = b["answers"]
    books, features = [], []
    skipped = []
    for r in rows:
        if r["id"] not in labels:
            skipped.append(r["id"])
            continue
        books.append(book_record(r, load_evidence(r["id"])))
        for a in labels[r["id"]]:
            if a["p_yes"] == 0.5 and a["status"] == "insufficient_evidence":
                continue  # missing cells default to unknown at runtime
            feat = {"book_id": r["id"], "question_id": a["question_id"], "p_yes": a["p_yes"],
                    "status": a["status"], "source_ids": a.get("source_ids", []), "reviewed": False}
            if a.get("note"):
                feat["note"] = a["note"]
            features.append(feat)
    if skipped:
        print(f"WARNING: {len(skipped)} title(s) have no labels yet and were left out: {skipped[:8]}")
    status = "production" if args.production else "development_fixture"
    catalog = {
        "catalog_version": args.version or f"{date.today().isoformat()}-v1",
        "data_status": status,
        "notice": None if args.production else "LLM-labeled from evidence; human review in progress.",
        "books": books, "questions": bank, "features": features,
    }
    # keep previous review decisions when re-merging
    if FULL_OUT.exists() and not args.discard_reviews:
        old = json.loads(FULL_OUT.read_text(encoding="utf-8"))
        reviewed = {(f["book_id"], f["question_id"]): f for f in old.get("features", []) if f.get("reviewed")}
        merged = {(f["book_id"], f["question_id"]): f for f in features}
        merged.update({k: v for k, v in reviewed.items() if any(b["id"] == k[0] for b in books)})
        catalog["features"] = list(merged.values())
    FULL_OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {FULL_OUT}: {len(books)} books, {len(catalog['features'])} labeled cells")
    rep = validate(catalog, bank)
    for line in rep.info:
        print(f"info: {line}")
    for w in rep.warnings[:20]:
        print(f"WARNING: {w}")
    for e in rep.errors:
        print(f"ERROR: {e}")
    if rep.errors:
        print("Not writing runtime catalog because validation failed.")
        return 1
    if args.runtime_out:
        runtime = json.loads(json.dumps(catalog))
        if runtime.get("notice") is None:
            runtime.pop("notice")
        for f in runtime["features"]:
            f.pop("note", None)
        out = Path(args.runtime_out)
        out.write_text(json.dumps(runtime, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"wrote runtime catalog {out}. Point src/data/index.ts at it to ship it.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    lab = sub.add_parser("label")
    lab.add_argument("--dry-run", action="store_true")
    lab.add_argument("--provider", choices=["anthropic", "openai"], default="anthropic")
    lab.add_argument("--model", help="exact model id from your provider's docs")
    lab.add_argument("--input-rate", type=float, help="USD per 1M input tokens (current provider price)")
    lab.add_argument("--output-rate", type=float, help="USD per 1M output tokens (current provider price)")
    lab.add_argument("--cap", type=float, default=10.0, help="hard spending cap in USD (default 10)")
    lab.add_argument("--batch-size", type=int, default=8)
    lab.add_argument("--max-tokens", type=int, default=16000)
    lab.add_argument("--only", nargs="*", help="label only these book ids (e.g. a 10-book pilot)")
    lab.add_argument("--force", action="store_true", help="redo batches that already have checkpoints")
    mer = sub.add_parser("merge")
    mer.add_argument("--version")
    mer.add_argument("--production", action="store_true", help="mark as production (only after review)")
    mer.add_argument("--runtime-out", help="also write compact runtime JSON here")
    mer.add_argument("--discard-reviews", action="store_true")
    args = ap.parse_args()
    return {"check": cmd_check, "label": cmd_label, "merge": cmd_merge}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
