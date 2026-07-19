"""Best-effort token/cost extraction from an agent's stdout.

Secondary to Harbor's verifier by design: these numbers annotate a trial, they
never decide it. Normalization mirrors Arena's TypeScript adapters so token
counts are comparable across agents — most importantly, ``input`` never
includes cache reads.

Harbor-free; unit-tested in isolation.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, fields
from typing import Any

from .spec import MetricsSpec


@dataclass(frozen=True)
class ParsedMetrics:
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None

    def as_metadata(self, agent_name: str) -> dict[str, Any]:
        prefix = f"arena_{agent_name.replace('-', '_')}"
        return {
            f"{prefix}_{f.name}": getattr(self, f.name)
            for f in fields(self)
            if getattr(self, f.name) is not None
        }

    def is_empty(self) -> bool:
        return all(getattr(self, f.name) is None for f in fields(self))


def last_json_object(text: str) -> dict[str, Any] | None:
    """Return the last ``{"type":"result"}`` JSON object in ``text`` (JSONL, a
    single object, or a pretty-printed multi-line object), else the last
    parseable object. Non-JSON lines are ignored. Mirrors the TS
    ``parseJsonEnvelope``.
    """
    if not text:
        return None
    fallback: dict[str, Any] | None = None
    for line in reversed([ln.strip() for ln in text.splitlines() if ln.strip().startswith("{")]):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        if fallback is None:
            fallback = obj
        if obj.get("type") == "result":
            return obj

    # No single-line result envelope: pretty-printed envelopes span lines, so
    # fall back to a string-aware brace scan over the whole output.
    scanned = _scan_json_objects(text)
    for obj in reversed(scanned):
        if obj.get("type") == "result":
            return obj
    if fallback is not None:
        return fallback
    return scanned[-1] if scanned else None


def _scan_json_objects(text: str) -> list[dict[str, Any]]:
    """Find top-level JSON objects in text that may contain non-JSON noise.

    Candidates are anchored at lines that START with ``{`` (a pretty-printed
    envelope's opening line), so a stray brace mid-way through a log line can
    never derail the scan. From each anchor, string-aware brace matching finds
    the balanced end; spans that fail to parse are skipped.
    """
    found: list[dict[str, Any]] = []
    offset = 0
    consumed_up_to = -1
    for line in text.split("\n"):
        line_start = offset
        offset += len(line) + 1
        if line_start < consumed_up_to:
            continue  # inside an already-parsed object
        stripped = line.lstrip()
        if not stripped.startswith("{"):
            continue
        start = line_start + (len(line) - len(stripped))
        end = _balanced_object_end(text, start)
        if end == -1:
            continue
        try:
            obj = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            continue  # balanced braces but not JSON (shell/awk) — skip
        if isinstance(obj, dict):
            found.append(obj)
            consumed_up_to = end + 1
    return found


def _balanced_object_end(text: str, start: int) -> int:
    """Index of the ``}`` closing the object opened at ``start``, or -1."""
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def dotted_get(obj: Any, path: str | None) -> Any:
    """Resolve a dotted path (``a.b.c``) into nested dicts; None if absent."""
    if not path:
        return None
    current = obj
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return int(value)
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return float(value)
    return None


def extract_metrics(text: str, spec: MetricsSpec) -> ParsedMetrics:
    """Extract normalized metrics from agent output per ``spec``.

    Returns an all-None :class:`ParsedMetrics` (``is_empty()``) when nothing
    parseable is found — the caller then simply records no metrics.
    """
    if spec.kind == "regex":
        return _extract_regex(text, spec)
    return _extract_json(text, spec)


def _extract_json(text: str, spec: MetricsSpec) -> ParsedMetrics:
    env = last_json_object(text)
    if env is None:
        return ParsedMetrics()

    raw_input = _as_int(dotted_get(env, spec.input_path))
    output = _as_int(dotted_get(env, spec.output_path))
    cache_read = _as_int(dotted_get(env, spec.cache_read_path))
    cost = _as_float(dotted_get(env, spec.cost_path))

    norm_input = raw_input
    if spec.input_includes_cache and raw_input is not None and cache_read is not None:
        norm_input = max(0, raw_input - cache_read)

    total = None
    parts = [p for p in (norm_input, output, cache_read) if p is not None]
    if parts:
        total = sum(parts)

    return ParsedMetrics(
        input_tokens=norm_input,
        output_tokens=output,
        cache_read_tokens=cache_read,
        total_tokens=total,
        cost_usd=cost,
    )


def _first_number(pattern: str | None, text: str) -> float | None:
    if not pattern:
        return None
    m = re.search(pattern, text)
    if not m or not m.groups():
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except (ValueError, IndexError):
        return None


def _extract_regex(text: str, spec: MetricsSpec) -> ParsedMetrics:
    cost = _first_number(spec.cost_regex, text)
    input_tokens = _first_number(spec.input_regex, text)
    output = _first_number(spec.output_regex, text)
    total = _first_number(spec.total_regex, text)
    return ParsedMetrics(
        input_tokens=int(input_tokens) if input_tokens is not None else None,
        output_tokens=int(output) if output is not None else None,
        total_tokens=int(total) if total is not None else None,
        cost_usd=cost,
    )
