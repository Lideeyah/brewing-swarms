"""
Brewing Swarms Orchestration Wrapper
=====================================
Wraps the Brewing governance workflow using Swarms SequentialWorkflow.

Agent chain:
  Director -> Risk Analyst -> Auditor -> Settlement (via Arc SDK)

The Swarms workflow handles the intelligence layer.
Brewing's brewing_sdk handles the economic settlement layer.

Usage:
    from backend.swarms_workflow import BrewingSwarmOrchestrator

    orch = BrewingSwarmOrchestrator(api_key=os.getenv("ANTHROPIC_API_KEY"))
    result = await orch.run(task_description, budget_usdc, emit_fn)
"""
import asyncio
import json as _json
import os
import re as _re
import time
from typing import Callable, Awaitable

from swarms import Agent
from swarms.structs import SequentialWorkflow


# ── Agent system prompts ──────────────────────────────────────────────────────

DIRECTOR_SYSTEM_PROMPT = """
You are the Director Agent in a governed autonomous coordination system called Brewing.

Your role:
- Receive high-level financial or analytical objectives
- Decompose them into a structured task brief for the Risk Analyst
- Define explicit constraints: what the output must contain, quality thresholds, SLA requirements

Output format (always JSON):
{
  "task_brief": "<clear task description for the Risk Analyst>",
  "required_fields": ["risk_score", "recommendation", "reasoning"],
  "constraints": ["risk_score must be 0-10", "reasoning must be substantive"],
  "priority": "high|medium|low",
  "context": "<any relevant context>"
}

You are governance infrastructure. Be precise, structured, and deterministic.
""".strip()

RISK_ANALYST_SYSTEM_PROMPT = """
You are the Risk Analyst Agent in a governed autonomous coordination system called Brewing.

Your role:
- Receive structured task briefs from the Director Agent
- Produce rigorous, structured risk analysis
- Output MUST be valid JSON with these required fields:
  - risk_score: number 0-10 (0=no risk, 10=extreme risk)
  - recommendation: string ("execute" | "hold" | "reject")
  - reasoning: string (substantive explanation, minimum 50 words)
  - confidence: number 0-1
  - key_factors: array of strings

Output format (always JSON):
{
  "risk_score": <0-10>,
  "recommendation": "<execute|hold|reject>",
  "reasoning": "<substantive analysis>",
  "confidence": <0-1>,
  "key_factors": ["<factor1>", "<factor2>", ...]
}

Your output will be validated by an Auditor Agent. Malformed, vague, or non-compliant
outputs will trigger an economic slash — escrow funds will be returned to the employer.
Produce governance-grade analysis.
""".strip()


# ── Swarms orchestrator ───────────────────────────────────────────────────────

