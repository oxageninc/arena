"""Spec loading + validation. Pure — no Harbor required."""

import json

import pytest

from arena_harbor.spec import (
    AgentSpec,
    load_spec_file,
    spec_from_dict,
)
from arena_harbor.specs_builtin import BUILTIN_SPECS, OXAGEN_SPEC, STELLA_SPEC


def _valid_dict():
    return {
        "name": "my-agent",
        "binary": "mycli",
        "run_template": "{bin} solve --model {model} {instruction}",
        "install": {"kind": "script", "script": "npm i -g mycli"},
    }


def test_spec_from_dict_minimal():
    spec = spec_from_dict(_valid_dict())
    assert isinstance(spec, AgentSpec)
    assert spec.name == "my-agent"
    assert spec.binary == "mycli"
    assert spec.install.kind == "script"


@pytest.mark.parametrize("missing", ["name", "binary", "run_template"])
def test_missing_required_field_raises(missing):
    data = _valid_dict()
    del data[missing]
    with pytest.raises(ValueError, match=missing):
        spec_from_dict(data)


def test_binary_install_requires_binary_env():
    data = _valid_dict()
    data["install"] = {"kind": "binary"}
    with pytest.raises(ValueError, match="binary_env"):
        spec_from_dict(data)


def test_script_install_requires_script_or_env():
    data = _valid_dict()
    data["install"] = {"kind": "script"}
    with pytest.raises(ValueError, match="script"):
        spec_from_dict(data)


def test_unknown_install_kind_rejected():
    data = _valid_dict()
    data["install"] = {"kind": "docker"}
    with pytest.raises(ValueError, match=r"binary.*script"):
        spec_from_dict(data)


def test_load_json_spec(tmp_path):
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(_valid_dict()))
    spec = load_spec_file(p)
    assert spec.name == "my-agent"


def test_load_toml_spec(tmp_path):
    p = tmp_path / "spec.toml"
    p.write_text(
        'name = "t"\n'
        'binary = "t"\n'
        'run_template = "{bin} {instruction}"\n'
        "[install]\n"
        'kind = "script"\n'
        'script = "true"\n'
    )
    spec = load_spec_file(p)
    assert spec.name == "t"
    assert spec.install.script == "true"


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_spec_file(tmp_path / "nope.toml")


def test_example_spec_file_is_valid():
    # The shipped BYO template must always parse.
    from pathlib import Path

    example = Path(__file__).resolve().parents[1] / "specs" / "byo.example.toml"
    spec = load_spec_file(example)
    assert spec.binary == "mycli"
    assert spec.metrics is not None


def test_builtin_specs_are_wellformed():
    assert set(BUILTIN_SPECS) == {"oxagen", "stella"}
    # oxagen reports combined input → must normalize by subtracting cache.
    assert OXAGEN_SPEC.metrics.input_includes_cache is True
    # stella uploads a native binary from a host env var.
    assert STELLA_SPEC.install.kind == "binary"
    assert STELLA_SPEC.install.binary_env == "ARENA_STELLA_BIN"
