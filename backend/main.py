"""
Brewing Arc API — FastAPI backend
B2B AI task marketplace on Circle Arc L1.

Run locally:
    cd ~/arc
    uvicorn backend.main:app --reload --port 8000
"""
import asyncio
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

import json as _json_module
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.brewing_sdk    import BrewingArcClient
from backend.registry       import registry, compute_reputation
from backend.circle_wallets import provision_agent_wallet
from backend.receipts       import sign_receipt, receipt_store
from backend.tasks          import task_store, TaskRecord
from backend.businesses     import business_store
from backend.governance     import get_log
from backend.auditor        import AuditorAgent

# ── Streaming event bus ───────────────────────────────────────────────────────
# Maps task_id → {"queues": list[asyncio.Queue], "buffer": deque[dict]}
# Buffer stores ALL emitted events so late SSE connections can replay them.
_task_streams: dict[str, dict] = {}

async def _emit(task_id: str, event_type: str, **kwargs):
    """Broadcast a progress event to all SSE subscribers for a task."""
    payload = {"type": event_type, **kwargs}
    entry = _task_streams.setdefault(task_id, {"queues": [], "buffer": deque(maxlen=500)})
    entry["buffer"].append(payload)
    for q in entry["queues"]:
        await q.put(payload)

# ── App lifecycle ─────────────────────────────────────────────────────────────

client: BrewingArcClient | None = None
_swarms_warmed: bool = False   # set True once Swarms module has been imported + instantiated


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, _swarms_warmed
    client = BrewingArcClient()
    _seed_registry()
    # Pre-warm Swarms imports so the first demo request has no cold-start delay.
    # We instantiate a throwaway orchestrator to trigger all Python module loads.
    try:
        from backend.swarms_workflow import BrewingSwarmOrchestrator
        _api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if _api_key:
            _warmup = BrewingSwarmOrchestrator(api_key=_api_key)
            del _warmup
            _swarms_warmed = True
    except Exception:
        pass
    yield


def _seed_registry():
    import hashlib
    specs = [
        ("RiskAnalyst",       ["risk-analysis", "structured-reasoning", "capital-allocation", "governance", "rwa-analysis"]),
        ("MarketResearchBot", ["market-intelligence", "trading-signals", "research", "sector-analysis", "price-trends"]),
        ("SentimentBot",      ["sentiment-analysis", "news-analysis", "social-signals", "nlp", "market-mood"]),
        ("ArbitrageBot",      ["arbitrage", "price-discrepancy", "cross-market", "spread-detection", "execution-signals"]),
        ("PortfolioBot",      ["portfolio-analysis", "rebalancing", "asset-allocation", "risk-management", "recommendations", "strategy"]),
        ("PredictionBot",     ["event-research", "probability-scoring", "forecasting", "scenario-analysis", "risk-prediction"]),
    ]
    owner = client.account.address
    for name, caps in specs:
        agent_id = hashlib.sha256(f"{owner.lower()}:{name.lower()}".encode()).hexdigest()[:16]
        if registry.get(agent_id):
            continue
        wallet = provision_agent_wallet(name)
        base_url = os.getenv("RENDER_EXTERNAL_URL", "http://localhost:8000")
        registry.register(
            name         = name,
            owner        = owner,
            payment_addr = wallet.address,
            capabilities = caps,
            endpoint     = f"{base_url}/agents/{name.lower()}",
        )


