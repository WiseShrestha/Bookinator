"""Offline tests for the data pipeline. The LLM call is mocked — no network, no key.

    python3 -m unittest discover -s tests -p "test_*.py"
"""
from __future__ import annotations

import copy
import csv
import importlib
import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import validate_catalog  # noqa: E402

FIXTURE = json.loads((ROOT / "src" / "data" / "fixture.catalog.json").read_text(encoding="utf-8"))
BANK = json.loads((ROOT / "data" / "question_bank.json").read_text(encoding="utf-8"))["questions"]
ACTIVE = [q["id"] for q in BANK if q.get("active", True)]


class ValidatorTests(unittest.TestCase):
    def test_fixture_is_valid(self):
        r = validate_catalog.validate(FIXTURE, BANK)
        self.assertEqual(r.errors, [])

    def errors_for(self, mutate):
        cat = copy.deepcopy(FIXTURE)
        mutate(cat)
        return validate_catalog.validate(cat).errors

    def test_catches_bad_probability(self):
        errs = self.errors_for(lambda c: c["features"][0].update(p_yes=0.8))
        self.assertTrue(any("p_yes" in e for e in errs))

    def test_catches_duplicate_cell_and_unknown_refs(self):
        errs = self.errors_for(lambda c: c["features"].append(dict(c["features"][0])))
        self.assertTrue(any("duplicate cell" in e for e in errs))
        errs = self.errors_for(lambda c: c["features"][0].update(question_id="q99"))
        self.assertTrue(any("unknown question" in e for e in errs))

    def test_fixture_labels_not_allowed_in_production(self):
        def m(c):
            c.update(data_status="production")
            c["books"][0]["sources"] = []
            for f in c["features"]:
                if f["book_id"] == c["books"][0]["id"]:
                    f["source_ids"] = []
        errs = self.errors_for(m)
        self.assertTrue(any("fixture labels" in e for e in errs))
        self.assertTrue(any("need at least one source" in e for e in errs))

    def test_supported_needs_known_source(self):
        def m(c):
            c["features"][0].update(status="supported", source_ids=["s9"])
        errs = self.errors_for(m)
        self.assertTrue(any("not among this book's sources" in e for e in errs))

    def test_community_consensus_needs_provenance_and_review(self):
        def bare(c):
            c["features"][0].update(status="community_consensus", p_yes=0.9, source_ids=[], reviewed=False)
        errs = self.errors_for(bare)
        self.assertTrue(any("needs consensus" in e for e in errs))
        self.assertTrue(any("accepted by a reviewer" in e for e in errs))

        def ok(c):
            c["features"][0].update(status="community_consensus", p_yes=0.9, source_ids=[], reviewed=True,
                                    consensus={"algorithm_version": "crowd-v1", "consensus_id": 7, "contributors": 5})
        self.assertEqual(self.errors_for(ok), [])

        def stray(c):
            c["features"][0]["consensus"] = {"algorithm_version": "crowd-v1", "consensus_id": 7, "contributors": 5}
        self.assertTrue(any("only allowed on community_consensus" in e for e in self.errors_for(stray)))

    def test_rejects_placeholder_sources_and_bad_ol_id(self):
        def m(c):
            c["books"][0]["sources"] = [{"id": "s1", "url": "VERIFIED_URL", "license": "RECORDED_TERMS"}]
            c["books"][0]["openlibrary_work_id"] = "12345"
        errs = self.errors_for(m)
        self.assertTrue(any("real https URL" in e for e in errs))
        self.assertTrue(any("license" in e for e in errs))
        self.assertTrue(any("Open Library work id" in e for e in errs))


class EditionTests(unittest.TestCase):
    def test_isbn_checksum(self):
        self.assertTrue(validate_catalog.isbn13_ok("9788936433598"))
        self.assertFalse(validate_catalog.isbn13_ok("9788936433599"))
        cat = copy.deepcopy(FIXTURE)
        cat["books"][0]["editions"] = [{"isbn": "9780000000001", "source_id": "s1"}]
        self.assertTrue(any("ISBN-13" in e for e in validate_catalog.validate(cat).errors))


