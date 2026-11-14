#!/usr/bin/env python3
"""Suggest Open Library work IDs for titles.csv rows that have none — for HUMAN confirmation.

    OL_CONTACT=you@example.com python3 scripts/openlibrary_lookup.py --out data/work/ol_suggestions.csv

Uses the documented search API (https://openlibrary.org/search.json?title=…&author=…),
one request per second, with a User-Agent naming the app and a contact, and caches
responses in data/work/ol_cache.json so re-runs don't re-query. It never edits
titles.csv: open the suggested work pages, confirm the match, then paste the ID.
Not run during the build (no network in that environment) — test it on a few rows first.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "work" / "ol_cache.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--titles", default=str(ROOT / "data" / "curation" / "titles.csv"))
    ap.add_argument("--out", default=str(ROOT / "data" / "work" / "ol_suggestions.csv"))
    ap.add_argument("--limit", type=int, default=3, help="candidates per title")
    args = ap.parse_args()
    contact = os.environ.get("OL_CONTACT")
    if not contact:
        sys.exit("Set OL_CONTACT to an email or URL for the User-Agent (Open Library asks for identification).")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    with open(args.titles, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if not (r.get("openlibrary_work_id") or "").strip()]
    out_rows = []
    for r in rows:
        params = {"title": r["title_en"], "author": r["author"], "limit": str(args.limit),
                  "fields": "key,title,author_name,first_publish_year,edition_count"}
        url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
        if url not in cache:
            req = urllib.request.Request(url, headers={"User-Agent": f"ThatBookHackathon/0.1 ({contact})"})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    cache[url] = json.loads(resp.read())
            except Exception as e:  # noqa: BLE001 — report and continue
                print(f"{r['id']}: lookup failed ({e})")
                continue
            finally:
                time.sleep(1.0)
            CACHE.write_text(json.dumps(cache), encoding="utf-8")
        for d in cache[url].get("docs", [])[: args.limit]:
            key = d.get("key", "")
            out_rows.append({
                "book_id": r["id"], "our_title": r["title_en"], "our_author": r["author"],
                "candidate_work_id": key.rsplit("/", 1)[-1], "candidate_title": d.get("title", ""),
                "candidate_author": "; ".join(d.get("author_name", [])),
                "first_publish_year": d.get("first_publish_year", ""), "editions": d.get("edition_count", ""),
                "check_url": f"https://openlibrary.org{key}",
            })
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()) if out_rows else ["book_id"])
        w.writeheader()
        w.writerows(out_rows)
    print(f"{len(out_rows)} candidate(s) for {len(rows)} title(s) → {args.out}. Confirm each by opening check_url.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