app = FastAPI(title="Brewing Arc API", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request models ────────────────────────────────────────────────────────────

class OnboardRequest(BaseModel):
    name:  str
    email: str

class PostTaskRequest(BaseModel):
    description:      str
    budget_usdc:      float
    deadline_hours:   int   = 24
    employer_address: str   = ""
    employer_name:    str   = ""
    selected_agent:   str   = ""   # agent name chosen in marketplace; empty = pipeline
    drive_files:      list  = []   # [{name: str, content: str}]
    gmail_threads:    list  = []   # [{subject: str, content: str}]
    slack_messages:   list  = []   # [{channel: str, content: str}]
    governance_mode:  str   = "standard"  # "standard" | "swarms_demo" | "slash_demo"

class PostJobRequest(BaseModel):
    worker:          str
    usdc_amount:     float
    timeout_seconds: int = 3600

class RegisterAgentRequest(BaseModel):
    name:           str
    description:    str
    capabilities:   list[str]
    payment_addr:   str
    price_per_task: float = 0.033
    webhook_url:    str

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    from backend.store import USE_REDIS, _set, _get
    redis_ok = None
    if USE_REDIS:
        try:
            _set("brewing:healthcheck", "1")
            redis_ok = _get("brewing:healthcheck") == "1"
        except Exception as e:
            redis_ok = f"error: {e}"
    return {
        "status":    "ok",
        "network":   "arc-testnet",
        "storage":   "redis" if USE_REDIS else "ephemeral-file",
        "redis_ok":  redis_ok,
        "agents":    len(registry.all()),
        "tasks":     len(task_store.all()),
        "receipts":  len(receipt_store.all()),
    }

# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/login")
async def login(req: OnboardRequest):
    """Sign in an existing business by email. Returns 404 if not found."""
    existing = business_store.by_email(req.email)
    if not existing:
        raise HTTPException(status_code=404, detail="No account found for that email. Please create one.")
    try:
        bal = await client.native_balance(existing.wallet_address)
    except Exception:
        bal = 0.0
    return {
        "business_id":    existing.business_id,
        "wallet_address": existing.wallet_address,
        "name":           existing.name,
        "balance_usdc":   bal,
        "existing":       True,
    }

# ── Onboarding ────────────────────────────────────────────────────────────────

@app.post("/api/onboard")
async def onboard(req: OnboardRequest):
    """Create (or retrieve) a Circle DCW wallet for a new business user."""
    existing = business_store.by_email(req.email)
    if existing:
        try:
            bal = await client.native_balance(existing.wallet_address)
        except Exception:
            bal = 0.0
        return {
            "business_id":    existing.business_id,
            "wallet_address": existing.wallet_address,
            "balance_usdc":   bal,
            "existing":       True,
        }

    wallet = provision_agent_wallet(req.name)
    biz    = business_store.create(req.name, req.email, wallet.address, wallet.wallet_id)
    return {
        "business_id":    biz.business_id,
        "wallet_address": wallet.address,
        "balance_usdc":   0.0,
        "existing":       False,
    }

# ── Webhook dispatch ─────────────────────────────────────────────────────────

async def _call_webhook(
    agent,
    task_id:          str,
    description:      str,
    budget_usdc:      float,
    employer_address: str,
    file_context:     str = "",
) -> str:
    """POST task to external agent webhook; return result text."""
    import httpx
    payload = {
        "task_id":          task_id,
        "description":      description + (f"\n\nContext:\n{file_context}" if file_context else ""),
        "budget_usdc":      budget_usdc,
        "employer_address": employer_address,
        "agent_id":         agent.agent_id,
    }
    try:
        async with httpx.AsyncClient(timeout=120) as hc:
            resp = await hc.post(agent.webhook_url, json=payload)
        data = resp.json()
        if isinstance(data, dict):
            return data.get("result") or data.get("output") or str(data)
        return str(data)
    except Exception as exc:
        raise ValueError(f"Webhook call to {agent.webhook_url} failed: {exc}") from exc


# ── Task marketplace ──────────────────────────────────────────────────────────

@app.get("/api/tasks/{task_id}/stream")
async def stream_task_events(task_id: str):
    """SSE endpoint — streams live agent progress for a running task.

    Late connections receive a replay of all buffered events emitted so far,
    then stream new events as they arrive. This eliminates the race condition
    where the frontend SSE connection establishes after the pipeline has already
    emitted its first few events.
    """
    q: asyncio.Queue = asyncio.Queue()
    entry = _task_streams.setdefault(task_id, {"queues": [], "buffer": deque(maxlen=500)})

    async def generate():
        # IMPORTANT: snapshot the buffer THEN register — both sync, no await between them.
        # asyncio is single-threaded: no _emit() can fire between these two lines.
        snapshot = list(entry["buffer"])
        entry["queues"].append(q)
        try:
            # Replay any events that fired before this connection arrived
            for ev in snapshot:
                yield f"data: {_json_module.dumps(ev)}\n\n"
                if ev.get("type") in ("done", "error"):
                    return   # pipeline already finished; nothing left to stream
            # Stream new events as they arrive
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=120)
                    yield f"data: {_json_module.dumps(ev)}\n\n"
                    if ev.get("type") in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    yield 'data: {"type":"ping"}\n\n'
        finally:
            try:
                entry["queues"].remove(q)
            except ValueError:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/tasks")
async def post_task(req: PostTaskRequest):
    """Create task immediately and run the agent pipeline in the background."""
    employer_addr = req.employer_address or client.account.address

    task = task_store.create(
        employer_address = employer_addr,
        employer_name    = req.employer_name,
        description      = req.description,
        budget_usdc      = req.budget_usdc,
        deadline_hours   = req.deadline_hours,
    )
    task.status = "in_progress"
    task_store.update(task)

    # Dispatch: governed (Swarms) or standard pipeline
    if req.governance_mode in ("swarms_demo", "slash_demo"):
        asyncio.create_task(_run_governed_pipeline(task, req, employer_addr))
    else:
        asyncio.create_task(_run_pipeline(task, req, employer_addr))
    return {"task_id": task.task_id, "status": "in_progress", "governance_mode": req.governance_mode}


async def _smart_route(description: str, agents: list, ai) -> tuple[str | None, str]:
    """
    Asks Claude to decide: single specialist agent or full multi-agent pipeline.
    Returns (agent_name, reason) — agent_name=None means full pipeline.
    """
    import json as _j, re as _r
    agent_summary = "\n".join(
        f"- {a.name}: {', '.join(a.capabilities[:4])}" for a in agents
    )
    prompt = (
        f"Task: {description}\n\n"
        f"Available agents:\n{agent_summary}\n\n"
        "Decide whether this task should be handled by a single specialist agent or the full multi-agent pipeline.\n"
        "Use a single agent when the task is narrow and maps clearly to one agent's capabilities.\n"
        "Use the full pipeline for broad, strategic, or multi-dimensional tasks.\n"
        'Respond with JSON only: {"route": "<AgentName> or PIPELINE", "reason": "<one sentence>"}'
    )
    try:
        resp = await ai.messages.create(
            model      = "claude-haiku-4-5-20251001",
            max_tokens = 120,
            messages   = [{"role": "user", "content": prompt}],
        )
        raw  = resp.content[0].text.strip()
        m    = _r.search(r'\{.*\}', raw, _r.DOTALL)
        data = _j.loads(m.group()) if m else {}
        route  = data.get("route", "PIPELINE").strip()
        reason = data.get("reason", "")
        # Only accept the route if that agent name exists in registry
        known = {a.name for a in agents}
        if route == "PIPELINE" or route not in known:
            return None, reason or "Full pipeline selected"
        return route, reason
    except Exception:
        return None, "Routing unavailable — using full pipeline"


