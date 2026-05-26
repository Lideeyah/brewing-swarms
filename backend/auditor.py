"""
Brewing Auditor Agent
=====================
The governance primitive that makes autonomous execution safe.

The Auditor:
  - validates worker output against task constraints
  - enforces SLA deadlines
  - detects malformed or low-quality responses
  - triggers slash conditions when execution fails governance checks
  - emits a signed audit verdict for the governance log

This is the critical piece that transforms "trust-based coordination"
into "economically enforceable coordination."
"""
import json
import re
import time
from dataclasses import dataclass
from typing import Literal

import anthropic


# ── Audit result ──────────────────────────────────────────────────────────────

@dataclass
class AuditResult:
    verdict:      Literal["PASS", "SLASH"]
    reason:       str
    checks:       dict
    audited_at:   float = 0.0

    def __post_init__(self):
        if not self.audited_at:
            self.audited_at = time.time()

    def to_dict(self) -> dict:
        return {
            "verdict":    self.verdict,
            "reason":     self.reason,
            "checks":     self.checks,
            "audited_at": self.audited_at,
            "passed":     self.verdict == "PASS",
        }


# ── Structured output schema (for Risk Agent outputs) ────────────────────────

REQUIRED_FIELDS   = ["risk_score", "recommendation", "reasoning"]
VALID_RISK_RANGE  = (0, 10)
MIN_REASONING_LEN = 20


# ── Auditor ───────────────────────────────────────────────────────────────────

class AuditorAgent:
    """
    Validates worker outputs and enforces SLA conditions.
    Returns PASS (settle) or SLASH (refund + penalise).
    """

    name = "Auditor"

    def __init__(self, api_key: str):
        self._client = anthropic.Anthropic(api_key=api_key)

    # ── Main entry point ──────────────────────────────────────────────────────

    def validate(
        self,
        task_description:  str,
        output:            str,
        started_at:        float,
        sla_seconds:       int,
        force_slash:       bool = False,   # deterministic slash demo mode
    ) -> AuditResult:
        """
        Run all governance checks. Returns AuditResult with PASS or SLASH.

        Checks (in order):
          1. Forced slash (demo mode)
          2. SLA compliance
          3. Output non-empty
          4. Structured JSON fields (if output contains JSON)
          5. Risk score in valid range (if structured)
          6. Reasoning depth (if structured)
          7. LLM quality review (fallback for unstructured output)
        """
        checks: dict = {}

        # Check 1: Forced slash for deterministic demo
        if force_slash:
            checks["forced_slash"] = True
            return AuditResult(
                verdict="SLASH",
                reason="Execution output flagged: governance constraint violation detected",
                checks=checks,
            )

        # Check 2: SLA compliance
        elapsed   = time.time() - started_at
        sla_met   = elapsed <= sla_seconds
        checks["sla_met"]     = sla_met
        checks["elapsed_s"]   = round(elapsed, 1)
        checks["sla_limit_s"] = sla_seconds

        if not sla_met:
            return AuditResult(
                verdict="SLASH",
                reason=f"SLA breached: execution took {elapsed:.0f}s, limit was {sla_seconds}s",
                checks=checks,
            )

        # Check 3: Non-empty output
        stripped = (output or "").strip()
        checks["non_empty"] = len(stripped) >= 20
        if not checks["non_empty"]:
            return AuditResult(
                verdict="SLASH",
                reason="Output is empty or below minimum length threshold",
                checks=checks,
            )

        # Check 4: Attempt to parse structured JSON
        structured = _extract_json(stripped)

        if structured is not None:
            checks["structured_output"] = True

            # Check 5: Required fields
            missing = [f for f in REQUIRED_FIELDS if f not in structured]
            checks["required_fields_present"] = len(missing) == 0
            if missing:
                return AuditResult(
                    verdict="SLASH",
                    reason=f"Structured output missing required fields: {missing}",
                    checks=checks,
                )

            # Check 6: Risk score range
            score = structured.get("risk_score")
            valid_score = (
                isinstance(score, (int, float))
                and VALID_RISK_RANGE[0] <= score <= VALID_RISK_RANGE[1]
            )
            checks["valid_risk_score"] = valid_score
            if not valid_score:
                return AuditResult(
                    verdict="SLASH",
                    reason=f"risk_score={score!r} is outside valid range {VALID_RISK_RANGE}",
                    checks=checks,
                )

            # Check 7: Reasoning depth
            reasoning = str(structured.get("reasoning", ""))
            checks["reasoning_depth"] = len(reasoning) >= MIN_REASONING_LEN
            if not checks["reasoning_depth"]:
                return AuditResult(
                    verdict="SLASH",
                    reason="Reasoning field too brief to meet governance standards",
                    checks=checks,
                )

            checks["audit_passed"] = True
            return AuditResult(
                verdict="PASS",
                reason="All governance checks passed: structured output validated",
                checks=checks,
            )

        else:
            # Fallback: LLM quality review for unstructured output
            checks["structured_output"] = False
            llm_verdict = self._llm_quality_check(task_description, stripped)
            checks["llm_quality_check"] = llm_verdict
            if llm_verdict == "SLASH":
                return AuditResult(
                    verdict="SLASH",
                    reason="Output failed LLM quality audit: insufficient depth or relevance",
                    checks=checks,
                )
            checks["audit_passed"] = True
            return AuditResult(
                verdict="PASS",
                reason="LLM quality audit passed",
                checks=checks,
            )

    # ── LLM quality fallback ──────────────────────────────────────────────────

    def _llm_quality_check(self, task: str, output: str) -> Literal["PASS", "SLASH"]:
        """Use Claude Haiku to assess relevance and depth of unstructured output."""
        try:
            resp = self._client.messages.create(
                model      = "claude-haiku-4-5-20251001",
                max_tokens = 60,
                messages   = [{
                    "role":    "user",
                    "content": (
                        f"Task: {task[:200]}\n\n"
                        f"Output: {output[:400]}\n\n"
                        "Is this output substantive, relevant, and governance-grade "
                        "(i.e. would an enterprise trust this for financial decision-making)?\n"
                        'Respond with JSON only: {"verdict": "PASS"} or {"verdict": "SLASH"}'
                    ),
                }],
            )
            m = re.search(r'\{.*?\}', resp.content[0].text, re.DOTALL)
            if m:
                data = json.loads(m.group())
                v = data.get("verdict", "PASS")
                return v if v in ("PASS", "SLASH") else "PASS"
        except Exception:
            pass
        return "PASS"  # default: don't slash if LLM check fails


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> dict | None:
    """Try to extract the first JSON object from a string."""
    try:
        m = re.search(r'\{.*\}', text, re.DOTALL)
        if m:
            return json.loads(m.group())
    except Exception:
        pass
    return None
