"""
Brewing SDK — Arc L1 Edition (Native USDC)
Arc L1: USDC is the native gas token — use msg.value/send(), no ERC20 needed.
"""
import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

from web3 import Web3

# ── Rate limiters ─────────────────────────────────────────────────────────────

_rpc_lock = asyncio.Lock()
RPC_DELAY  = 0.5   # seconds between Arc RPC calls

_api_lock  = asyncio.Lock()
API_DELAY  = 3.5   # pacemaker for Anthropic / external API calls

# 0.10 USDC in native EVM units (18 dec at EVM level on Arc)
USDC = lambda amount: int(amount * 10 ** 18)

# ── ABI (AgentEscrow.vy — native USDC edition) ────────────────────────────────

ESCROW_ABI = [
    {
        "name": "create_job",
        "type": "function",
        "inputs": [
            {"name": "_worker",    "type": "address"},
            {"name": "_timeout",   "type": "uint256"},
            {"name": "_ipfs_hash", "type": "bytes32"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "payable",   # msg.value carries the USDC
    },
    {
        "name": "complete_job",
        "type": "function",
        "inputs": [{"name": "_job_id", "type": "uint256"}],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "name": "slash_job",
        "type": "function",
        "inputs": [{"name": "_job_id", "type": "uint256"}],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "name": "get_job",
        "type": "function",
        "inputs": [{"name": "_job_id", "type": "uint256"}],
        "outputs": [
            {
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "employer",       "type": "address"},
                    {"name": "worker",         "type": "address"},
                    {"name": "amount",         "type": "uint256"},
                    {"name": "sla_timeout",    "type": "uint256"},
                    {"name": "status",         "type": "uint256"},
                    {"name": "ipfs_spec_hash", "type": "bytes32"},
                ],
            }
        ],
        "stateMutability": "view",
    },
    {
        "name": "is_slashable",
        "type": "function",
        "inputs": [{"name": "_job_id", "type": "uint256"}],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "name": "job_count",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "owner",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
    },
    {"name": "JobCreated",   "type": "event", "anonymous": False, "inputs": [
        {"name": "job_id",      "type": "uint256", "indexed": True},
        {"name": "employer",    "type": "address", "indexed": True},
        {"name": "worker",      "type": "address", "indexed": True},
        {"name": "amount",      "type": "uint256", "indexed": False},
        {"name": "sla_timeout", "type": "uint256", "indexed": False},
    ]},
    {"name": "JobCompleted", "type": "event", "anonymous": False, "inputs": [
        {"name": "job_id", "type": "uint256", "indexed": True},
        {"name": "worker", "type": "address", "indexed": True},
        {"name": "amount", "type": "uint256", "indexed": False},
    ]},
    {"name": "JobSlashed",   "type": "event", "anonymous": False, "inputs": [
        {"name": "job_id",   "type": "uint256", "indexed": True},
        {"name": "employer", "type": "address", "indexed": True},
        {"name": "amount",   "type": "uint256", "indexed": False},
    ]},
]

# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class JobInfo:
    job_id:         int
    employer:       str
    worker:         str
    amount_usdc:    float   # human-readable (native units / 1e18)
    sla_timeout:    int
    status:         str     # "Funded" | "Completed" | "Slashed"
    ipfs_spec_hash: str

STATUS_MAP = {1: "Funded", 2: "Completed", 3: "Slashed"}

# ── Client ────────────────────────────────────────────────────────────────────