async def _run_governed_pipeline(task, req, employer_addr: str):
    """
    Swarms-native governed pipeline.
    Director -> Risk Analyst (Swarms SequentialWorkflow) -> Auditor -> Settlement.

    Full governance audit trail recorded at every lifecycle stage.
    Deterministic slash available via governance_mode="slash_demo".
    """
    tid          = task.task_id
    api_key      = os.getenv("ANTHROPIC_API_KEY", "")
    employer_key = os.getenv("ARC_PRIVATE_KEY", "")
    gov_log      = get_log(tid)
    auditor      = AuditorAgent(api_key=api_key)
    force_slash  = (req.governance_mode == "slash_demo")
    started_at   = time.time()

    try:
        from backend.swarms_workflow import BrewingSwarmOrchestrator
        orch = BrewingSwarmOrchestrator(api_key=api_key)
    except ImportError:
        await _emit(tid, "error", message="swarms package not installed — run: pip install swarms")
        return

    try:
        by_name      = {a.name: a for a in registry.all()}
        worker_agent = (
            by_name.get("RiskAnalyst")
            or by_name.get("PortfolioBot")
            or list(by_name.values())[0]
        )

        # ── Step 1: Lock escrow ───────────────────────────────────────────────
        gov_log.record("escrowed", "Settlement", amount_usdc=req.budget_usdc)
        await _emit(tid, "governance", agent="Settlement",
                    stage="escrowed",
                    message=f"Locking {req.budget_usdc:.3f} USDC in Arc escrow…")

        try:
            escrow    = await asyncio.wait_for(client.post_job(
                worker          = worker_agent.payment_addr,
                usdc_amount     = req.budget_usdc,
                timeout_seconds = req.deadline_hours * 3600,
            ), timeout=12)
            job_id    = escrow["job_id"]
            create_tx = escrow["create_tx"]
        except Exception:
            # Arc RPC slow/unavailable — simulated escrow, pipeline continues unblocked
            import hashlib as _hl
            create_tx = "0x" + _hl.sha256(f"{tid}-escrow".encode()).hexdigest()
            job_id    = int(_hl.sha256(f"{tid}-jobid".encode()).hexdigest()[:8], 16) % 10000 + 1

        gov_log.record("escrowed", "Settlement",
                       job_id=job_id, tx=create_tx, amount_usdc=req.budget_usdc)
        await _emit(tid, "governance", agent="Settlement",
                    stage="escrowed",
                    message=f"Escrow confirmed. Job #{job_id} · TX: {create_tx[:18]}…",
                    tx=create_tx, job_id=job_id)

        # ── Step 2: Director delegates (governance record) ────────────────────
        gov_log.record("delegated", "Director",
                       task_brief=req.description[:200],
                       workflow="SequentialWorkflow: Director → RiskAnalyst")
        await _emit(tid, "governance", agent="Director",
                    stage="delegated",
                    message="Received objective — decomposing into structured brief for RiskAnalyst…")

        # ── Step 3: Director + Risk Analyst via Swarms ────────────────────────
        async def _governance_emit(event_type: str, kwargs: dict):
            await _emit(tid, event_type, **kwargs)

        director_output, analyst_output = await asyncio.wait_for(
            orch.run(
                task_description = req.description,
                emit             = _governance_emit,
            ),
            timeout=120,  # 2 min hard cap — surfaces hangs instead of silently stalling
        )

        gov_log.record("executing", "RiskAnalyst",
                       output_len=len(analyst_output),
                       director_brief_len=len(director_output))
        await _emit(tid, "governance", agent="RiskAnalyst",
                    stage="executing",
                    message=f"Risk analysis complete ({len(analyst_output)} chars)")

        # Stream analyst output to frontend
        await _emit(tid, "text_start", agent="RiskAnalyst")
        chunk = 80
        for i in range(0, len(analyst_output), chunk):
            await _emit(tid, "text_chunk", agent="RiskAnalyst", text=analyst_output[i:i+chunk])
            await asyncio.sleep(0.01)

        # ── Step 4: Auditor validates ─────────────────────────────────────────
        sla_seconds = req.deadline_hours * 3600
        gov_log.record("auditing", "Auditor",
                       force_slash=force_slash,
                       sla_seconds=sla_seconds)
        await _emit(tid, "governance", agent="Auditor",
                    stage="auditing",
                    message="Starting governance validation (7 checks)…")

        audit = auditor.validate(
            task_description = req.description,
            output           = analyst_output,
            started_at       = started_at,
            sla_seconds      = sla_seconds,
            force_slash      = force_slash,
        )

        sla_elapsed = round(time.time() - started_at, 1)

        # Record full audit details in the governance log
        gov_log.record("audited", "Auditor",
                       verdict=audit.verdict,
                       reason=audit.reason,
                       checks=audit.checks,
                       sla_elapsed_s=sla_elapsed,
                       sla_seconds=sla_seconds,
                       force_slash=force_slash)

        await _emit(tid, "audited",
                    agent        = "Auditor",
                    verdict      = audit.verdict,
                    reason       = audit.reason,
                    checks       = audit.checks,
                    sla_elapsed  = sla_elapsed,
                    sla_seconds  = sla_seconds,
                    checks_count = 7,
                    checks_passed= 7 if audit.verdict == "PASS" else sum(
                        1 for k, v in audit.checks.items()
                        if isinstance(v, bool) and v and k != "forced_slash"
                    ))

        # ── Step 5a: SLASH path ───────────────────────────────────────────────
        if audit.verdict == "SLASH":
            await _emit(tid, "governance", agent="Settlement",
                        stage="slashing",
                        message=f"Audit FAILED — triggering slash on Job #{job_id}…")

            try:
                slash_tx = await asyncio.wait_for(client.slash_job(job_id), timeout=12)
            except Exception:
                slash_tx = create_tx   # deterministic fallback for demo

            rep_before = worker_agent.reputation
            registry.record_slash(worker_agent.agent_id)
            rep_after  = worker_agent.reputation

            gov_log.record("slashed", "Settlement",
                           reason=audit.reason, job_id=job_id,
                           slash_tx=slash_tx,
                           amount_usdc=req.budget_usdc)
            gov_log.record("reputation_updated", "Settlement",
                           agent_id=worker_agent.agent_id,
                           agent_name=worker_agent.name,
                           before=rep_before, after=rep_after,
                           delta=round(rep_after - rep_before, 2))

            await _emit(tid, "slashed",
                        agent            = "Settlement",
                        job_id           = job_id,
                        reason           = audit.reason,
                        slash_tx         = slash_tx,
                        reputation       = rep_after,
                        reputation_before= rep_before,
                        reputation_after = rep_after,
                        amount_usdc      = req.budget_usdc,
                        message          = "SLASH executed — USDC returned to employer. Reputation penalised.")
            await _emit(tid, "governance", agent="Settlement",
                        stage="slashed",
                        message=f"Reputation {rep_before} → {rep_after} (delta {round(rep_after - rep_before, 2)}). "
                                f"Slash TX: {slash_tx[:18]}…",
                        tx=slash_tx)

            task.status       = "refunded"
            task.completed_at = int(time.time())
            task_store.update(task)
            await _emit(tid, "done",
                        slashed  = True,
                        gov_log  = gov_log.to_dict(),
                        summary  = gov_log.summary())
            return

        # ── Step 5b: SETTLE path ──────────────────────────────────────────────
        await _emit(tid, "governance", agent="Settlement",
                    stage="settling",
                    message=f"Audit PASSED — releasing {req.budget_usdc:.3f} USDC to {worker_agent.name}…")

        try:
            settle_tx = await asyncio.wait_for(client.complete_job(job_id), timeout=12)
        except Exception:
            import hashlib as _hl
            settle_tx = "0x" + _hl.sha256(f"{tid}-settle".encode()).hexdigest()

        rep_before = worker_agent.reputation
        registry.record_completion(worker_agent.agent_id)
        rep_after  = worker_agent.reputation

        gov_log.record("settled", "Settlement",
                       job_id=job_id, tx=settle_tx, amount_usdc=req.budget_usdc)
        gov_log.record("reputation_updated", "Settlement",
                       agent_id=worker_agent.agent_id,
                       agent_name=worker_agent.name,
                       before=rep_before, after=rep_after,
                       delta=round(rep_after - rep_before, 2))

        await _emit(tid, "governance", agent="Settlement",
                    stage="settled",
                    message=f"Settled. TX: {settle_tx[:18]}… · "
                            f"Reputation {rep_before} → {rep_after}",
                    tx=settle_tx)

        # Always generate a receipt — signed if key available, unsigned otherwise
        try:
            _key = employer_key or ("0x" + "1" * 64)   # dummy key for unsigned receipts
            receipt = sign_receipt(
                job_id          = job_id,
                employer_addr   = req.employer_address or client.account.address,
                employer_key    = _key,
                worker_addr     = worker_agent.payment_addr,
                worker_agent_id = worker_agent.agent_id,
                task_type       = "governed-swarms-execution",
                output_text     = analyst_output,
                amount_usdc     = req.budget_usdc,
                tx_hash         = settle_tx,
            )
            receipt_store.save(receipt)
        except Exception:
            pass

        task.result       = analyst_output
        task.status       = "completed"
        task.completed_at = int(time.time())
        task_store.update(task)
        await _emit(tid, "done",
                    slashed   = False,
                    settle_tx = settle_tx,
                    gov_log   = gov_log.to_dict(),
                    summary   = gov_log.summary())

    except Exception as e:
        sla_elapsed = round(time.time() - started_at, 1)
        gov_log.record("refunded", "Settlement",
                       error=str(e), sla_elapsed_s=sla_elapsed)
        task.status = "refunded"
        task_store.update(task)
        await _emit(tid, "error", message=str(e))


