# Brewing — Governance Execution Traces

System logs from the governed autonomous coordination layer.
Every event is recorded in the append-only `GovernanceLog` per task.
Two canonical traces are shown: a successful settlement (PASS) and a slash (SLASH).

---

## Trace A — Governed Execution · PASS path

**Task ID:** `a7f3c2e1`
**Mode:** `swarms_demo`
**Budget:** 0.100 USDC
**Outcome:** SETTLED — 0.100 USDC released to RiskAnalyst

```
[14:02:11] ESCROWED      Settlement    Locking 0.100 USDC in Arc escrow…
                          details: { amount_usdc: 0.1 }

[14:02:12] ESCROWED      Settlement    Escrow confirmed. Job #184 · TX: 0x3a9f1c72b8e4d60a…
                          details: { job_id: 184, tx: "0x3a9f1c72b8e4d60a2c5b8e1d7f9a3c6e", amount_usdc: 0.1 }

[14:02:12] DELEGATED      Director     Received objective — decomposing into structured brief for RiskAnalyst…
                          details: {
                            task_brief: "Analyse risk profile for a $50,000 allocation into tokenised...",
                            workflow: "SequentialWorkflow: Director → RiskAnalyst"
                          }

[14:02:13] GOVERNANCE     Director     Receiving objective and decomposing task brief…
                          stage: delegation

[14:02:13] GOVERNANCE     Director     Structuring governance constraints…
                          stage: delegation

[14:02:17] GOVERNANCE     RiskAnalyst  Structured analysis complete (743 chars)
                          stage: executing

[14:02:17] EXECUTING      RiskAnalyst  Risk analysis complete (743 chars)
                          details: { output_len: 743, director_brief_len: 312 }

[14:02:17] AUDITING       Auditor      Starting governance validation (7 checks)…
                          details: { force_slash: false, sla_seconds: 3600 }

[14:02:17] GOVERNANCE     Auditor      Starting governance validation (7 checks)…
                          stage: auditing

[14:02:18] AUDITED        Auditor      All governance checks passed: structured output validated
                          details: {
                            verdict: "PASS",
                            reason: "All governance checks passed: structured output validated",
                            sla_elapsed_s: 6.3,
                            sla_seconds: 3600,
                            force_slash: false,
                            checks: {
                              sla_met: true,
                              elapsed_s: 6.3,
                              sla_limit_s: 3600,
                              non_empty: true,
                              structured_output: true,
                              required_fields_present: true,
                              valid_risk_score: true,
                              reasoning_depth: true,
                              audit_passed: true
                            }
                          }

[14:02:18] GOVERNANCE     Settlement   Audit PASSED — releasing 0.100 USDC to RiskAnalyst…
                          stage: settling

[14:02:19] SETTLED        Settlement   USDC released to worker
                          details: {
                            job_id: 184,
                            tx: "0xd8c4f1a3e7b290561a4f8c2d9e7b3a05",
                            amount_usdc: 0.1
                          }

[14:02:19] REPUTATION_UPDATED  Settlement  Agent reputation updated
                          details: {
                            agent_id: "b3f9a1c4",
                            agent_name: "RiskAnalyst",
                            before: 8950,
                            after: 9000,
                            delta: 50
                          }

[14:02:19] GOVERNANCE     Settlement   Settled. TX: 0xd8c4f1a3e7b29056… · Reputation 8950 → 9000
                          stage: settled, tx: "0xd8c4f1a3e7b290561a4f8c2d9e7b3a05"
```

**Delegation chain:** `Settlement → Director → RiskAnalyst → Auditor`
**Duration:** 7.8s end-to-end
**Audit checks:** 7 / 7 passed
**SLA elapsed:** 6.3s / 3600s limit

---

### RiskAnalyst Output (passed audit)

```json
{
  "risk_score": 4.2,
  "recommendation": "execute",
  "reasoning": "The proposed allocation into tokenised real-world assets presents moderate risk. Trade finance receivables (40%) carry counterparty and settlement risk mitigated by on-chain escrow enforcement via AgentEscrow. Commercial real estate debt (35%) is sensitive to rate normalisation and liquidity conditions but benefits from collateralisation. Emerging market infrastructure bonds (25%) introduce FX and political risk; position sizing limits downside. Weighted portfolio risk is manageable at the proposed allocation. Recommend execution with a trailing stop at -8% aggregate NAV.",
  "confidence": 0.81,
  "key_factors": [
    "On-chain escrow reduces counterparty exposure",
    "RWA diversification across three uncorrelated sectors",
    "Arc L1 sub-second finality enables rapid position adjustment",
    "Emerging market exposure requires active monitoring"
  ]
}
```

---

## Trace B — Slash Demo · SLASH path

**Task ID:** `b2d9e4c7`
**Mode:** `slash_demo`
**Budget:** 0.100 USDC
**Outcome:** SLASHED — 0.100 USDC returned to employer · Reputation penalised

