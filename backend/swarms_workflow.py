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
import os
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

        # Primary: extract last assistant turn from each agent's short_memory.
        # Fallback: use workflow_result (str with output_type="str", dict otherwise).
        director_output = _extract_agent_output(self.director)
        analyst_output  = _extract_agent_output(self.risk_analyst)
        if not analyst_output:
            analyst_output = workflow_result if isinstance(workflow_result, str) else str(workflow_result)

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_agent_output(agent: Agent) -> str:
    """
    Extract the last assistant turn from a Swarms Agent's short_memory.

    Preference order:
      1. short_memory.get_final_message_content()  — just the last message body
      2. short_memory.get_last_message_as_string()  — last message with role prefix
      3. last 2000 chars of return_history_as_string() — full conversation fallback
    """
    try:
        mem = getattr(agent, "short_memory", None)
        if mem is None:
            return ""

        # Option 1: cleanest — content of the final message only
        if hasattr(mem, "get_final_message_content"):
            out = mem.get_final_message_content()
            if out and isinstance(out, str) and out.strip():
                return out.strip()

        # Option 2: last message with role tag stripped out
        if hasattr(mem, "get_last_message_as_string"):
            out = mem.get_last_message_as_string()
            if out and isinstance(out, str) and out.strip():
                # Strip a leading "Assistant: " prefix if present
                out = out.strip()
                for prefix in ("Assistant:", "assistant:", "ASSISTANT:"):
                    if out.startswith(prefix):
                        out = out[len(prefix):].strip()
                        break
                return out

        # Option 3: full history tail
        if hasattr(mem, "return_history_as_string"):
            history = mem.return_history_as_string()
            if history and isinstance(history, str):
                return history[-2000:]

    except Exception:
        pass
    return ""
