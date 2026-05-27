"""
Brewing Governance Layer
========================
Append-only audit log for every governed autonomous execution.

Every delegation, escrow, execution, audit, settlement, slash,
refund, and reputation update is recorded here as a GovernanceEvent.
This is the tamper-evident trail that enterprise deployments require.
"""
import time
from dataclasses import dataclass, field
from typing import Any


# ── Event type registry ───────────────────────────────────────────────────────

GOVERNANCE_EVENT_TYPES: dict[str, str] = {
    "delegated":          "Director assigned task to worker agent",
    "escrowed":           "USDC locked in escrow on Arc",
    "executing":          "Worker agent running task",
    "auditing":           "Auditor starting governance validation",
    "audited":            "Auditor returned verdict on execution output",
    "settled":            "USDC released to worker on delivery",
    "slashed":            "Governance failure — escrow slashed, funds returned",
    "refunded":           "Task failed in error path — USDC returned to employer",
    "reputation_updated": "Agent reputation score updated",
    "sla_warning":        "SLA deadline approaching",
    "governance":         "General governance event",
}

# ── Severity levels (for UI colour coding) ────────────────────────────────────
EVENT_SEVERITY: dict[str, str] = {
    "delegated":          "info",
    "escrowed":           "info",
    "executing":          "info",
    "auditing":           "info",
    "audited":            "success",   # overridden to "danger" if SLASH verdict
    "settled":            "success",
    "slashed":            "danger",
    "refunded":           "warning",
    "reputation_updated": "warning",
    "sla_warning":        "warning",
    "governance":         "muted",
}


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class GovernanceEvent:
    event_type: str
    agent:      str
    timestamp:  float
    details:    dict = field(default_factory=dict)

    def severity(self) -> str:
        """Return UI severity based on event type and details."""
        base = EVENT_SEVERITY.get(self.event_type, "muted")
        if self.event_type == "audited":
            return "danger" if self.details.get("verdict") == "SLASH" else "success"
        return base

    def to_dict(self) -> dict:
        return {
            "event_type": self.event_type,
            "agent":      self.agent,
            "timestamp":  self.timestamp,
            "ts_human":   time.strftime("%H:%M:%S", time.localtime(self.timestamp)),
            "details":    self.details,
            "label":      GOVERNANCE_EVENT_TYPES.get(self.event_type, self.event_type),
            "severity":   self.severity(),
        }


# ── Per-task governance log ───────────────────────────────────────────────────

class GovernanceLog:
    """
    Immutable append-only log for a single task's governance trail.
    Records every agent action from delegation through settlement or slash.
    """

    def __init__(self, task_id: str):
        self.task_id = task_id
        self._events: list[GovernanceEvent] = []

    def record(self, event_type: str, agent: str, **details: Any) -> GovernanceEvent:
        ev = GovernanceEvent(
            event_type=event_type,
            agent=agent,
            timestamp=time.time(),
            details=dict(details),
        )
        self._events.append(ev)
        return ev

    def all(self) -> list[GovernanceEvent]:
        return list(self._events)

    def to_dict(self) -> list[dict]:
        return [e.to_dict() for e in self._events]

    # ── Query helpers ─────────────────────────────────────────────────────────

    def delegation_chain(self) -> list[str]:
        """Ordered unique list of agents that participated in this task."""
        seen: list[str] = []
        for ev in self._events:
            if ev.agent and ev.agent not in seen:
                seen.append(ev.agent)
        return seen

    def was_slashed(self) -> bool:
        return any(e.event_type == "slashed" for e in self._events)

    def latest_audit(self) -> "GovernanceEvent | None":
        """Return the most recent audited event, or None."""
        for ev in reversed(self._events):
            if ev.event_type == "audited":
                return ev
        return None

    def duration_s(self) -> float | None:
        """Wall-clock seconds from first to last event."""
        if len(self._events) < 2:
            return None
        return round(self._events[-1].timestamp - self._events[0].timestamp, 2)

    def outcome(self) -> str:
        """'slashed', 'settled', 'refunded', or 'in_progress'."""
        types = {e.event_type for e in self._events}
        if "slashed"  in types: return "slashed"
        if "settled"  in types: return "settled"
        if "refunded" in types: return "refunded"
        return "in_progress"

    def summary(self) -> dict:
        """Compact summary for the /api/governance/logs listing."""
        audit = self.latest_audit()
        return {
            "task_id":          self.task_id,
            "outcome":          self.outcome(),
            "delegation_chain": self.delegation_chain(),
            "was_slashed":      self.was_slashed(),
            "event_count":      len(self._events),
            "duration_s":       self.duration_s(),
            "audit_verdict":    audit.details.get("verdict")    if audit else None,
            "audit_checks":     audit.details.get("checks")     if audit else None,
            "audit_reason":     audit.details.get("reason")     if audit else None,
            "sla_elapsed_s":    audit.details.get("sla_elapsed_s") if audit else None,
        }


# ── Global registry of per-task logs ─────────────────────────────────────────

_logs: dict[str, GovernanceLog] = {}


def get_log(task_id: str) -> GovernanceLog:
    if task_id not in _logs:
        _logs[task_id] = GovernanceLog(task_id)
    return _logs[task_id]


def all_logs() -> dict[str, GovernanceLog]:
    return dict(_logs)