```
[14:05:44] ESCROWED      Settlement    Locking 0.100 USDC in Arc escrow…
                          details: { amount_usdc: 0.1 }

[14:05:45] ESCROWED      Settlement    Escrow confirmed. Job #185 · TX: 0x7b2e9a4f1d8c3060…
                          details: { job_id: 185, tx: "0x7b2e9a4f1d8c30605e3a1b7c4d9f2e8a", amount_usdc: 0.1 }

[14:05:45] DELEGATED      Director     Received objective — decomposing into structured brief for RiskAnalyst…
                          details: {
                            task_brief: "Evaluate execution risk for a high-frequency arbitrage strategy...",
                            workflow: "SequentialWorkflow: Director → RiskAnalyst"
                          }

[14:05:45] GOVERNANCE     Director     Receiving objective and decomposing task brief…
                          stage: delegation

[14:05:46] GOVERNANCE     Director     Structuring governance constraints…
                          stage: delegation

[14:05:51] GOVERNANCE     RiskAnalyst  Structured analysis complete (891 chars)
                          stage: executing

[14:05:51] EXECUTING      RiskAnalyst  Risk analysis complete (891 chars)
                          details: { output_len: 891, director_brief_len: 398 }

[14:05:51] AUDITING       Auditor      Starting governance validation (7 checks)…
                          details: { force_slash: true, sla_seconds: 3600 }

[14:05:51] GOVERNANCE     Auditor      Starting governance validation (7 checks)…
                          stage: auditing

[14:05:51] AUDITED        Auditor      Execution output flagged: governance constraint violation detected
                          details: {
                            verdict: "SLASH",
                            reason: "Execution output flagged: governance constraint violation detected",
                            sla_elapsed_s: 7.1,
                            sla_seconds: 3600,
                            force_slash: true,
                            checks: {
                              forced_slash: true
                            }
                          }

[14:05:51] GOVERNANCE     Settlement   Audit FAILED — triggering slash on Job #185…
                          stage: slashing

[14:05:52] SLASHED        Settlement   SLASH executed — USDC returned to employer. Reputation penalised.
                          details: {
                            reason: "Execution output flagged: governance constraint violation detected",
                            job_id: 185,
                            slash_tx: "0xe1a4c7f2b9d30861a5e2c9d4f8b1e7c3",
                            amount_usdc: 0.1
                          }

[14:05:52] REPUTATION_UPDATED  Settlement  Agent reputation penalised
                          details: {
                            agent_id: "b3f9a1c4",
                            agent_name: "RiskAnalyst",
                            before: 9000,
                            after: 8800,
                            delta: -200
                          }

[14:05:52] GOVERNANCE     Settlement   Reputation 9000 → 8800 (delta -200). Slash TX: 0xe1a4c7f2b9d308…
                          stage: slashed, tx: "0xe1a4c7f2b9d30861a5e2c9d4f8b1e7c3"
```

**Delegation chain:** `Settlement → Director → RiskAnalyst → Auditor`
**Duration:** 8.2s end-to-end
**Audit verdict:** SLASH (forced — governance constraint violation)
**USDC disposition:** 0.100 USDC returned to employer
**Reputation delta:** 9000 → 8800 (−200 points)

---

## Governance Event Reference

| Event              | Agent       | Trigger                                         |
|--------------------|-------------|--------------------------------------------------|
| `escrowed`         | Settlement  | USDC locked in AgentEscrow before work begins   |
| `delegated`        | Director    | Objective received, task brief structured        |
| `executing`        | RiskAnalyst | Swarms SequentialWorkflow completed              |
| `auditing`         | Auditor     | Governance validation starting (7 checks)       |
| `audited`          | Auditor     | Verdict returned: PASS or SLASH                  |
| `settled`          | Settlement  | Audit passed — USDC released to worker          |
| `slashed`          | Settlement  | Audit failed — USDC returned to employer        |
| `refunded`         | Settlement  | Error in pipeline — USDC returned               |
| `reputation_updated`| Settlement | Reputation score updated post-settlement/slash  |
| `sla_warning`      | Settlement  | SLA deadline approaching                        |
| `governance`       | any         | Informational event at each lifecycle stage     |

## Audit Check Reference

| Check                     | Passes when                                      |
|---------------------------|--------------------------------------------------|
| `forced_slash`            | Never passes (demo mode only)                   |
| `sla_met`                 | elapsed ≤ deadline_hours × 3600                 |
| `non_empty`               | output.strip() length ≥ 20 chars                |
| `structured_output`       | Output contains extractable JSON                |
| `required_fields_present` | JSON has `risk_score`, `recommendation`, `reasoning` |
| `valid_risk_score`        | `risk_score` is a number in [0, 10]             |
| `reasoning_depth`         | `reasoning` length ≥ 20 chars                   |
| `llm_quality_check`       | Claude Haiku rates output as PASS               |

## Architecture Note

The governance layer is decoupled from the Swarms SequentialWorkflow:

```
PostTaskRequest (governance_mode=swarms_demo/slash_demo)
    │
    ▼
_run_governed_pipeline()
    │
    ├─ 1. Arc escrow lock  ─────────────────────── GovernanceLog: escrowed
    │
    ├─ 2. BrewingSwarmOrchestrator.run()
    │       ├─ Director (claude-haiku)  ──────────── GovernanceLog: delegated
    │       └─ RiskAnalyst (claude-opus-4-5) ─────── GovernanceLog: executing
    │
    ├─ 3. AuditorAgent.validate()  ─────────────── GovernanceLog: auditing → audited
    │       └─ 7 checks (SLA, structure, fields,
    │                     score range, reasoning depth)
    │
    ├─ 4a. PASS → client.complete_job()  ────────── GovernanceLog: settled
    │             registry.record_completion()  ──── GovernanceLog: reputation_updated
    │
    └─ 4b. SLASH → client.slash_job()  ─────────── GovernanceLog: slashed
                   registry.record_slash()  ──────── GovernanceLog: reputation_updated
```

All events are emitted in real time as SSE events to the frontend stream
at `/api/tasks/{task_id}/stream`, and stored permanently in the per-task
`GovernanceLog` accessible at `/api/tasks/{task_id}/governance`.
