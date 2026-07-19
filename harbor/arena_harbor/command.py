"""Command rendering and env forwarding — the pure core of an agent run.

Kept Harbor-free so the exact shell command an agent will run, and the exact
set of secrets forwarded into the container, are unit-testable without spinning
up a container.
"""

from __future__ import annotations

import os
import re
import shlex
from collections.abc import Mapping

from .spec import AgentSpec

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def render_template(template: str, mapping: Mapping[str, str]) -> str:
    """Replace ``{key}`` tokens that appear in ``mapping``; leave every other
    brace run (unknown ``{x}``, shell ``${VAR}``, awk ``{print}``) untouched."""

    def repl(match: re.Match[str]) -> str:
        key = match.group(1)
        return mapping[key] if key in mapping else match.group(0)

    return _PLACEHOLDER.sub(repl, template)


def build_command(
    spec: AgentSpec,
    model_name: str | None,
    instruction: str,
    *,
    budget: str | None = None,
    timeout: str | None = None,
) -> str:
    """Render ``spec.run_template`` into the concrete shell command.

    ``model_name`` is Arena-canonical ``provider/model``; ``{instruction}`` is
    shell-quoted here so callers must not quote it themselves.
    """
    model = model_name or spec.default_model or ""
    provider, sep, model_id = model.partition("/")
    if not sep:  # bare model id, no provider prefix
        provider, model_id = "", model

    mapping = {
        "bin": spec.binary,
        "model": model,
        "provider": provider,
        "model_id": model_id,
        "budget": budget if budget is not None else (spec.default_budget or ""),
        "timeout": timeout or "1800",
        "instruction": shlex.quote(instruction),
    }
    return render_template(spec.run_template, mapping)


def forwarded_env(spec: AgentSpec, environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Collect the host env vars to forward into the container: the spec's
    declared ``env_keys`` (API keys etc.) plus every ``ARENA_*`` var."""
    src = os.environ if environ is None else environ
    out: dict[str, str] = {}
    for key in spec.env_keys:
        if key in src:
            out[key] = src[key]
    for key, value in src.items():
        if key.startswith("ARENA_"):
            out[key] = value
    return out


def parse_version(stdout: str, version_regex: str | None) -> str:
    """First regex capture group, else the first non-empty output line."""
    text = stdout.strip()
    if version_regex:
        m = re.search(version_regex, text)
        if m:
            return (m.group(1) if m.groups() else m.group(0)).strip()
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return text
