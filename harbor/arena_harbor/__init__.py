"""Arena Harbor adapter — run any coding CLI under Harbor's official verifier.

Public surface:

- Concrete agents: :class:`ByoAgent` (bring your own), :class:`OxagenAgent`,
  :class:`StellaAgent` — pass to Harbor via ``--agent-import-path
  arena_harbor:<Class>``.
- Spec building blocks: :class:`AgentSpec`, :class:`InstallSpec`,
  :class:`MetricsSpec`, and :func:`load_spec_file`.

The industry-leading agents you compare against (Claude Code, Gemini, Codex,
Cursor, Copilot, Aider, …) already ship inside Harbor — no adapter needed for
those. Arena adds the agents Harbor lacks and, above all, the bring-your-own
path.
"""

from __future__ import annotations

from .agents import ByoAgent, OxagenAgent, StellaAgent
from .base import ArenaInstalledAgent
from .spec import (
    AgentSpec,
    InstallSpec,
    MetricsSpec,
    load_spec_file,
    load_spec_from_env,
    spec_from_dict,
)

__all__ = [
    "AgentSpec",
    "ArenaInstalledAgent",
    "ByoAgent",
    "InstallSpec",
    "MetricsSpec",
    "OxagenAgent",
    "StellaAgent",
    "load_spec_file",
    "load_spec_from_env",
    "spec_from_dict",
]

__version__ = "0.1.0"