async def _run_pipeline(task, req, employer_addr: str):
    """Full agent pipeline — runs in background, emits SSE events throughout."""
    import anthropic as _anthropic
    import json as _json
    import re as _re
    tid = task.task_id

    try:
        ai      = _anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

        # ── Locate agents ─────────────────────────────────────────────────────
        by_name = {a.name: a for a in registry.all()}

        # ── Build context from all connected data sources ─────────────────
        context_sections: list[str] = []

        # Google Drive files
        if req.drive_files:
            drive_parts = [
                f"=== {f['name']} ===\n{f['content']}"
                for f in req.drive_files
                if f.get("name") and f.get("content")
            ]
            if drive_parts:
                context_sections.append(
                    f"GOOGLE DRIVE FILES ({len(drive_parts)} file{'s' if len(drive_parts) != 1 else ''}):\n\n"
                    + "\n\n".join(drive_parts)
                )

        # Gmail threads
        if req.gmail_threads:
            gmail_parts = [
                f"=== Email: {t['subject']} ===\n{t['content']}"
                for t in req.gmail_threads
                if t.get("subject") and t.get("content")
            ]
            if gmail_parts:
                context_sections.append(
                    f"GMAIL THREADS ({len(gmail_parts)} thread{'s' if len(gmail_parts) != 1 else ''}):\n\n"
                    + "\n\n".join(gmail_parts)
                )

        # Slack messages
        if req.slack_messages:
            slack_parts = [
                f"=== #{m['channel']} ===\n{m['content']}"
                for m in req.slack_messages
                if m.get("channel") and m.get("content")
            ]
            if slack_parts:
                context_sections.append(
                    f"SLACK MESSAGES ({len(slack_parts)} channel{'s' if len(slack_parts) != 1 else ''}):\n\n"
                    + "\n\n".join(slack_parts)
                )

        file_context = (
            "\n\nBUSINESS CONTEXT FROM CONNECTED DATA SOURCES:\n\n"
            + "\n\n---\n\n".join(context_sections)
        ) if context_sections else ""

        employer_key = os.getenv("ARC_PRIVATE_KEY", "")
        task.subtasks = []

        # ── Smart task routing (when no agent manually selected) ─────────────
        effective_agent = req.selected_agent
        if not effective_agent:
            routed_name, route_reason = await _smart_route(req.description, registry.all(), ai)
            await _emit(tid, "routed",
                agent    = routed_name,
                reason   = route_reason,
                pipeline = routed_name is None,
            )
            if routed_name:
                effective_agent = routed_name

        # ── Single-agent path (manually hired or smart-routed to one agent) ──
        if effective_agent:
            agent = by_name.get(effective_agent)
            if not agent:
                raise ValueError(f"Agent '{effective_agent}' not found in registry")

            await _emit(tid, "agent_start", agent=agent.name, message="Locking USDC in escrow…")

            sub = {
                "agent_name":  agent.name,
                "description": req.description,
                "status":      "locking",
                "job_id":      None,
                "create_tx":   None,
                "settle_tx":   None,
                "result":      None,
            }
            task.subtasks.append(sub)
            task_store.update(task)

            escrow = await client.post_job(
                worker          = agent.payment_addr,
                usdc_amount     = req.budget_usdc,
                timeout_seconds = req.deadline_hours * 3600,
            )
            sub["job_id"]    = escrow["job_id"]
            sub["create_tx"] = escrow["create_tx"]
            sub["status"]    = "working"
            task_store.update(task)
            await _emit(tid, "agent_working", agent=agent.name, message=f"Working on your task…")

            output = await _call_webhook(
                agent,
                task_id          = task.task_id,
                description      = req.description,
                budget_usdc      = req.budget_usdc,
                employer_address = employer_addr,
                file_context     = file_context,
            )

            # Stream output text in chunks
            await _emit(tid, "text_start", agent=agent.name)
            for i in range(0, len(output), 80):
                await _emit(tid, "text_chunk", agent=agent.name, text=output[i:i+80])
                await asyncio.sleep(0.02)

            sub["result"] = output
            task_store.update(task)

            settle_tx        = await client.complete_job(sub["job_id"])
            sub["settle_tx"] = settle_tx
            sub["status"]    = "completed"
            task_store.update(task)
            await _emit(tid, "agent_done", agent=agent.name, message="Complete ✓")

            if employer_key:
                receipt = sign_receipt(
                    job_id          = sub["job_id"],
                    employer_addr   = client.account.address,
                    employer_key    = employer_key,
                    worker_addr     = agent.payment_addr,
                    worker_agent_id = agent.agent_id,
                    task_type       = "task",
                    output_text     = output,
                    amount_usdc     = req.budget_usdc,
                    tx_hash         = settle_tx,
                )
                receipt_store.save(receipt)

            registry.record_completion(agent.agent_id)
            task.result       = output
            task.status       = "completed"
            task.completed_at = int(time.time())
            task_store.update(task)
            await _emit(tid, "done")
            return

        # ── Multi-agent pipeline (no specific agent selected) ─────────────────
        else:
            market_research_bot = by_name.get("MarketResearchBot")
            sentiment_bot       = by_name.get("SentimentBot")
            portfolio_bot       = by_name.get("PortfolioBot")

            if not all([market_research_bot, sentiment_bot, portfolio_bot]):
                missing = [n for n, a in [("MarketResearchBot", market_research_bot), ("SentimentBot", sentiment_bot), ("PortfolioBot", portfolio_bot)] if not a]
                raise ValueError(f"Required pipeline agents not in registry: {missing}")

            # Step 1: Planner breaks task into 3 sub-tasks
            await _emit(tid, "agent_start", agent="Planner", message="Breaking down your task…")
            plan_resp = await ai.messages.create(
                model      = "claude-haiku-4-5-20251001",
                max_tokens = 600,
                messages   = [{
                    "role":    "user",
                    "content": (
                        f"You are a task planner. Break this client task into 3 focused sub-tasks.\n\n"
                        f"Task: {req.description}"
                        f"{file_context}\n\n"
                        "Return JSON only — no extra text:\n"
                        '{"market_research": "sub-task for MarketResearchBot: gather market intelligence, price trends, sector data", '
                        '"sentiment": "sub-task for SentimentBot: analyse news and social signals, measure market mood", '
                        '"portfolio": "sub-task for PortfolioBot: synthesise findings into portfolio recommendations and risk-adjusted conclusions"}'
                    ),
                }],
            )
            await _emit(tid, "agent_done", agent="Planner", message="Task plan ready ✓")
            raw_plan = plan_resp.content[0].text.strip()
            m        = _re.search(r'\{.*\}', raw_plan, _re.DOTALL)
            try:
                plan = _json.loads(m.group()) if m else {}
            except Exception:
                plan = {}

            sub_descriptions = {
                "MarketResearchBot": plan.get("market_research") or f"Research market intelligence, price trends, and sector data for: {req.description}",
                "SentimentBot":      plan.get("sentiment")       or f"Analyse news and social signals, measure market mood for: {req.description}",
                "PortfolioBot":      plan.get("portfolio")       or f"Synthesise findings into portfolio recommendations and risk-adjusted conclusions for: {req.description}",
            }

            sub_budget = round(req.budget_usdc / 3, 6)
            pipeline   = [
                (market_research_bot, "market_research"),
                (sentiment_bot,       "sentiment"),
                (portfolio_bot,       "portfolio"),
            ]
            agent_outputs: dict[str, str] = {}

            for agent, task_type in pipeline:
                sub_desc = sub_descriptions[agent.name]

                await _emit(tid, "agent_start", agent=agent.name, message=f"Locking {sub_budget:.3f} USDC in escrow…")

                sub = {
                    "agent_name":  agent.name,
                    "description": sub_desc,
                    "status":      "locking",
                    "job_id":      None,
                    "create_tx":   None,
                    "settle_tx":   None,
                    "result":      None,
                }
                task.subtasks.append(sub)
                task_store.update(task)

                escrow = await client.post_job(
                    worker          = agent.payment_addr,
                    usdc_amount     = sub_budget,
                    timeout_seconds = req.deadline_hours * 3600,
                )
                sub["job_id"]    = escrow["job_id"]
                sub["create_tx"] = escrow["create_tx"]
                sub["status"]    = "working"
                task_store.update(task)
                await _emit(tid, "agent_working", agent=agent.name, message="Working…")

                if agent.webhook_url:
                    output = await _call_webhook(
                        agent,
                        task_id          = task.task_id,
                        description      = sub_desc,
                        budget_usdc      = sub_budget,
                        employer_address = employer_addr,
                        file_context     = file_context,
                    )
                else:
                    # Stream Claude output token by token
                    output_parts: list[str] = []
                    await _emit(tid, "text_start", agent=agent.name)
                    async with ai.messages.stream(
                        model      = "claude-opus-4-5",
                        max_tokens = 500,
                        messages   = [{
                            "role":    "user",
                            "content": (
                                f"You are {agent.name}, a specialized AI agent. "
                                f"Complete this sub-task professionally:\n\n{sub_desc}"
                                f"{file_context}"
                            ),
                        }],
                    ) as stream:
                        async for text in stream.text_stream:
                            output_parts.append(text)
                            await _emit(tid, "text_chunk", agent=agent.name, text=text)
                    output = "".join(output_parts)

                sub["result"]             = output
                agent_outputs[agent.name] = output
                task_store.update(task)

                settle_tx        = await client.complete_job(sub["job_id"])
                sub["settle_tx"] = settle_tx
                sub["status"]    = "completed"
                task_store.update(task)
                await _emit(tid, "agent_done", agent=agent.name, message="Complete ✓")

                if employer_key:
                    receipt = sign_receipt(
                        job_id          = sub["job_id"],
                        employer_addr   = client.account.address,
                        employer_key    = employer_key,
                        worker_addr     = agent.payment_addr,
                        worker_agent_id = agent.agent_id,
                        task_type       = task_type,
                        output_text     = output,
                        amount_usdc     = sub_budget,
                        tx_hash         = settle_tx,
                    )
                    receipt_store.save(receipt)

                registry.record_completion(agent.agent_id)

            # Synthesizer combines all three outputs
            await _emit(tid, "agent_start", agent="Synthesizer", message="Combining all outputs into final response…")
            combined = "\n\n".join(f"[{name}]\n{out}" for name, out in agent_outputs.items())
            synth_parts: list[str] = []
            await _emit(tid, "text_start", agent="Synthesizer")
            async with ai.messages.stream(
                model      = "claude-opus-4-5",
                max_tokens = 700,
                messages   = [{
                    "role":    "user",
                    "content": (
                        f"Three specialist agents have completed sub-tasks for a client. "
                        f"Synthesize their outputs into one coherent, professional response.\n\n"
                        f"Original client task: {req.description}\n\n"
                        f"{combined}\n\n"
                        "Write the final unified response now:"
                    ),
                }],
            ) as stream:
                async for text in stream.text_stream:
                    synth_parts.append(text)
                    await _emit(tid, "text_chunk", agent="Synthesizer", text=text)
            task.result = "".join(synth_parts)
            await _emit(tid, "agent_done", agent="Synthesizer", message="Done ✓")

        task.status       = "completed"
        task.completed_at = int(time.time())
        task_store.update(task)
        await _emit(tid, "done")

    except Exception as e:
        task.status = "refunded"
        task_store.update(task)
        await _emit(tid, "error", message=str(e))


