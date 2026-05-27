# Brewing — Demo Recording Script
### Swarms Hackathon Submission · Target: 2:30–3:00 min

---

## Pre-recording checklist

- [ ] Backend warm (hit `GET /api/agents` once — Render wakes in ~30s if cold)
- [ ] Browser window: 1440×900, dark mode, no extensions visible
- [ ] Incognito tab (no cached auth / stale state)
- [ ] Start on landing page `/`
- [ ] Silence all notifications, Dock animations, clock widgets
- [ ] QuickTime → New Screen Recording → crop to browser only

---

## Scene 1 — Hook (0:00 → 0:18)

**Screen:** Landing page at `https://brewing.vercel.app` (or your Vercel URL)

**Voiceover:**
> "AI agents can coordinate, execute tasks, and generate outputs.
> The missing layer is accountability.
> What enforces the rules? What happens when an agent fails?
> Brewing answers that — with Swarms, economic escrow, and on-chain governance."

**What to show:**
- Scroll slowly from the hero headline to the stats bar
- Let the LIVE GOVERNANCE STREAM panel animate on the right (shows SETTLED / SLASHED events cycling)
- Pause on the three stats: Governed Jobs · USDC Settled · Active Agents

---

## Scene 2 — The Pipeline (0:18 → 0:40)

**Screen:** Scroll down to the Pipeline section

**Voiceover:**
> "Every task runs through five enforced stages.
>
> First — Escrow. USDC locks on Arc before any agent touches the task.
>
> Second — Director. A Swarms agent structures the objective into a governance-grade brief.
>
> Third — Risk Analyst. The second Swarms agent executes the analysis inside
> a SequentialWorkflow.
>
> Fourth — Auditor. Seven governance checks. No partial credit.
>
> Fifth — Settlement. USDC releases only on a clean verdict.
> Fail the audit — USDC slashes back to the employer."

**What to show:**
- Pipeline animated viz: dot travelling through ESCROW → DIRECTOR → RISK ANALYST → AUDITOR → SETTLEMENT
- SETTLEMENT stage is green — only one that earns colour
- No clicking needed here

---

## Scene 3 — Live governed execution (0:40 → 1:40)

**Screen:** Scroll back up to hero. Click **"Run Demo"**.

**Voiceover — talk through events as they appear:**

*(click "Run Demo" → browser navigates to Dashboard → Active Jobs tab)*

> "I fire the demo. Brewing locks USDC into escrow on Arc.
> You can see the TX hash appear in the stream."

*(Event: Settlement — "Locking 0.100 USDC in Arc escrow…")*

> "Swarms SequentialWorkflow starts. Director receives the objective —
> analyse a fifty thousand dollar tokenised RWA portfolio."

*(Events: Director — "Decomposing task brief" / "Structuring governance constraints")*

> "Director produces a structured JSON brief — task description, required fields,
> constraints, priority. Swarms hands it directly to Risk Analyst."

*(Events: RiskAnalyst — "Structured analysis complete")*

> "Risk Analyst returns governance-grade JSON — risk score zero to ten,
> recommendation, confidence, key factors. All in one Swarms sequential pass."

*(Events: Auditor — "Starting governance validation — 7 checks")*

> "The Auditor now validates. Seven checks: output completeness, SLA compliance,
> schema validity, risk score bounds, reasoning depth, agent identity, format.
> Every one must pass."

*(Audited event — verdict PASS)*

> "Verdict: PASS.
> Settlement fires. USDC releases to the RiskAnalyst agent on Arc.
> The governance log is sealed."

*(done event — stream panel dismisses, job flips to ✓ SETTLED)*

**What to show:**
- LiveStreamPanel at the top of Active Jobs tab showing events one by one
- Agent labels: Settlement → Director → RiskAnalyst → Auditor → Settlement
- ◈ GOVERNED badge visible on the task row
- Stream panel auto-closes ~1.5s after the done event

---

## Scene 4 — Governance audit trail (1:40 → 2:10)

**Screen:** Click the completed job row to expand it.

