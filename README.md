# Brewing

**Governed coordination and settlement infrastructure for autonomous systems.**

Brewing is the enforcement layer that makes autonomous agent coordination safe enough to run at scale. Every task is escrowed before execution begins. Every output is validated by an Auditor before payment moves. If validation fails, the escrow slashes — USDC returns to the employer, agent reputation is penalised on-chain.

Built for the Swarms Hackathon. Powered by [Swarms](https://github.com/kyegomez/swarms).

---

## Live

| | |
|---|---|
| Frontend | https://brewing-swarms.vercel.app |
| API | https://brewing-swarms-api.onrender.com |
| Contract | [`0x584164ce429991C30B5c83D5774d0870A77F5A22`](https://testnet.arcscan.app/address/0x584164ce429991C30B5c83D5774d0870A77F5A22) on Arc Testnet |

---

## Demo Endpoints

Two deterministic execution paths. Call them and watch the governance flow.

**Governed execution — PASS path:**
```bash
curl -X POST https://brewing-swarms-api.onrender.com/api/demo/governed
```
Director structures the task → RiskAnalyst executes via Swarms SequentialWorkflow → Auditor validates (7 checks) → USDC settles to worker on Arc.

**Slash demo — deterministic SLASH:**
```bash
curl -X POST https://brewing-swarms-api.onrender.com/api/demo/slash
```
Same pipeline. Auditor rejects. Escrow slashes. USDC returns to employer. Reputation penalised.

**Stream live governance events:**
```bash
curl -N https://brewing-swarms-api.onrender.com/api/tasks/{task_id}/stream
```

**Full audit trail:**
```bash
curl https://brewing-swarms-api.onrender.com/api/tasks/{task_id}/governance
```

---

## How It Works

```
POST /api/tasks  (governance_mode: swarms_demo | slash_demo)
     │
     ├─ 1. ESCROW       USDC locked in AgentEscrow before any work begins
     │
     ├─ 2. DELEGATION   Swarms SequentialWorkflow
     │      Director Agent (claude-haiku)    → structures task brief
     │      RiskAnalyst Agent (claude-opus)  → executes analysis
     │
     ├─ 3. AUDIT        AuditorAgent — 7 checks
     │      SLA compliance · non-empty output · structured JSON
     │      required fields · risk_score range · reasoning depth · LLM quality
     │
     ├─ PASS  →  complete_job()  →  USDC released to worker
     └─ SLASH →  slash_job()    →  USDC returned to employer · reputation penalised
```

Every stage emits typed governance events — streamed in real time over SSE, stored in the per-task `GovernanceLog`.

---

## Swarms Integration

```python
from swarms import Agent
from swarms.structs import SequentialWorkflow

director     = Agent(agent_name="Director",    model_name="claude-haiku-4-5-20251001", ...)
risk_analyst = Agent(agent_name="RiskAnalyst", model_name="claude-opus-4-5", ...)

workflow = SequentialWorkflow(
    agents      = [director, risk_analyst],
    output_type = "str",
    max_loops   = 1,
)
```

Swarms handles the intelligence layer. Brewing wraps it with economic enforcement: escrow lock before the workflow runs, audit validation after it completes, on-chain settlement or slash based on the verdict.

---

## Governance Events

Every governed task produces an append-only audit log:

| Event | Agent | Meaning |
|---|---|---|
| `escrowed` | Settlement | USDC locked before work begins |
| `delegated` | Director | Task brief structured and delegated |
| `executing` | RiskAnalyst | Swarms workflow complete |
| `auditing` | Auditor | 7-check validation starting |
| `audited` | Auditor | PASS or SLASH verdict |
| `settled` | Settlement | USDC released to worker |
| `slashed` | Settlement | USDC returned to employer |
| `reputation_updated` | Settlement | Agent score updated |

See [SYSTEM_LOGS.md](./SYSTEM_LOGS.md) for full execution traces.

---

## Stack

| Layer | Technology |
|---|---|
| Agent orchestration | Swarms SequentialWorkflow |
| AI models | claude-haiku-4-5 (Director), claude-opus-4-5 (RiskAnalyst, Auditor) |
| Escrow contract | Vyper 0.4.0 — AgentEscrow on Arc L1 |
| Settlement chain | Arc Testnet — EVM, USDC native gas, ~$0.01/tx |
| Agent custody | Circle Developer-Controlled Wallets (MPC) |
| Backend | FastAPI — async SSE streaming |
| Frontend | React + Vite + Tailwind |

---

## On-Chain Contracts

| Contract | Address | Network |
|---|---|---|
| AgentEscrow | `0x584164ce429991C30B5c83D5774d0870A77F5A22` | Arc Testnet |
| USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | Arc Testnet |

Arc Testnet — Chain ID 5042002 — RPC `https://rpc-arc-testnet.circle.com`

---

*Built for the Swarms Hackathon · May 2026*
*Arc Testnet · Circle Developer-Controlled Wallets · Swarms SequentialWorkflow*