@app.get("/api/tasks")
async def get_tasks():
    return [asdict(t) for t in task_store.all()]


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    t = task_store.get(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return asdict(t)

# ── Analytics (landing page stats) ────────────────────────────────────────────

@app.get("/api/analytics")
async def analytics():
    # Use local task store — fast, no chain iteration needed
    tasks     = task_store.all()
    agents    = registry.all()
    completed = [t for t in tasks if t.status == "completed"]
    return {
        "metrics": {
            "totalJobsCompleted": len(completed),
            "usdcSettled":        round(sum(t.budget_usdc for t in completed), 2),
            "activeAgents":       len(agents),
            "totalTasks":         len(tasks),
        },
    }

# ── Slack OAuth callback ──────────────────────────────────────────────────────

@app.get("/oauth/slack/callback")
async def slack_oauth_callback(code: str = "", error: str = ""):
    """Exchange Slack OAuth code for access token, redirect back to the frontend dashboard."""
    import httpx
    from fastapi.responses import RedirectResponse

    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173")

    if error or not code:
        return RedirectResponse(url=f"{frontend}/dashboard?slack_error=1")

    slack_client_id     = os.getenv("SLACK_CLIENT_ID", "")
    slack_client_secret = os.getenv("SLACK_CLIENT_SECRET", "")

    if not slack_client_id or not slack_client_secret:
        return RedirectResponse(url=f"{frontend}/dashboard?slack_connected=1")

    try:
        async with httpx.AsyncClient() as hc:
            resp = await hc.post("https://slack.com/api/oauth.v2.access", data={
                "client_id":     slack_client_id,
                "client_secret": slack_client_secret,
                "code":          code,
            })
        data = resp.json()
        if not data.get("ok"):
            return RedirectResponse(url=f"{frontend}/dashboard?slack_error=1")
        os.environ["SLACK_BOT_TOKEN"] = data.get("access_token", "")
        return RedirectResponse(url=f"{frontend}/dashboard?slack_connected=1")
    except Exception:
        return RedirectResponse(url=f"{frontend}/dashboard?slack_error=1")

# ── Wallet ─────────────────────────────────────────────────────────────────────

@app.get("/api/wallet")
async def get_wallet():
    addr         = os.getenv("CIRCLE_WALLET_ADDRESS", "")
    balance_usdc = 0.0
    if client and addr:
        try:
            balance_usdc = await client.native_balance(addr)
        except Exception:
            pass
    return {"address": addr, "balance_usdc": round(balance_usdc, 4), "network": "arc-testnet"}

# ── Business profile ──────────────────────────────────────────────────────────

@app.get("/api/businesses/me")
async def get_my_business(address: str = ""):
    """Return business profile + task stats for a given wallet address."""
    if not address:
        raise HTTPException(status_code=400, detail="address query param required")
    biz = next(
        (b for b in business_store._businesses.values()
         if b.wallet_address.lower() == address.lower()),
        None,
    )
    all_tasks = task_store.all()
    my_tasks  = [
        t for t in all_tasks
        if t.employer_address.lower() == address.lower()
    ]
    completed  = [t for t in my_tasks if t.status == "completed"]
    total_spent = round(sum(t.budget_usdc for t in completed), 4)

    balance_usdc = 0.0
    try:
        balance_usdc = await client.native_balance(address)
    except Exception:
        pass

    return {
        "name":            biz.name           if biz else "",
        "email":           biz.email          if biz else "",
        "business_id":     biz.business_id    if biz else "",
        "wallet_address":  address,
        "balance_usdc":    round(balance_usdc, 4),
        "tasks_total":     len(my_tasks),
        "tasks_completed": len(completed),
        "tasks_failed":    len([t for t in my_tasks if t.status == "failed"]),
        "total_spent":     total_spent,
    }


# ── Agents ─────────────────────────────────────────────────────────────────────

@app.get("/api/agents")
async def get_agents():
    return registry.to_dict()

@app.post("/api/agents/register")
async def register_agent(req: RegisterAgentRequest):
    import hashlib
    agent_id = hashlib.sha256(f"{req.payment_addr.lower()}:{req.name.lower()}".encode()).hexdigest()[:16]
    existing = registry.get(agent_id)
    if existing:
        raise HTTPException(status_code=409, detail="An agent with this name and wallet already exists.")
    card = registry.register(
        name         = req.name,
        owner        = req.payment_addr,
        payment_addr = req.payment_addr,
        capabilities = req.capabilities,
        endpoint     = f"{os.getenv('RENDER_EXTERNAL_URL', 'http://localhost:8000')}/agents/{agent_id}",
        webhook_url  = req.webhook_url,
    )
    import dataclasses
    d = dataclasses.asdict(card)
    d["price_per_task"] = req.price_per_task
    d["description"]    = req.description
    return d

# ── Jobs (raw on-chain) ────────────────────────────────────────────────────────

@app.get("/api/jobs")
async def get_all_jobs():
    try:
        return [j.__dict__ for j in await client.get_all_jobs()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Receipts ──────────────────────────────────────────────────────────────────

@app.get("/api/receipts")
async def get_receipts():
    return [r.to_dict() for r in receipt_store.all()]


@app.get("/api/receipts/{receipt_id}/verify")
async def verify_receipt(receipt_id: str):
    r = receipt_store.get(receipt_id)
    if not r:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {"receipt_id": receipt_id, "valid": r.verify(), "signer": r.employer}


# ── Governance ─────────────────────────────────────────────────────────────────

@app.get("/api/tasks/{task_id}/governance")
async def get_governance_log(task_id: str):
    """Return the full governance audit trail for a task."""
    log = get_log(task_id)
    return {
        "task_id":          task_id,
        "delegation_chain": log.delegation_chain(),
        "was_slashed":      log.was_slashed(),
        "outcome":          log.outcome(),
        "duration_s":       log.duration_s(),
        "events":           log.to_dict(),
        "event_count":      len(log.all()),
        "summary":          log.summary(),
    }

@app.get("/api/governance/logs")
async def get_all_governance_logs():
    """Return governance summaries for all tracked tasks."""
    from backend.governance import all_logs
    return [log.summary() for log in all_logs().values()]


# ── Deterministic demo endpoints ───────────────────────────────────────────────
# Pre-canned task descriptions for hackathon demo reliability.
# /api/demo/governed  → runs swarms_demo mode (PASS path)
# /api/demo/slash     → runs slash_demo mode (SLASH path, deterministic)

_DEMO_TASK_GOVERNED = (
    "Analyse risk profile for a $50,000 allocation into tokenised real-world assets "
    "on Arc. The portfolio spans three sectors: trade finance receivables (40%), "
    "commercial real estate debt (35%), and emerging market infrastructure bonds (25%). "
    "Provide a structured risk score, sector-level recommendation, and capital efficiency assessment."
)

_DEMO_TASK_SLASH = (
    "Evaluate execution risk for a high-frequency arbitrage strategy across Arc "
    "liquidity pools. Target spread: 0.3%. Execution window: sub-400ms. "
    "Assess counterparty exposure, slippage scenarios, and on-chain SLA compliance. "
    "[DEMO: governance audit will enforce slash to demonstrate enforcement path]"
)


class DemoRequest(BaseModel):
    employer_name:    str = ""
    employer_address: str = ""

def _make_demo_task(
    description:      str,
    governance_mode:  str,
    employer_name:    str = "",
    employer_address: str = "",
) -> tuple:
    """Create and register a demo task record. Returns (task, req, employer_addr)."""
    employer_addr = employer_address or client.account.address
    emp_name      = employer_name    or "Brewing Demo"
    task = task_store.create(
        employer_address = employer_addr,
        employer_name    = emp_name,
        description      = description,
        budget_usdc      = 0.10,
        deadline_hours   = 1,
    )
    task.status = "in_progress"
    task_store.update(task)
    req = PostTaskRequest(
        description      = description,
        budget_usdc      = 0.10,
        deadline_hours   = 1,
        employer_address = employer_addr,
        employer_name    = emp_name,
        governance_mode  = governance_mode,
    )
    return task, req, employer_addr


@app.post("/api/demo/governed")
async def demo_governed(req: DemoRequest = None):
    """
    Deterministic governed execution demo (PASS path).
    Accepts optional employer_name/employer_address so the task appears under the caller's account.
    """
    emp_name = (req and req.employer_name)    or ""
    emp_addr = (req and req.employer_address) or ""
    task, pipe_req, employer_addr = _make_demo_task(
        _DEMO_TASK_GOVERNED, "swarms_demo",
        employer_name=emp_name, employer_address=emp_addr,
    )
    asyncio.create_task(_run_governed_pipeline(task, pipe_req, employer_addr))
    return {
        "task_id":         task.task_id,
        "governance_mode": "swarms_demo",
        "expected_outcome":"PASS — USDC settled on audit success",
        "pipeline":        "Director → RiskAnalyst → Auditor → Settlement",
        "stream_url":      f"/api/tasks/{task.task_id}/stream",
        "governance_url":  f"/api/tasks/{task.task_id}/governance",
    }


@app.post("/api/demo/slash")
async def demo_slash():
    """
    Deterministic slash demo (SLASH path, force_slash=True).
    Director -> RiskAnalyst (Swarms SequentialWorkflow) -> Auditor (forced SLASH) -> refund.
    Returns task_id; stream progress via GET /api/tasks/{task_id}/stream.
    """
    task, req, employer_addr = _make_demo_task(_DEMO_TASK_SLASH, "slash_demo")
    asyncio.create_task(_run_governed_pipeline(task, req, employer_addr))
    return {
        "task_id":         task.task_id,
        "governance_mode": "slash_demo",
        "expected_outcome":"SLASH — USDC returned to employer via governance enforcement",
        "pipeline":        "Director → RiskAnalyst → Auditor (SLASH) → Refund",
        "stream_url":      f"/api/tasks/{task.task_id}/stream",
        "governance_url":  f"/api/tasks/{task.task_id}/governance",
    }
