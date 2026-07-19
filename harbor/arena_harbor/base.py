"""``ArenaInstalledAgent`` — a spec-driven Harbor ``BaseInstalledAgent``.

One class runs any coding CLI described by an :class:`~arena_harbor.spec.AgentSpec`:
it installs the binary, invokes it one-shot on the task, and (best-effort) reads
back token/cost numbers. Concrete agents (oxagen, stella, bring-your-own) are
thin subclasses that supply a spec and a ``name()``.

Only this module and :mod:`arena_harbor.agents` import Harbor; the spec,
metrics, and command logic they lean on are Harbor-free and independently
tested.
"""

from __future__ import annotations

import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from .command import build_command, forwarded_env, parse_version
from .metrics import extract_metrics
from .spec import AgentSpec

_REMOTE_BIN_DIR = "/usr/local/bin"

# apt / apk / yum, whichever the base image has. Best-effort: a missing package
# manager is a warning, not a hard failure (the image may already have the deps).
_SYSTEM_PKG_TEMPLATE = (
    "if command -v apt-get >/dev/null 2>&1; then "
    "  apt-get update && apt-get install -y {pkgs}; "
    "elif command -v apk >/dev/null 2>&1; then "
    "  apk add --no-cache {pkgs}; "
    "elif command -v yum >/dev/null 2>&1; then "
    "  yum install -y {pkgs}; "
    "else "
    '  echo "arena-harbor: no known package manager; assuming {pkgs} present" >&2; '
    "fi"
)


class ArenaInstalledAgent(BaseInstalledAgent):
    """Base for Arena's Harbor agents. Subclasses set ``name()`` and ``spec()``."""

    #: Combined stdout/stderr of the last agent run (metrics are read from it).
    _agent_output: str = ""

    def spec(self) -> AgentSpec:
        raise NotImplementedError("subclasses must implement spec()")

    # ── version ────────────────────────────────────────────────────────────
    def get_version_command(self) -> str | None:
        return self.spec().version_command

    def parse_version(self, stdout: str) -> str:
        return parse_version(stdout, self.spec().version_regex)

    # ── install ────────────────────────────────────────────────────────────
    async def install(self, environment: BaseEnvironment) -> None:
        spec = self.spec()
        install = spec.install

        if install.system_packages:
            pkgs = " ".join(shlex.quote(p) for p in install.system_packages)
            await self.exec_as_root(
                environment,
                command=_SYSTEM_PKG_TEMPLATE.format(pkgs=pkgs),
                env={"DEBIAN_FRONTEND": "noninteractive"},
                timeout_sec=600,
            )

        if install.kind == "binary":
            host_binary = self._resolve_host_binary(spec)
            remote_tmp = f"/tmp/{spec.binary}"
            dest = f"{_REMOTE_BIN_DIR}/{spec.binary}"
            await environment.upload_file(str(host_binary), remote_tmp)
            await self.exec_as_root(
                environment,
                command=(
                    f"cp {shlex.quote(remote_tmp)} {shlex.quote(dest)} && "
                    f"chmod +x {shlex.quote(dest)}"
                ),
                timeout_sec=120,
            )
        elif install.kind == "script":
            script = self._resolve_install_script(spec)
            await self.exec_as_root(environment, command=script, timeout_sec=1800)
        else:  # pragma: no cover - spec loader rejects other kinds
            raise ValueError(f"unknown install kind: {install.kind}")

    def _resolve_host_binary(self, spec: AgentSpec) -> Path:
        env_var = spec.install.binary_env
        raw = os.environ.get(env_var or "")
        if not raw:
            raise FileNotFoundError(
                f"agent '{spec.name}': set {env_var} to the path of the "
                f"{spec.binary} executable to upload (built for the container's "
                f"OS/arch — Linux, usually x86-64)."
            )
        path = Path(raw)
        if not path.is_file():
            raise FileNotFoundError(
                f"agent '{spec.name}': {env_var}={raw} is not a file."
            )
        return path

    def _resolve_install_script(self, spec: AgentSpec) -> str:
        install = spec.install
        if install.script_env:
            override = os.environ.get(install.script_env)
            if override:
                return override
        if install.script:
            return install.script
        raise ValueError(
            f"agent '{spec.name}': no install script "
            f"(set {install.script_env} or provide install.script)."
        )

    # ── run ────────────────────────────────────────────────────────────────
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        spec = self.spec()
        budget = os.environ.get("ARENA_BUDGET", spec.default_budget or "")
        timeout = os.environ.get("ARENA_TIMEOUT", "1800")
        command = build_command(
            spec, self.model_name, instruction, budget=budget, timeout=timeout
        )
        env = forwarded_env(spec)

        # Run directly (not exec_as_agent) so a non-zero agent exit does NOT
        # abort the trial before Harbor's verifier gets to judge the workspace.
        # The verifier — never the CLI's exit code — decides pass/fail.
        try:
            result = await environment.exec(
                command=command,
                env=env,
                timeout_sec=_parse_timeout(timeout),
            )
            self._agent_output = "\n".join(
                part
                for part in (
                    getattr(result, "stdout", "") or "",
                    getattr(result, "stderr", "") or "",
                )
                if part
            )
        except Exception as exc:
            self._agent_output = f"[arena-harbor] agent execution error: {exc}"
            self.logger.warning("arena-harbor: agent run raised: %s", exc)

    # ── metrics ────────────────────────────────────────────────────────────
    def populate_context_post_run(self, context: AgentContext) -> None:
        spec = self.spec()
        if spec.metrics is None:
            return
        output = self._agent_output
        if not output:
            return
        parsed = extract_metrics(output, spec.metrics)
        if parsed.is_empty():
            return
        if parsed.cost_usd is not None:
            context.cost_usd = parsed.cost_usd
        context.metadata = {**(context.metadata or {}), **parsed.as_metadata(spec.name)}


def _parse_timeout(raw: str) -> int | None:
    """``ARENA_TIMEOUT`` seconds as an int; None (no limit) when unparseable."""
    try:
        return int(float(raw))
    except ValueError:
        return None
