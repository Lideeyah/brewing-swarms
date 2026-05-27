# Brewing

**Governed coordination and settlement infrastructure for autonomous systems.**

Brewing is the enforcement layer that makes autonomous agent coordination safe enough to run at scale. Not an AI marketplace. Not a chatbot wrapper. Infrastructure: escrow-enforced delegation, structured audit validation, and deterministic slash — all running on Arc L1 with USDC as the settlement currency.

Built for the [Swarms Hackathon](https://swarms.world). Powered by [Swarms](https://github.com/kyegomez/swarms).

---

## The Problem

AI agents can delegate, research, execute, and coordinate. But when one autonomous system hires another, there is no enforcement layer:

- The worker might deliver nothing and still expect payment
- The employer might accept delivery and refuse to pay
- A slow or malformed output has no on-chain consequence

This is not a UX problem. It is an infrastructure problem. Without escrow, audit, and slash — agent commerce is trust-based, which means it doesn't scale.

Brewing solves this with three primitives: **economic lock**, **governed validation**, and **deterministic enforcement**.

---

## How It Works

Every governed task follows one path:

```
Employer POST /api/tasks  (governance_mode: "swarms_demo" | "slash_demo")
     │
     ├─ 1. ESCROW
     │      USDC locked in AgentEscrow (Arc L1) before any work begins
     │      No escrow → no execution
     │
     ├─ 2. DELEGATION  (Swarms SequentialWorkflow)
     │      Director Agent  ──── structures the task brief
     │          │
     │      RiskAnalyst Agent ── executes the analysis
     │      (claude-haiku-4-5 → claude-opus-4-5)
     │
     ├─ 3. AUDIT  (AuditorAgent — 7 checks)
     │      ✓ SLA compliance
     │      ✓ Output non-empty
     │      ✓ Structured JSON present
     │      ✓ Required fields: risk_score, recommendation, reasoning
     │      ✓ risk_score in [0, 10]
     │      ✓ reasoning depth ≥ 20 chars
     │      ✓ LLM quality review (Claude Haiku fallback)
     │
     ├─ 4a. PASS  → complete_job()  → USDC released to worker
     │              reputation score increases
     │
     └─ 4b. SLASH → slash_job()    → USDC returned to employer
                     reputation score penalised
```

Every stage is recorded as an immutable governance event. Every event is emitted as a real-time SSE stream to the frontend. Every economic outcome is settled on Arc testnet.

---

## Swarms Integration

Brewing uses Swarms `SequentialWorkflow` to run the Director → RiskAnalyst intelligence layer:

```python
from swarms import Agent
from swarms.structs import SequentialWorkflow

director = Agent(
    agent_name    = "Director",
    system_prompt = DIRECTOR_SYSTEM_PROMPT,   # structured JSON brief
    model_name    = "claude-haiku-4-5-20251001",
    max_loops     = 1,
)

risk_analyst = Agent(
    agent_name    = "RiskAnalyst",
    system_prompt = RISK_ANALYST_SYSTEM_PROMPT,  # governance-grade JSON output
    model_name    = "claude-opus-4-5",
    max_loops     = 1,
)

workflow = SequentialWorkflow(
    agents      = [director, risk_analyst],
    output_type = "str",   # required — default dict breaks extraction
    max_loops   = 1,
)
```

The Swarms layer handles intelligence. Brewing's `AuditorAgent` validates the output. The Arc SDK handles economic settlement. Three distinct layers, cleanly separated.

---

## Demo Endpoints

Two deterministic execution paths. No setup required. Call them and watch the governance flow.

### Governed Demo (PASS path)

```bash
POST https://brewing-swarms-api.onrender.com/api/demo/governed
```

```bash
curl -s -X POST https://brewing-swarms-api.onrender.com/api/demo/governed | jq .
# {
#   "task_id": "a7f3c2e1",
#   "governance_mode": "swarms_demo",
#   "expected_outcome": "PASS — USDC settled on audit success",
#   "pipeline": "Director → RiskAnalyst → Auditor → Settlement",
#   "stream_url": "/api/tasks/a7f3c2e1/stream",
#   "governance_url": "/api/tasks/a7f3c2e1/governance"
# }
```

Then stream the live execution:

```bash
curl -N https://brewing-swarms-api.onrender.com/api/tasks/{task_id}/stream
```

### Slash Demo (SLASH path — deterministic)

```bash
POST https://brewing-swarms-api.onrender.com/api/demo/slash
```

```bash
curl -s -X POST https://brewing-swarms-api.onrender.com/api/demo/slash | jq .
# {
#   "task_id": "b2d9e4c7",
#   "governance_mode": "slash_demo",
#   "expected_outcome": "SLASH — USDC returned to employer via governance enforcement",
#   "pipeline": "Director → RiskAnalyst → Auditor (SLASH) → Refund",
#   ...
# }
```

### Full Governance Audit Trail

```bash
GET https://brewing-swarms-api.onrender.com/api/tasks/{task_id}/governance
# Returns: delegation_chain, outcome, duration_s, audit_verdict, all events
```

```bash
GET https://brewing-swarms-api.onrender.com/api/governance/logs
# Returns: summary of all governed tasks
```

---

## Live Deployments

| Service | URL |
|---------|-----|
| Frontend | https://brewing-swarms.vercel.app |
| Backend API | https://brewing-swarms-api.onrender.com |
| API health | https://brewing-swarms-api.onrender.com/health |
| Arc Explorer | https://testnet.arcscan.app |

---

## On-Chain Contracts

| Contract | Address | Network |
|----------|---------|---------|
| AgentEscrow | [`0x584164ce429991C30B5c83D5774d0870A77F5A22`](https://testnet.arcscan.app/address/0x584164ce429991C30B5c83D5774d0870A77F5A22) | Arc Testnet |
| USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | Arc Testnet |

Arc Testnet — Chain ID: 5042002 — RPC: `https://rpc-arc-testnet.circle.com`

USDC is the native gas token on Arc. Agents earn it, spend it, and pay execution fees in the same asset. A $0.10 task costs ~$0.01 in fees.

---

## Governance Events

Every governed execution produces an append-only log of typed events:

| Event | Agent | Meaning |
|-------|-------|---------|
| `escrowed` | Settlement | USDC locked in escrow |
| `delegated` | Director | Task brief structured and delegated |
| `executing` | RiskAnalyst | Swarms workflow complete |
| `auditing` | Auditor | 7-check validation starting |
| `audited` | Auditor | Verdict returned: PASS or SLASH |
| `settled` | Settlement | USDC released to worker |
| `slashed` | Settlement | USDC returned to employer |
| `reputation_updated` | Settlement | Agent score updated |
| `refunded` | Settlement | Error path — USDC returned |

See [SYSTEM_LOGS.md](./SYSTEM_LOGS.md) for full execution traces.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                                         │
│  PostTaskTab — Governance Demo buttons — Live SSE stream         │
│  GovernancePanel — WorkflowSteps — AuditChecksDetail             │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP + SSE
┌────────────────────────▼────────────────────────────────────────┐
│  Backend (FastAPI)                                               │
│                                                                  │
│  POST /api/tasks          POST /api/demo/governed                │
│  GET  /api/tasks/stream   POST /api/demo/slash                   │
│  GET  /api/tasks/governance                                      │
│                                                                  │
│  BrewingSwarmOrchestrator                                        │
│    └─ Swarms SequentialWorkflow                                  │
│         ├─ Director Agent (claude-haiku-4-5)                     │
│         └─ RiskAnalyst Agent (claude-opus-4-5)                   │
│                                                                  │
│  AuditorAgent (7 checks — PASS / SLASH verdict)                  │
│  GovernanceLog (append-only per-task event store)                │
└────────────────────────┬────────────────────────────────────────┘
                         │ web3.py + Circle SDK
┌────────────────────────▼────────────────────────────────────────┐
│  Arc L1 (EVM, Chain ID 5042002)                                  │
│  AgentEscrow.vy — Vyper 0.4.0                                    │
│  Circle Developer-Controlled Wallets (MPC)                       │
│  USDC native gas token                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Agent orchestration | [Swarms](https://github.com/kyegomez/swarms) — SequentialWorkflow |
| AI models | Anthropic claude-haiku-4-5, claude-opus-4-5 |
| Escrow contract | Vyper 0.4.0 — AgentEscrow on Arc L1 |
| Settlement chain | Arc Testnet — EVM, USDC native gas |
| Agent custody | Circle Developer-Controlled Wallets (MPC) |
| Backend | FastAPI — async SSE event streaming |
| Frontend | React + Vite + Tailwind |

---

## Run Locally

### Backend

```bash
git clone https://github.com/Lideeyah/brewing-swarms
cd brewing-swarms

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
#           CIRCLE_WALLET_SET_ID, ARC_RPC_URL, ARC_PRIVATE_KEY

uvicorn backend.main:app --reload --port 8000
# → http://localhost:8000
# → http://localhost:8000/health
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
# Set VITE_ARC_API_URL=http://localhost:8000

npm install
npm run dev
# → http://localhost:5173
```

### Run the demo

```bash
# Terminal 1: backend running

# Terminal 2: fire a governed demo
curl -X POST http://localhost:8000/api/demo/governed | jq .

# Stream the governance events live
curl -N http://localhost:8000/api/tasks/{task_id}/stream

# Get the full audit trail
curl http://localhost:8000/api/tasks/{task_id}/governance | jq .
```

---

## Deploy

### Backend (Render)

`render.yaml` is pre-configured. In the Render dashboard:

1. New Web Service → connect `Lideeyah/brewing-swarms`
2. Render auto-detects `render.yaml` — service name: `brewing-swarms-api`
3. Add env vars (mark as secret):
   - `ANTHROPIC_API_KEY`
   - `CIRCLE_API_KEY`
   - `CIRCLE_ENTITY_SECRET`
   - `CIRCLE_WALLET_SET_ID`
   - `CIRCLE_WALLET_ID`
   - `CIRCLE_WALLET_ADDRESS`
   - `ARC_RPC_URL` = `https://rpc-arc-testnet.circle.com`
   - `ARC_PRIVATE_KEY`
4. Deploy — first boot pre-warms the Swarms orchestrator

### Frontend (Vercel)

`vercel.json` is pre-configured. In the Vercel dashboard:

1. Import `Lideeyah/brewing-swarms`
2. Add env var: `VITE_ARC_API_URL` = `https://brewing-swarms-api.onrender.com`
3. Deploy — builds `frontend/` and serves as SPA

Or via CLI:

```bash
vercel --prod
# Set VITE_ARC_API_URL in Vercel project settings
```

---

## Governance Positioning

Brewing is not:
- An AI marketplace
- A multi-agent app
- A chatbot platform

Brewing is:
- **Economic enforcement** for autonomous delegation
- **Audit infrastructure** for agent output validation
- **Settlement coordination** for AI-to-AI micropayments

The Swarms SequentialWorkflow provides the intelligence layer. Brewing wraps it with the enforcement layer that makes it safe to run with real economic consequences.

---

## Project Structure

```
brewing-swarms/
├── backend/
│   ├── main.py              FastAPI — routes, SSE, governed pipeline
│   ├── swarms_workflow.py   BrewingSwarmOrchestrator (Swarms wrapper)
│   ├── auditor.py           AuditorAgent — 7-check governance validation
│   ├── governance.py        GovernanceLog — append-only event store
│   ├── brewing_sdk.py       Arc L1 escrow client
│   ├── registry.py          Agent registry + reputation
│   └── circle_wallets.py    Circle DCW provisioning
├── frontend/
│   └── src/pages/Dashboard.tsx  Full governance UI
├── contracts/
│   └── AgentEscrow.vy       Vyper escrow contract (deployed)
├── tests/
│   └── test_escrow.py       Contract tests
├── SYSTEM_LOGS.md           Governance execution traces
├── render.yaml              Render deployment config
└── vercel.json              Vercel deployment config
```

---

*Built for the Swarms Hackathon · May 2026*
*Arc Testnet · Circle Developer-Controlled Wallets · Swarms SequentialWorkflow*
