#!/usr/bin/env python3
"""Local kiosk server: static files + score backup (disk + online, once each)."""
from __future__ import annotations

import socket
import sys
import csv
import json
import mimetypes
import os
import posixpath
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SCORES_JSON = DATA_DIR / "scores.json"
SCORES_CSV = DATA_DIR / "scores.csv"
ONLINE_URL = os.environ.get(
    "PHONEPE_ONLINE_SCORES_URL",
    "https://phonepe-word-of-honor.vercel.app/api/scores",
)
PORT = int(os.environ.get("PHONEPE_PORT", "5173"))
LOCK = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".otf": "font/otf",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
}


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SCORES_JSON.exists():
        SCORES_JSON.write_text("[]", encoding="utf-8")


def load_scores() -> list:
    ensure_data_dir()
    try:
        data = json.loads(SCORES_JSON.read_text(encoding="utf-8") or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def write_csv(scores: list) -> None:
    fields = ["at", "name", "email", "employeeId", "score", "maxScore", "feedback", "id"]
    with SCORES_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for rec in scores:
            writer.writerow({k: rec.get(k, "") for k in fields})


def save_scores(scores: list) -> None:
    ensure_data_dir()
    tmp = SCORES_JSON.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(scores, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(SCORES_JSON)
    write_csv(scores)


def upsert_local(rec: dict) -> dict:
    with LOCK:
        scores = load_scores()
        rec_id = str(rec.get("id") or "")
        existing = next((r for r in scores if str(r.get("id")) == rec_id), None) if rec_id else None
        if existing is None:
            rec.setdefault("savedLocal", True)
            rec.setdefault("savedOnline", False)
            scores.append(rec)
            save_scores(scores)
            return rec
        return existing


def mark_online(rec_id: str) -> None:
    with LOCK:
        scores = load_scores()
        changed = False
        for r in scores:
            if str(r.get("id")) == rec_id and not r.get("savedOnline"):
                r["savedOnline"] = True
                changed = True
        if changed:
            save_scores(scores)


def post_online_once(rec: dict) -> bool:
    if rec.get("savedOnline"):
        return True
    payload = json.dumps(
        {
            "id": rec.get("id"),
            "name": rec.get("name"),
            "employeeId": rec.get("employeeId"),
            "email": rec.get("email"),
            "score": rec.get("score"),
            "maxScore": rec.get("maxScore"),
            "feedback": rec.get("feedback"),
            "at": rec.get("at"),
            "rounds": rec.get("rounds") or [],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        ONLINE_URL,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as res:
            ok = 200 <= res.status < 300
            if ok:
                mark_online(str(rec.get("id") or ""))
            return ok
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = posixpath.normpath(self.path.split("?", 1)[0])
        if path in ("/api/scores", "/api/scores/"):
            self._json(200, {"ok": True, "scores": load_scores(), "source": "local-file"})
            return
        if path in ("/admin", "/admin/"):
            self.path = "/admin.html"
        return super().do_GET()

    def guess_type(self, path):
        ext = Path(path).suffix.lower()
        if ext in MIME:
            return MIME[ext]
        guessed, _ = mimetypes.guess_type(path)
        return guessed or "application/octet-stream"

    def do_POST(self):
        path = posixpath.normpath(self.path.split("?", 1)[0])
        if path not in ("/api/scores", "/api/scores/"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid json"})
            return
        if body.get("clear"):
            with LOCK:
                save_scores([])
            self._json(200, {"ok": True, "scores": [], "cleared": True})
            return
        if not body.get("name") and not body.get("email"):
            self._json(400, {"ok": False, "error": "name or email required"})
            return
        rec = {
            "id": str(body.get("id") or ""),
            "name": str(body.get("name") or "").strip(),
            "employeeId": str(body.get("employeeId") or "").strip(),
            "email": str(body.get("email") or "").strip(),
            "score": int(body.get("score") or 0),
            "maxScore": int(body.get("maxScore") or 0),
            "feedback": str(body.get("feedback") or ""),
            "at": str(body.get("at") or ""),
            "rounds": body.get("rounds") if isinstance(body.get("rounds"), list) else [],
        }
        stored = upsert_local(rec)
        online_ok = post_online_once(stored)
        self._json(
            201,
            {
                "ok": True,
                "record": stored,
                "savedLocal": True,
                "savedOnline": bool(online_ok or stored.get("savedOnline")),
                "source": "local+online" if (online_ok or stored.get("savedOnline")) else "local-only",
            },
        )


class ReuseServer(ThreadingHTTPServer):
    allow_reuse_address = True


def port_is_open(port: int) -> bool:
    sock = socket.socket()
    sock.settimeout(0.4)
    try:
        sock.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def start_server(port: int) -> ReuseServer:
    return ReuseServer(("127.0.0.1", port), Handler)


def main() -> None:
    ensure_data_dir()
    os.chdir(ROOT)
    if port_is_open(PORT):
        print(f"Already running at http://127.0.0.1:{PORT}")
        print(f"  Admin: http://127.0.0.1:{PORT}/admin")
        return
    try:
        server = start_server(PORT)
    except OSError as err:
        print(f"Could not start on port {PORT}: {err}")
        print("Close any other Word of Honor window, then try again.")
        sys.exit(1)
    print("Word of Honor — local kiosk", flush=True)
    print(f"  Player:  http://127.0.0.1:{PORT}", flush=True)
    print(f"  Admin:   http://127.0.0.1:{PORT}/admin", flush=True)
    print(f"  Local:   {SCORES_JSON}", flush=True)
    print(f"  CSV:     {SCORES_CSV}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
