"""Exercise the real HTTP code paths against a local mock server (no internet, no keys).

Checks request shape (URL, headers, body) for the Anthropic Messages API, OpenAI Chat
Completions, and the Open Library search API, plus response parsing, usage accounting,
retry on HTTP 500, and the rate-limited, cached Open Library lookup script.
"""
from __future__ import annotations

import csv
import importlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from argparse import Namespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
BANK = json.loads((ROOT / "data" / "question_bank.json").read_text(encoding="utf-8"))["questions"]
ACTIVE = [q["id"] for q in BANK if q.get("active", True)]


def labels_for(book_ids):
    return {"books": [{"book_id": b, "answers": [
        {"question_id": q, "p_yes": 0.5, "status": "insufficient_evidence", "source_ids": []} for q in ACTIVE
    ]} for b in book_ids]}


class Mock(BaseHTTPRequestHandler):
    log: list = []
    fail_next = 0

    def log_message(self, *a):  # silence
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        Mock.log.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        if Mock.fail_next:
            Mock.fail_next -= 1
            return self._send(500, {"error": "boom"})
        prompt = body["messages"][0]["content"]
        ids = [l.split(": ", 1)[1] for l in prompt.splitlines() if l.startswith("- book_id: ")]
        text = json.dumps(labels_for(ids))
        if self.path == "/v1/messages":
            return self._send(200, {"content": [{"type": "text", "text": "```json\n" + text + "\n```"}],
                                    "usage": {"input_tokens": 1200, "output_tokens": 3400}})
        if self.path == "/v1/chat/completions":
            return self._send(200, {"choices": [{"message": {"content": text}}],
                                    "usage": {"prompt_tokens": 1100, "completion_tokens": 3300}})
        self._send(404, {})

    def do_GET(self):
        Mock.log.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}})
        if self.path.startswith("/search.json"):
            return self._send(200, {"docs": [{"key": "/works/OL123W", "title": "Test Book 0", "author_name": ["Test Author"],
                                              "first_publish_year": 2001, "edition_count": 3}]})
        self._send(404, {})


class HttpClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Mock.log.clear()
        Mock.fail_next = 0
        self.pc = importlib.import_module("prepare_catalog")
        self.env = dict(os.environ)
        os.environ.update(ANTHROPIC_BASE_URL=self.base, OPENAI_BASE_URL=self.base + "/v1",
                          ANTHROPIC_API_KEY="test-key-a", OPENAI_API_KEY="test-key-o")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.env)

    def test_anthropic_request_shape_and_parsing(self):
        prompt = "hello\n- book_id: b1\n"
        text, tin, tout = self.pc.call_llm("anthropic", "model-x", prompt, 999)
        req = Mock.log[-1]
        self.assertEqual(req["path"], "/v1/messages")
        self.assertEqual(req["headers"]["x-api-key"], "test-key-a")
        self.assertEqual(req["headers"]["anthropic-version"], "2023-06-01")
        self.assertEqual(req["body"]["model"], "model-x")
        self.assertEqual(req["body"]["max_tokens"], 999)
        self.assertEqual(req["body"]["messages"], [{"role": "user", "content": prompt}])
        self.assertEqual((tin, tout), (1200, 3400))
        self.assertEqual(self.pc.parse_json(text)["books"][0]["book_id"], "b1")  # fenced JSON is unwrapped

    def test_openai_request_shape_and_parsing(self):
        text, tin, tout = self.pc.call_llm("openai", "model-y", "- book_id: b2\n", 500)
        req = Mock.log[-1]
        self.assertEqual(req["path"], "/v1/chat/completions")
        self.assertEqual(req["headers"]["authorization"], "Bearer test-key-o")
        self.assertEqual(req["body"]["response_format"], {"type": "json_object"})
        self.assertEqual(req["body"]["max_completion_tokens"], 500)
        self.assertEqual((tin, tout), (1100, 3300))
        self.assertEqual(json.loads(text)["books"][0]["book_id"], "b2")

    def test_label_end_to_end_over_http_with_retry(self):
        tmp = tempfile.TemporaryDirectory()
        t = Path(tmp.name)
        saved = {k: getattr(self.pc, k) for k in ("WORK", "LABELS", "SPEND")}
        self.pc.WORK, self.pc.LABELS, self.pc.SPEND = t, t / "labels", t / "spend.json"
        self.pc.time.sleep = lambda s: None
        try:
            Mock.fail_next = 1  # first request gets HTTP 500 → retried
            args = Namespace(dry_run=False, provider="anthropic", model="m", input_rate=1.0, output_rate=4.0, cap=10.0,
                             batch_size=5, max_tokens=16000, only=None, force=False)
            self.assertEqual(self.pc.cmd_label(args), 0)  # uses the real data/curation/titles.csv + data/evidence
            self.assertEqual(len(Mock.log), 3)            # 1 failed + 2 batches of 5 books
            self.assertEqual(len(list((t / "labels").glob("batch_*.json"))), 2)
            spend = json.loads((t / "spend.json").read_text())
            self.assertEqual(spend["calls"], 2)
            self.assertAlmostEqual(spend["usd"], 2 * (1200 / 1e6 + 3400 / 1e6 * 4))
        finally:
            for k, v in saved.items():
                setattr(self.pc, k, v)
            tmp.cleanup()

    def test_openlibrary_lookup_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            titles = t / "titles.csv"
            with titles.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=["id", "title_en", "author", "openlibrary_work_id"])
                w.writeheader()
                w.writerow({"id": "b0", "title_en": "Test Book 0", "author": "Test Author", "openlibrary_work_id": ""})
                w.writerow({"id": "b1", "title_en": "Known", "author": "X", "openlibrary_work_id": "OL1W"})
            env = dict(os.environ, OL_BASE_URL=self.base, OL_CONTACT="tester@example.org", OL_CACHE=str(t / "cache.json"))
            cmd = [sys.executable, str(ROOT / "scripts" / "openlibrary_lookup.py"), "--titles", str(titles),
                   "--out", str(t / "out.csv"), "--delay", "0"]
            r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            gets = [l for l in Mock.log if l["path"].startswith("/search.json")]
            self.assertEqual(len(gets), 1)  # only the row without an ID is looked up
            self.assertIn("tester@example.org", gets[0]["headers"]["user-agent"])
            self.assertIn("title=Test+Book+0", gets[0]["path"])
            with (t / "out.csv").open(encoding="utf-8") as fh:
                rows = list(csv.DictReader(fh))
            self.assertEqual(rows[0]["candidate_work_id"], "OL123W")
            subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)  # second run hits the cache
            self.assertEqual(len([l for l in Mock.log if l["path"].startswith("/search.json")]), 1)


if __name__ == "__main__":
    unittest.main()
