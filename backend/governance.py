"""
Brewing Governance Layer
========================
Lightweight event bus for tracking governed autonomous execution.
Every delegation, execution, audit, settlement, and slash is recorded here.
This is the audit trail that enterprise deployments require.
"""
import time
from dataclasses import dataclass, field
from typing import Any


# ── Event types ───────────────────────────────────────────────────────────────

GOVERNANCE_EVENT_TYPES = {
    "delegated":   "Director assigned task to worker agent",
    "escrowed":    "USDC locked in escrow on Arc",
    "executing":   "Worker agent running task",
    "audited":     "Auditor validated execution output",
    "settled":     "USDC released to worker on delivery",
    "slashed":     "SLA breached — escrow slashed, funds returned",
    "sla_warning": "SLA deadline approaching",
    "governance":  "General governance event",
}


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class GovernanceEvent:
    event_type:  str
    agent:       str
    timestamp:   float
    details:     dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "event_type": self.event_type,
            "agent":      self.agent,
            "timestamp":  self.timestamp,
            "ts_human":   time.strftime("%H:%M:%S", time.localtime(self.timestamp)),
            "details":    self.details,
            "label":      GOVERNANCE_EVENT_TYPES.get(self.event_type, self.event_type),
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
            details=details,
        )
        self._events.append(ev)
        return ev

    def all(self) -> list[GovernanceEvent]:
        return list(self._events)

    def to_dict(self) -> list[dict]:
        return [e.to_dict() for e in self._events]

    def delegation_chain(self) -> list[str]:
        """Returns ordered list of agents that touched this task."""
        seen: list[str] = []
        for ev in self._events:
            if ev.agent and ev.agent not in seen:
                seen.append(ev.agent)
        return seen

    def was_slashed(self) -> bool:
        return any(e.event_type == "slashed" for e in self._events)


# ── Global registry of per-task logs ─────────────────────────────────────────

_logs: dict[str, GovernanceLog] = {}


def get_log(task_id: str) -> GovernanceLog:
    if task_id not in _logs:
        _logs[task_id] = GovernanceLog(task_id)
    return _logs[task_id]


def all_logs() -> dict[str, GovernanceLog]:
    return dict(_logs)
