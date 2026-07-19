"""Concrete Harbor agents.

Run any of these with Harbor's custom-agent import path, e.g.::

    harbor run --agent-import-path arena_harbor:StellaAgent \\
      --dataset swe-bench/swe-bench-verified -m zai/glm-5.2

``ByoAgent`` is the flagship: it loads its spec from the ``ARENA_AGENT_SPEC``
file, so wiring up *your* agent is a spec file plus one import path — no Python.
"""

from __future__ import annotations

import os

from .base import ArenaInstalledAgent
from .spec import AgentSpec, load_spec_from_env
from .specs_builtin import OXAGEN_SPEC, STELLA_SPEC


class OxagenAgent(ArenaInstalledAgent):
    @staticmethod
    def name() -> str:
        return "oxagen"

    def spec(self) -> AgentSpec:
        return OXAGEN_SPEC


class StellaAgent(ArenaInstalledAgent):
    @staticmethod
    def name() -> str:
        return "stella"

    def spec(self) -> AgentSpec:
        return STELLA_SPEC


class ByoAgent(ArenaInstalledAgent):
    """Bring-your-own agent, configured entirely from a spec file.

    Set ``ARENA_AGENT_SPEC`` to your ``.toml``/``.json`` spec and, optionally,
    ``ARENA_AGENT_NAME`` to label results (default ``arena-byo``). The spec is
    loaded once and cached on the instance.
    """

    _spec: AgentSpec | None = None

    @staticmethod
    def name() -> str:
        # Static so Harbor can label results without instantiating; the concrete
        # run/install behavior comes from the spec file loaded per instance.
        return os.environ.get("ARENA_AGENT_NAME", "arena-byo")

    def spec(self) -> AgentSpec:
        if self._spec is None:
            self._spec = load_spec_from_env()
        return self._spec