**Voiceover:**
> "Every event is stored. Click the job — full governance receipt.
>
> Delegation record. Swarms workflow execution. Auditor's seven-check log —
> timestamp, result, SLA elapsed.
>
> Settlement TX — verifiable on Arc Explorer.
>
> This is accountability infrastructure. Not a log. A cryptographic record
> of what Swarms produced and whether it met governance standards."

**What to show:**
- Governance event timeline: delegation → executing → auditing → audited → settled
- Green ◈ GOVERNED badge in the row header
- Click "Settlement TX ↗" — Arc Explorer opens in new tab, TX visible
- Come back to dashboard

---

## Scene 5 — Slash enforcement (2:10 → 2:40)

**Screen:** Point to (or show) a job with ✗ SLASHED badge — either from a prior run or fire one now.

**Voiceover:**
> "Now the enforcement path.
>
> An agent submits output that fails governance — incomplete reasoning,
> SLA breach, malformed schema.
>
> The Auditor triggers a slash.
> USDC returns to the employer automatically, on-chain.
> The agent's reputation is docked permanently.
>
> No human in the loop. No dispute process. Swarms detected the failure.
> Brewing enforced it."

**What to show:**
- Red ✗ SLASHED badge on the task row
- Expand the row: slash TX hash, "USDC returned" amount, reputation before → after
- The delta shows in red (e.g., 9.0 → 8.9, −0.1)

---

## Scene 6 — Closing (2:40 → 3:00)

**Screen:** Navigate back to landing page `/`

**Voiceover:**
> "Brewing is governed coordination infrastructure for autonomous agents.
>
> Multi-agent orchestration via Swarms SequentialWorkflow.
> Economic accountability via Circle Arc escrow.
> Audit enforcement — seven checks, deterministic, on-chain.
>
> Swarms handles the intelligence. Brewing handles the accountability.
>
> Governed by design."

**What to show:**
- Hero headline: "Autonomous execution / governed by Brewing."
- Governance stream still scrolling
- End on a static frame at the headline — clean close

---

## Recording notes

**If the backend takes longer than expected (Render cold start ~30s):**
- The full pipeline runs in 60–90s. Do not cut away.
- Keep narrating: "Swarms is doing the coordination here — Director producing the brief,
  then handing to RiskAnalyst for execution. Both run inside a single SequentialWorkflow."
- The events will appear. Don't rush.

**Do NOT show:**
- The URL bar with localhost — use the Vercel deployment
- Login / onboarding flow (not needed for the demo path)
- Any API keys, env vars, or terminal windows

**Keep on screen during stream:**
- The agent names (Settlement / Director / RiskAnalyst / Auditor)
- The event message text
- The ◈ GOVERNED badge

---

## Key Swarms talking points

| Moment | Say exactly this |
|---|---|
| Pipeline overview | "Swarms SequentialWorkflow — Director then RiskAnalyst, in sequence" |
| Director fires | "Director is a Swarms Agent — structured output, governance constraints" |
| RiskAnalyst fires | "RiskAnalyst is a Swarms Agent — full JSON analysis, governance-grade" |
| Workflow complete | "Swarms handled the multi-agent coordination. Brewing handled the accountability." |
| Audit fires | "The Auditor checks what Swarms produced — schema, reasoning depth, SLA, seven total" |
| Settlement | "Clean audit — USDC settles. Swarms output is now economically accountable." |
| Slash | "Swarms detected the failure. Brewing enforced it — on-chain, automatically." |

---

## One-paragraph submission description

Brewing is a governed B2B agent coordination layer built on Swarms and Circle Arc.
Businesses post tasks with a USDC escrow. Swarms SequentialWorkflow chains a Director
agent (task structuring) with a RiskAnalyst agent (full execution) — both Claude models
coordinated natively by Swarms. An on-chain Auditor validates the output against seven
governance criteria. Pass: USDC settles to the agent. Fail: USDC slashes back to the
employer automatically. Every lifecycle event — delegation, Swarms execution, audit,
settlement — is stored in a signed governance log with on-chain TX proofs. Brewing makes
Swarms-powered autonomous execution economically accountable.
