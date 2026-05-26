from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional

BUSINESSES_FILE = Path(__file__).parent.parent / "businesses.json"


@dataclass
class BusinessRecord:
    business_id:    str
    name:           str
    email:          str
    wallet_address: str
    wallet_id:      str
    created_at:     int = field(default_factory=lambda: int(time.time()))


class BusinessStore:
    def __init__(self):
        self._businesses: dict[str, BusinessRecord] = {}
        self._load()

    def create(self, name: str, email: str, wallet_address: str, wallet_id: str) -> BusinessRecord:
        biz = BusinessRecord(
            business_id    = str(uuid.uuid4())[:12],
            name           = name,
            email          = email,
            wallet_address = wallet_address,
            wallet_id      = wallet_id,
        )
        self._businesses[biz.business_id] = biz
        self._persist()
        return biz

    def by_email(self, email: str) -> Optional[BusinessRecord]:
        return next(
            (b for b in self._businesses.values() if b.email.lower() == email.lower()),
            None,
        )

    def _persist(self):
        data = {bid: asdict(b) for bid, b in self._businesses.items()}
        BUSINESSES_FILE.write_text(json.dumps(data, indent=2))

    def _load(self):
        if not BUSINESSES_FILE.exists():
            return
        try:
            data = json.loads(BUSINESSES_FILE.read_text())
            for bid, d in data.items():
                self._businesses[bid] = BusinessRecord(**d)
        except Exception:
            pass


business_store = BusinessStore()