class PipelineTests(unittest.TestCase):
    """label → merge → review on a temporary workspace with a mocked LLM."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.pc = importlib.import_module("prepare_catalog")
        self.rv = importlib.import_module("review")
        (t / "evidence").mkdir()
        self.titles = t / "titles.csv"
        with self.titles.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=self.pc.TITLE_FIELDS)
            w.writeheader()
            for i in range(3):
                w.writerow({"id": f"test-book-{i}", "title_en": f"Test Book {i}", "title_ko": "", "aliases": "",
                            "author": "Test Author", "original_language": "en", "first_publication_year": "2001",
                            "series_id": "", "series_number": "", "openlibrary_work_id": "", "demo_pool": "yes" if i == 0 else ""})
                (t / "evidence" / f"test-book-{i}.json").write_text(json.dumps({
                    "book_id": f"test-book-{i}",
                    "sources": [{"id": "s1", "url": "https://example.org/test", "license": "test-only", "excerpt": "Synthetic test excerpt."}],
                }), encoding="utf-8")
        self.saved = {k: getattr(self.pc, k) for k in ("TITLES", "EVIDENCE", "WORK", "LABELS", "SPEND", "FULL_OUT")}
        self.pc.TITLES = self.titles
        self.pc.EVIDENCE = t / "evidence"
        self.pc.WORK = t / "work"
        self.pc.LABELS = t / "work" / "labels"
        self.pc.SPEND = t / "work" / "spend.json"
        self.pc.FULL_OUT = t / "catalog.full.json"
        self.pc.WORK.mkdir()
        self.calls = 0

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(self.pc, k, v)
        self.tmp.cleanup()

    def fake_response(self, book_ids, broken=False):
        books = []
        for n, bid in enumerate(book_ids):
            answers = []
            for j, q in enumerate(ACTIVE):
                p = [0.1, 0.9, 0.5][(j + n) % 3]
                answers.append({"question_id": q, "p_yes": p,
                                "status": "insufficient_evidence" if p == 0.5 else "supported",
                                "source_ids": [] if p == 0.5 else ["s1"]})
            if broken:
                answers = answers[:-1]
            books.append({"book_id": bid, "answers": answers})
        return json.dumps({"books": books})

    def label_args(self, **kw):
        base = dict(dry_run=False, provider="anthropic", model="test-model", input_rate=1.0, output_rate=4.0,
                    cap=10.0, batch_size=2, max_tokens=16000, only=None, force=False)
        base.update(kw)
        return Namespace(**base)

    def test_label_retries_invalid_output_then_checkpoints_and_merges(self):
        def fake_call(provider, model, prompt, max_tokens):
            self.calls += 1
            ids = [l.split(": ", 1)[1] for l in prompt.splitlines() if l.startswith("- book_id: ")]
            return self.fake_response(ids, broken=(self.calls == 1)), 1000, 2000
        self.pc.call_llm = fake_call
        self.pc.time.sleep = lambda s: None
        self.assertEqual(self.pc.cmd_label(self.label_args()), 0)
        self.assertEqual(self.calls, 3)  # batch 0 retried once, batch 1 once
        self.assertEqual(len(list(self.pc.LABELS.glob("batch_*.json"))), 2)
        spend = json.loads(self.pc.SPEND.read_text())
        self.assertAlmostEqual(spend["usd"], 3 * (1000 / 1e6 * 1 + 2000 / 1e6 * 4))
        # second run skips checkpoints
        self.assertEqual(self.pc.cmd_label(self.label_args()), 0)
        self.assertEqual(self.calls, 3)
        runtime = Path(self.tmp.name) / "runtime.json"
        rc = self.pc.cmd_merge(Namespace(version="t1", production=False, runtime_out=str(runtime), discard_reviews=False))
        self.assertEqual(rc, 0)
        cat = json.loads(runtime.read_text())
        self.assertEqual(len(cat["books"]), 3)
        self.assertTrue(all(f["p_yes"] != 0.5 for f in cat["features"]))  # unknowns stay implicit
        self.assertEqual(validate_catalog.validate(cat).errors, [])

    def test_spending_cap_stops_before_call(self):
        self.pc.call_llm = lambda *a: self.fail("must not call over cap")
        self.assertEqual(self.pc.cmd_label(self.label_args(cap=0.0001)), 2)

    def test_invented_source_id_is_rejected(self):
        resp = json.loads(self.fake_response(["test-book-0"]))
        resp["books"][0]["answers"][1]["source_ids"] = ["s7"]
        rows = [r for r in self.pc.load_titles() if r["id"] == "test-book-0"]
        errs = self.pc.check_batch(resp, rows, BANK)
        self.assertTrue(any("unknown source ids" in e for e in errs))

    def test_review_export_and_apply(self):
        self.pc.call_llm = lambda p, m, prompt, mt: (
            self.fake_response([l.split(": ", 1)[1] for l in prompt.splitlines() if l.startswith("- book_id: ")]), 1, 1)
        self.pc.cmd_label(self.label_args())
        self.pc.cmd_merge(Namespace(version="t1", production=False, runtime_out=None, discard_reviews=False))
        out = Path(self.tmp.name) / "review.csv"
        self.rv.cmd_export(Namespace(catalog=str(self.pc.FULL_OUT), out=str(out), demo=["test-book-0"],
                                     random=5, pairs=1, seed=1))
        with out.open(encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        self.assertGreater(len(rows), 5)
        rows[0].update(verdict="fix", corrected_p_yes="0.7", reviewer="tester")
        rows[1].update(verdict="unknown", reviewer="tester")
        rows[2].update(verdict="ok", reviewer="tester")
        with out.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=self.rv.COLUMNS)
            w.writeheader()
            w.writerows(rows)
        self.assertEqual(self.rv.cmd_apply(Namespace(catalog=str(self.pc.FULL_OUT), csv=str(out), partial=False)), 0)
        cat = json.loads(self.pc.FULL_OUT.read_text())
        f = {(x["book_id"], x["question_id"]): x for x in cat["features"]}
        self.assertEqual(f[(rows[0]["book_id"], rows[0]["question_id"])]["p_yes"], 0.7)
        self.assertEqual(f[(rows[1]["book_id"], rows[1]["question_id"])]["status"], "insufficient_evidence")
        self.assertTrue(f[(rows[2]["book_id"], rows[2]["question_id"])]["reviewed"])
        # reviews survive a re-merge
        self.pc.cmd_merge(Namespace(version="t2", production=False, runtime_out=None, discard_reviews=False))
        cat2 = json.loads(self.pc.FULL_OUT.read_text())
        f2 = {(x["book_id"], x["question_id"]): x for x in cat2["features"]}
        self.assertEqual(f2[(rows[0]["book_id"], rows[0]["question_id"])]["p_yes"], 0.7)


if __name__ == "__main__":
    unittest.main()
