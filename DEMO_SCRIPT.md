# Brewing — Demo Video Script

2 minutes. Operational tone. No hype. Show the governance working.

---

## 0–15s — The Problem

**Screen:** blank terminal or dark slide

> "AI agents can delegate work to other agents. But when money is involved, there's no enforcement layer. The worker might deliver nothing. The employer might refuse to pay. There's no escrow, no audit, no consequence for failure."

> "Brewing is the infrastructure that changes that."

---

## 15–40s — What Brewing Is

**Screen:** Brewing dashboard — Post a Task tab

> "Brewing is governed coordination and settlement infrastructure for autonomous systems."

> "Every task goes through four stages: economic lock, structured delegation via Swarms, governance audit, and on-chain settlement."

> "The key primitive is the Auditor — a validation layer that sits between execution and payment. It checks 7 conditions. If any fail, the escrow slashes. If all pass, USDC moves."

Point to the pipeline label on screen:
> "Director → RiskAnalyst → Auditor → Settlement. That's the chain."

---

## 40–90s — Governed Demo (PASS path)

**Screen:** Post a Task tab — click "Governed Demo" button

> "Let's run a live governed execution."

Click **▶ Governed Demo**

> "This calls POST /api/demo/governed. It locks USDC in escrow on Arc, then hands the task to the Swarms SequentialWorkflow."

**Screen:** Active Jobs tab — live SSE stream opens

Watch the workflow step indicator advance:
> "Escrow locked. Director structures the task brief. RiskAnalyst runs the analysis. Now the Auditor validates."

**Screen:** Governance Audit Trail panel — audit event arrives

> "Seven checks. SLA compliance, structured JSON, required fields, risk score range, reasoning depth. All pass."

**Screen:** Audit verdict shows PASS with green checks

> "PASS. USDC released to the worker. Settled on Arc. The agent gets paid because it delivered."

**Screen:** Settlement TX link — click to open ArcScan

---

## 90–120s — Slash Demo (SLASH path)

**Screen:** Back to Post a Task tab — click "✗ Slash Demo"

> "Now the enforcement path."

Click **✗ Slash Demo**

> "This is POST /api/demo/slash. Same pipeline, but the Auditor is configured to reject — governance constraint violation."

**Screen:** Live stream — watch Auditor event arrive

**Screen:** Red slash card appears in Governance panel

> "Audit failed. Slash triggered on-chain. USDC returned to the employer. Reputation penalised."

Point to reputation delta:
> "Nine-point-zero down to eight-point-eight. That history is permanent. Agents that fail governance pay a compounding cost."

---

## Final 15s — The Vision

**Screen:** Governance Audit Trail showing full delegation chain

> "Brewing is not an app. It's the trust layer for autonomous systems — the infrastructure that lets agents transact with strangers, at scale, without needing to know or trust each other."

> "Economic enforcement is what makes agent commerce real."

---

## Recording Notes

- Use the live deployed app at `https://brewing-swarms.vercel.app`
- Backend must be warm — hit `/health` first if on Render free tier
- For the demo, `POST /api/demo/governed` then immediately switch to Active Jobs tab
- The governance panel appears automatically when SSE governance events arrive
- Keep cursor movement deliberate — judges are reading event labels
- No background music
- Keep it under 2 minutes — judges watch at 1.5×

---

## Key Phrases to Hit

| Moment | Say |
|--------|-----|
| Start | "There's no enforcement layer" |
| Demo launch | "This locks USDC in escrow on Arc before any work begins" |
| Swarms section | "Swarms SequentialWorkflow runs the intelligence layer" |
| Auditor section | "Seven checks — all of them must pass" |
| PASS verdict | "USDC released because the agent delivered" |
| SLASH verdict | "Slash triggered — USDC returned — reputation permanent" |
| End | "The trust layer for autonomous systems" |
