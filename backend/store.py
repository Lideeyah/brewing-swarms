"""
Storage backend for Brewing.
Uses Upstash Redis REST API when env vars are set; falls back to local JSON files.

Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable persistence on Render.
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from pathlib import Path

_url   = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
_token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
USE_REDIS = bool(_url and _token)


def _get(key: str) -> str | None:
    req = urllib.request.Request(
        f"{_url}/get/{key}",
        headers={"Authorization": f"Bearer {_token}"},
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read()).get("result")


def _set(key: str, value: str):
    body = json.dumps([["SET", key, value]]).encode()
    req = urllib.request.Request(
        f"{_url}/pipeline",
        data=body,
        headers={
            "Authorization": f"Bearer {_token}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5)


def read(key: str, file_path: Path) -> dict:
    if USE_REDIS:
        try:
            raw = _get(key)
            return json.loads(raw) if raw else {}
        except Exception as e:
            import sys
            print(f"[store] Redis read FAILED for {key}: {e}", file=sys.stderr, flush=True)
            return {}
    if not file_path.exists():
        return {}
    try:
        return json.loads(file_path.read_text())
    except Exception:
        return {}


def write(key: str, file_path: Path, data: dict):
    if USE_REDIS:
        try:
            _set(key, json.dumps(data))
        except Exception as e:
            import sys
            print(f"[store] Redis write FAILED for {key}: {e}", file=sys.stderr, flush=True)
            # fallback: also write to local file so data isn't lost in this process
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(json.dumps(data, indent=2))
    else:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(json.dumps(data, indent=2))
