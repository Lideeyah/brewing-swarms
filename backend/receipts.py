"""
Brewing Signed Receipts — Pillar C: Verifiable Provenance
=========================================================
Every completed job produces a cryptographically signed receipt.
The receipt is the immutable delegation trace:

    Human Principal → Employer Agent → Worker Agent → Signed Work Receipt

Signed with the employer's Arc private key (secp256k1 via eth_account).
Anyone can verify a receipt without trusting Brewing's backend.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, asdict

from eth_account import Account
from eth_account.messages import encode_defunct


# ── Receipt data structure ────────────────────────────────────────────────────

@dataclass
class WorkReceipt:
    job_id:         int
    employer:       str      # Arc address
    worker:         str      # Arc address
    worker_agent_id: str     # registry agent_id
    task_type:      str
    output_hash:    str      # sha256 of the work output
    amount_usdc:    float
    completed_at:   int      # unix timestamp
    tx_hash:        str      # Arc settlement TX
    signature:      str      # employer's secp256k1 sig over canonical fields
    receipt_id:     str      # sha256 of the full receipt

    def verify(self) -> bool:
        """Recover signer from signature and check it matches employer."""
        try:
            canonical = _canonical(self)
            msg       = encode_defunct(text=canonical)
            recovered = Account.recover_message(msg, signature=self.signature)
            return recovered.lower() == self.employer.lower()
        except Exception:
            return False

    def to_dict(self) -> dict:
        return asdict(self)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _canonical(r: "WorkReceipt") -> str:
    """Deterministic string over the fields that matter for verification."""
    return json.dumps({
        "job_id":       r.job_id,
        "employer":     r.employer.lower(),
        "worker":       r.worker.lower(),
        "output_hash":  r.output_hash,
        "amount_usdc":  r.amount_usdc,
        "completed_at": r.completed_at,
        "tx_hash":      r.tx_hash,
    }, sort_keys=True)


def _receipt_id(r: "WorkReceipt") -> str:
    return hashlib.sha256(_canonical(r).encode()).hexdigest()


# ── Public API ────────────────────────────────────────────────────────────────

def sign_receipt(
    *,
    job_id:          int,
    employer_addr:   str,
    employer_key:    str,      # hex private key — never leaves the backend
    worker_addr:     str,
    worker_agent_id: str,
    task_type:       str,
    output_text:     str,
    amount_usdc:     float,
    tx_hash:         str,
) -> WorkReceipt:
    """
    Build and sign a work receipt. Returns a receipt any party can verify
    using only the employer's public address.
    """
    output_hash  = hashlib.sha256(output_text.encode()).hexdigest()
    completed_at = int(time.time())

    # Partial receipt (no sig/id yet) for canonical string construction
    partial = WorkReceipt(
        job_id          = job_id,
        employer        = employer_addr,
        worker          = worker_addr,
        worker_agent_id = worker_agent_id,
        task_type       = task_type,
        output_hash     = output_hash,
        amount_usdc     = amount_usdc,
        completed_at    = completed_at,
        tx_hash         = tx_hash,
        signature       = "",
        receipt_id      = "",
    )

    canonical = _canonical(partial)
    msg       = encode_defunct(text=canonical)
    key       = employer_key if employer_key.startswith("0x") else f"0x{employer_key}"
    signed    = Account.sign_message(msg, private_key=key)
    partial.signature  = signed.signature.hex()
    partial.receipt_id = _receipt_id(partial)

    return partial


# ── Persistent receipt store ──────────────────────────────────────────────────

from pathlib import Path

RECEIPTS_FILE = Path(__file__).parent.parent / "receipts.json"


class ReceiptStore:
    def __init__(self):
        self._receipts: dict[str, WorkReceipt] = {}
        self._load()

    def save(self, receipt: WorkReceipt):
        self._receipts[receipt.receipt_id] = receipt
        self._persist()

    def get(self, receipt_id: str) -> WorkReceipt | None:
        return self._receipts.get(receipt_id)

    def for_job(self, job_id: int) -> WorkReceipt | None:
        return next((r for r in self._receipts.values() if r.job_id == job_id), None)

    def all(self) -> list[WorkReceipt]:
        return sorted(self._receipts.values(), key=lambda r: r.completed_at, reverse=True)

    def _persist(self):
        data = {rid: asdict(r) for rid, r in self._receipts.items()}
        RECEIPTS_FILE.write_text(json.dumps(data, indent=2))

    def _load(self):
        if not RECEIPTS_FILE.exists():
            return
        try:
            data = json.loads(RECEIPTS_FILE.read_text())
            for rid, d in data.items():
                self._receipts[rid] = WorkReceipt(**d)
        except Exception:
            pass  # corrupt file — start fresh


receipt_store = ReceiptStore()