class BrewingSwarmOrchestrator:
    """
    Governed multi-agent workflow using Swarms SequentialWorkflow.
    Director -> Risk Analyst (-> Auditor handled by Brewing's AuditorAgent).
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        os.environ.setdefault("ANTHROPIC_API_KEY", api_key)

        # Director Agent — use claude-3-5-haiku (fast, litellm-compatible)
        self.director = Agent(
            agent_name    = "Director",
            system_prompt = DIRECTOR_SYSTEM_PROMPT,
            model_name    = "claude-3-5-haiku-20241022",
            max_loops     = 1,
            streaming_on  = False,
            verbose       = False,
        )

        # Risk Analyst Agent — use claude-3-5-sonnet (reliable quality, litellm-compatible)
        self.risk_analyst = Agent(
            agent_name    = "RiskAnalyst",
            system_prompt = RISK_ANALYST_SYSTEM_PROMPT,
            model_name    = "claude-3-5-sonnet-20241022",
            max_loops     = 1,
            streaming_on  = False,
            verbose       = False,
        )

        # Sequential workflow: Director first, then Risk Analyst
        # output_type="str" is required — default is "dict" which breaks extraction
        self.workflow = SequentialWorkflow(
            name        = "Brewing Governance Workflow",
            description = "Governed autonomous coordination: delegation, analysis, audit, settlement",
            agents      = [self.director, self.risk_analyst],
            max_loops   = 1,
            verbose     = False,
            output_type = "str",
        )

    async def run(
        self,
        task_description: str,
        emit: Callable[[str, dict], Awaitable[None]] | None = None,
    ) -> tuple[str, str]:
        """
        Run the governed workflow.
        Returns (director_output, risk_analyst_output).
        Emits governance events via emit(event_type, kwargs) if provided.
        """

        async def _emit(event_type: str, **kwargs):
            if emit:
                await emit(event_type, kwargs)

        # Director receives the objective and decomposes it
        await _emit("governance", agent="Director",
                    message="Receiving objective and decomposing task brief…",
                    stage="delegation")

        loop = asyncio.get_running_loop()

        # Run Director in executor (Swarms is sync)
        await _emit("governance", agent="Director",
                    message="Structuring governance constraints…",
                    stage="delegation")

        workflow_result = await loop.run_in_executor(
            None,
            lambda: self.workflow.run(task_description),
        )

        # Extract clean output from each agent's memory.
        # workflow_result (str) is the final agent's raw output — use as authoritative
        # fallback if memory extraction fails or returns conversation noise.
        director_output = _extract_agent_output(self.director)
        analyst_output  = _extract_agent_output(self.risk_analyst)

        # If memory extraction returned noise or nothing, use workflow_result
        if not analyst_output or _is_conversation_dump(analyst_output):
            if isinstance(workflow_result, str) and workflow_result.strip():
                analyst_output = _clean_output(workflow_result.strip())
            else:
                analyst_output = str(workflow_result)

        await _emit("governance", agent="RiskAnalyst",
                    message="Structured analysis complete",
                    stage="executing")

        return director_output, analyst_output

    def reset(self):
        """Reset agent memory between runs — clear short_memory conversation history."""
        for agent in (self.director, self.risk_analyst):
            try:
                if hasattr(agent, "short_memory") and agent.short_memory is not None:
                    if hasattr(agent.short_memory, "clear"):
                        agent.short_memory.clear()
                    elif hasattr(agent.short_memory, "messages"):
                        agent.short_memory.messages.clear()
            except Exception:
                pass


# ── Output extraction helpers ─────────────────────────────────────────────────

def _clean_output(text: str) -> str:
    """Strip Swarms system-awareness annotations from agent output."""
    lines = text.splitlines()
    cleaned = [
        l for l in lines
        if not l.strip().startswith("system: Sequential")
        and "Sequential awareness" not in l
    ]
    return "\n".join(cleaned).strip()


def _is_conversation_dump(text: str) -> bool:
    """
    Return True if text looks like a raw Swarms conversation dump
    rather than a clean agent response.
    """
    noise_markers = (
        "User:",
        "user:",
        "system: Sequential",
        "Agent behind:",
        "Agent ahead:",
        "Human:",
    )
    return any(m in text for m in noise_markers)


def _extract_json_blocks(text: str) -> list[str]:
    """
    Return all top-level JSON objects found in text, in order.
    Uses a depth-counter approach to handle nested objects robustly.
    """
    blocks: list[str] = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = text[start:i + 1]
                try:
                    _json.loads(candidate)
                    blocks.append(candidate)
                except Exception:
                    pass
                start = -1
    return blocks


def _extract_from_history(history: str, agent_name: str) -> str:
    """
    Parse a Swarms conversation history string and return the last
    meaningful output from the named agent.

    Strategy:
      1. Last JSON object that contains governance-relevant fields
      2. Text after the last "<AgentName>:" block
      3. Text after the last "Assistant:" block
    """
    # Strategy 1 — preferred: last structured JSON with analysis fields
    governance_keys = {"risk_score", "recommendation", "reasoning", "task_brief"}
    all_blocks = _extract_json_blocks(history)
    governed = [b for b in all_blocks if governance_keys & set(_json.loads(b).keys())]
    if governed:
        return governed[-1]

    # Strategy 2 — last agent-name section
    pat = _re.compile(
        rf'\b{_re.escape(agent_name)}\s*:\s*\n?(.*)',
        _re.DOTALL | _re.IGNORECASE
    )
    matches = list(pat.finditer(history))
    if matches:
        content = matches[-1].group(1).strip()
        content = _clean_output(content)
        # Trim at next role marker
        cutoff = _re.search(r'\n(?:User|system|Human|Assistant)\s*:', content)
        if cutoff:
            content = content[:cutoff.start()].strip()
        if len(content) > 20:
            return content

    # Strategy 3 — last Assistant: section
    matches = list(_re.finditer(r'\bAssistant\s*:\s*\n?(.*)', history, _re.DOTALL | _re.IGNORECASE))
    if matches:
        content = matches[-1].group(1).strip()
        content = _clean_output(content)
        cutoff = _re.search(r'\n(?:User|system|Human)\s*:', content)
        if cutoff:
            content = content[:cutoff.start()].strip()
        if len(content) > 20:
            return content

    return ""


def _extract_agent_output(agent: Agent) -> str:
    """
    Extract the last clean assistant response from a Swarms Agent's memory.

    Tries (in order):
      1. short_memory.messages list — direct access to last assistant dict
      2. get_final_message_content() — Swarms API
      3. get_last_message_as_string() — Swarms API with role prefix stripped
      4. return_history_as_string() — full history, parsed via _extract_from_history
    """
    try:
        mem = getattr(agent, "short_memory", None)
        if mem is None:
            return ""

        # Option 1: direct messages list access (most reliable)
        messages = getattr(mem, "messages", None)
        if isinstance(messages, list) and messages:
            for msg in reversed(messages):
                if not isinstance(msg, dict):
                    continue
                role = msg.get("role", "")
                if role not in ("assistant", agent.agent_name, agent.agent_name.lower()):
                    continue
                content = msg.get("content", "")
                if isinstance(content, str) and content.strip():
                    cleaned = _clean_output(content.strip())
                    if cleaned and not _is_conversation_dump(cleaned):
                        return cleaned
                elif isinstance(content, list):
                    for block in reversed(content):
                        if isinstance(block, dict) and block.get("type") == "text":
                            text = block.get("text", "")
                            if text.strip():
                                cleaned = _clean_output(text.strip())
                                if cleaned and not _is_conversation_dump(cleaned):
                                    return cleaned

        # Option 2: Swarms get_final_message_content()
        if hasattr(mem, "get_final_message_content"):
            try:
                out = mem.get_final_message_content()
                if out and isinstance(out, str) and out.strip():
                    cleaned = _clean_output(out.strip())
                    if cleaned and not _is_conversation_dump(cleaned):
                        return cleaned
            except Exception:
                pass

        # Option 3: Swarms get_last_message_as_string()
        if hasattr(mem, "get_last_message_as_string"):
            try:
                out = mem.get_last_message_as_string()
                if out and isinstance(out, str) and out.strip():
                    out = out.strip()
                    for prefix in ("Assistant:", "assistant:", "ASSISTANT:"):
                        if out.startswith(prefix):
                            out = out[len(prefix):].strip()
                            break
                    cleaned = _clean_output(out)
                    if cleaned and not _is_conversation_dump(cleaned):
                        return cleaned
            except Exception:
                pass

        # Option 4: parse full history string
        if hasattr(mem, "return_history_as_string"):
            try:
                history = mem.return_history_as_string()
                if history and isinstance(history, str):
                    return _extract_from_history(history, agent.agent_name)
            except Exception:
                pass

    except Exception:
        pass
    return ""