class BrewingArcClient:
    """
    Async wrapper around AgentEscrow.vy on Arc testnet.
    Uses native USDC (msg.value) — no ERC20 approve needed.
    """

    def __init__(self):
        rpc_url = os.environ["ARC_RPC_URL"]
        self.w3  = Web3(Web3.HTTPProvider(rpc_url))
        self.account = self.w3.eth.account.from_key(os.environ["ARC_PRIVATE_KEY"])
        escrow_addr  = Web3.to_checksum_address(os.environ["ESCROW_CONTRACT_ADDRESS"])
        self.escrow  = self.w3.eth.contract(address=escrow_addr, abi=ESCROW_ABI)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _send_tx(self, fn, value: int = 0) -> str:
        """Build → sign → broadcast. Returns tx hash hex string."""
        tx = fn.build_transaction({
            "from":     self.account.address,
            "nonce":    self.w3.eth.get_transaction_count(self.account.address),
            "gas":      300_000,
            "gasPrice": self.w3.eth.gas_price,
            "value":    value,
        })
        signed  = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return "0x" + tx_hash.hex()

    async def _rpc(self, fn):
        """Rate-limited synchronous call wrapped in executor."""
        async with _rpc_lock:
            await asyncio.sleep(RPC_DELAY)
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, fn)

    def _wait(self, tx_hash: str):
        """Wait for a tx receipt (blocks, call from executor)."""
        raw = bytes.fromhex(tx_hash[2:] if tx_hash.startswith("0x") else tx_hash)
        return self.w3.eth.wait_for_transaction_receipt(raw, timeout=120)

    # ── Write ─────────────────────────────────────────────────────────────────

    async def post_job(
        self,
        worker:          str,
        usdc_amount:     float = 0.10,
        timeout_seconds: int   = 3600,
        ipfs_hash:       bytes = b"\x00" * 32,
    ) -> dict:
        """
        Create a job — native USDC sent as msg.value.
        Returns job_id and tx hash.
        """
        worker_addr  = Web3.to_checksum_address(worker)
        native_value = USDC(usdc_amount)

        async with _rpc_lock:
            await asyncio.sleep(RPC_DELAY)
            tx_hash = self._send_tx(
                self.escrow.functions.create_job(worker_addr, timeout_seconds, ipfs_hash),
                value=native_value,
            )

        loop    = asyncio.get_running_loop()
        receipt = await loop.run_in_executor(None, lambda: self._wait(tx_hash))
        logs    = self.escrow.events.JobCreated().process_receipt(receipt)
        job_id  = logs[0]["args"]["job_id"] if logs else None

        return {"job_id": job_id, "create_tx": tx_hash}

    async def complete_job(self, job_id: int) -> str:
        async with _rpc_lock:
            await asyncio.sleep(RPC_DELAY)
            tx_hash = self._send_tx(self.escrow.functions.complete_job(job_id))
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._wait(tx_hash))
        return tx_hash

    async def slash_job(self, job_id: int) -> str:
        async with _rpc_lock:
            await asyncio.sleep(RPC_DELAY)
            tx_hash = self._send_tx(self.escrow.functions.slash_job(job_id))
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._wait(tx_hash))
        return tx_hash

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_job(self, job_id: int) -> JobInfo:
        raw = await self._rpc(lambda: self.escrow.functions.get_job(job_id).call())
        return JobInfo(
            job_id=job_id,
            employer=raw[0],
            worker=raw[1],
            amount_usdc=raw[2] / 10**18,
            sla_timeout=raw[3],
            status=STATUS_MAP.get(raw[4], "Unknown"),
            ipfs_spec_hash=raw[5].hex(),
        )

    async def get_all_jobs(self) -> list:
        count = await self._rpc(lambda: self.escrow.functions.job_count().call())
        jobs  = []
        for i in range(1, count + 1):
            try:
                jobs.append(await self.get_job(i))
            except Exception:
                pass
        return jobs

    async def native_balance(self, address: str = None) -> float:
        addr = Web3.to_checksum_address(address or self.account.address)
        raw  = await self._rpc(lambda: self.w3.eth.get_balance(addr))
        return raw / 10**18


# ── Pacemaker (wrap every Claude / external API call with this) ───────────────

async def paced_api_call(coro):
    """3.5 s pacemaker lock per CLAUDE.md — prevents Anthropic 429s."""
    async with _api_lock:
        await asyncio.sleep(API_DELAY)
        return await coro
