"""Agent specifications — the declarative contract that turns *any* coding CLI
into a Harbor agent.

A spec says three things: how to get the agent's binary into the container
(``install``), how to invoke it one-shot on a task (``run_template``), and how
to read token/cost numbers back out of its output (``metrics``). Built-in
agents (oxagen, stella) ship as Python specs; a user wires up their own agent
by writing one of these as TOML/JSON and pointing ``ARENA_AGENT_SPEC`` at it —
no Python required.

This module imports nothing from Harbor, so it (and its tests) run anywhere.
"""

from __future__ import annotations

import json
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

InstallKind = Literal["binary", "script"]


@dataclass(frozen=True)
class InstallSpec:
    """How the agent binary gets into the (Linux) container.

    ``binary`` uploads a host executable — fast, but the host binary must be
    built for the container's OS/arch (Linux, usually x86-64), so a macOS build
    won't run. ``script`` runs an arbitrary shell snippet as root (npm/pip/curl
    /tarball) and is the portable default.
    """

    kind: InstallKind = "script"
    #: For ``binary``: host env var holding the path to the executable to upload.
    binary_env: str | None = None
    #: For ``script``: shell run as root; must leave ``AgentSpec.binary`` on PATH.
    script: str | None = None
    #: For ``script``: env var that, if set, overrides ``script`` at run time.
    script_env: str | None = None
    #: Best-effort OS packages ensured before install (apt/apk/yum).
    system_packages: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class MetricsSpec:
    """How to recover token/cost numbers from the agent's stdout.

    Best-effort and secondary — the headline resolve-rate always comes from
    Harbor's official verifier, never from these numbers. ``json_tail`` reads
    the last JSON object the agent printed and pulls values by dotted path;
    ``regex`` scrapes a human summary line.
    """

    kind: Literal["json_tail", "regex"] = "json_tail"
    # json_tail dotted paths (e.g. "usage.inputTokens")
    input_path: str | None = None
    output_path: str | None = None
    cache_read_path: str | None = None
    cost_path: str | None = None
    #: True when the agent's reported input count already includes cache reads,
    #: so normalized input = reported_input - cache_read (matches Arena's TS
    #: adapters, keeping cross-agent token counts comparable).
    input_includes_cache: bool = False
    # regex alternative: each pattern's first capture group is the number
    cost_regex: str | None = None
    input_regex: str | None = None
    output_regex: str | None = None
    total_regex: str | None = None


@dataclass(frozen=True)
class AgentSpec:
    """A complete recipe for running one coding CLI under Harbor."""

    name: str
    #: The binary/command that must be on PATH after install.
    binary: str
    #: Shell template invoking the agent one-shot. Recognized placeholders:
    #: ``{bin} {model} {provider} {model_id} {budget} {timeout} {instruction}``.
    #: ``{instruction}`` is shell-quoted for you; unknown ``{...}`` are left
    #: untouched so shell/awk braces survive.
    run_template: str
    install: InstallSpec = field(default_factory=InstallSpec)
    version_command: str | None = None
    #: Regex whose first group is the version (else the first output line).
    version_regex: str | None = None
    #: Host env vars (API keys etc.) forwarded into the container.
    env_keys: list[str] = field(default_factory=list)
    default_model: str | None = None
    default_budget: str | None = None
    metrics: MetricsSpec | None = None


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    raise ValueError(f"expected a list, got {type(value).__name__}")


def spec_from_dict(data: dict[str, Any]) -> AgentSpec:
    """Build an :class:`AgentSpec` from a plain dict (parsed TOML/JSON).

    Raises ``ValueError`` with a precise message on any missing/mistyped field,
    so a broken bring-your-own spec fails loudly at load time, not mid-run.
    """
    for required in ("name", "binary", "run_template"):
        if not data.get(required):
            raise ValueError(f"agent spec missing required field '{required}'")

    install_raw = data.get("install") or {}
    if not isinstance(install_raw, dict):
        raise ValueError("'install' must be a table/object")
    kind = install_raw.get("kind", "script")
    if kind not in ("binary", "script"):
        raise ValueError(f"install.kind must be 'binary' or 'script', got '{kind}'")
    install = InstallSpec(
        kind=kind,
        binary_env=install_raw.get("binary_env"),
        script=install_raw.get("script"),
        script_env=install_raw.get("script_env"),
        system_packages=_as_list(install_raw.get("system_packages")),
    )
    if kind == "binary" and not install.binary_env:
        raise ValueError("install.kind='binary' requires 'binary_env'")
    if kind == "script" and not (install.script or install.script_env):
        raise ValueError(
            "install.kind='script' requires 'script' or 'script_env'"
        )

    metrics = None
    metrics_raw = data.get("metrics")
    if metrics_raw is not None:
        if not isinstance(metrics_raw, dict):
            raise ValueError("'metrics' must be a table/object")
        metrics_kind = metrics_raw.get("kind", "json_tail")
        if metrics_kind not in ("json_tail", "regex"):
            raise ValueError(
                f"metrics.kind must be 'json_tail' or 'regex', got '{metrics_kind}'"
            )
        metrics = MetricsSpec(
            kind=metrics_kind,
            input_path=metrics_raw.get("input_path"),
            output_path=metrics_raw.get("output_path"),
            cache_read_path=metrics_raw.get("cache_read_path"),
            cost_path=metrics_raw.get("cost_path"),
            input_includes_cache=bool(metrics_raw.get("input_includes_cache", False)),
            cost_regex=metrics_raw.get("cost_regex"),
            input_regex=metrics_raw.get("input_regex"),
            output_regex=metrics_raw.get("output_regex"),
            total_regex=metrics_raw.get("total_regex"),
        )

    return AgentSpec(
        name=str(data["name"]),
        binary=str(data["binary"]),
        run_template=str(data["run_template"]),
        install=install,
        version_command=data.get("version_command"),
        version_regex=data.get("version_regex"),
        env_keys=_as_list(data.get("env_keys")),
        default_model=data.get("default_model"),
        default_budget=(
            str(data["default_budget"]) if data.get("default_budget") is not None else None
        ),
        metrics=metrics,
    )


def load_spec_file(path: str | Path) -> AgentSpec:
    """Load an :class:`AgentSpec` from a ``.toml`` or ``.json`` file."""
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"agent spec file not found: {p}")
    text = p.read_text()
    data = json.loads(text) if p.suffix.lower() == ".json" else tomllib.loads(text)
    if not isinstance(data, dict):
        raise ValueError(f"{p}: top level must be a table/object")
    return spec_from_dict(data)


def load_spec_from_env(env_var: str = "ARENA_AGENT_SPEC") -> AgentSpec:
    """Load the bring-your-own spec named by ``env_var`` (default
    ``ARENA_AGENT_SPEC``)."""
    path = os.environ.get(env_var)
    if not path:
        raise ValueError(
            f"{env_var} is not set. Point it at your agent's spec file "
            f"(see specs/byo.example.toml)."
        )
    return load_spec_file(path)
