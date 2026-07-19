"""Harbor-integration tests: install/run/metrics against a mocked environment.

Skipped automatically when Harbor isn't importable, so the pure logic tests
(spec/metrics/command) still run everywhere.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("harbor")

from arena_harbor import ByoAgent, OxagenAgent, StellaAgent


def _mk(agent_cls, tmp_path, model_name="anthropic/claude-sonnet-5"):
    return agent_cls(logs_dir=tmp_path, model_name=model_name)


def _mock_env(stdout="", return_code=0):
    env = MagicMock()
    result = MagicMock(return_code=return_code, stdout=stdout, stderr="")
    env.exec = AsyncMock(return_value=result)
    env.upload_file = AsyncMock()
    return env


def test_agent_names():
    assert OxagenAgent.name() == "oxagen"
    assert StellaAgent.name() == "stella"


def test_import_path_format():
    # This is exactly what users pass to `harbor --agent-import-path`.
    assert StellaAgent.import_path() == "arena_harbor.agents:StellaAgent"


def test_version_command_and_parse(tmp_path):
    agent = _mk(StellaAgent, tmp_path)
    assert agent.get_version_command() == "stella --version"
    assert agent.parse_version("stella 1.4.2") == "1.4.2"


async def test_binary_install_uploads_host_binary(tmp_path, monkeypatch):
    fake_bin = tmp_path / "stella"
    fake_bin.write_text("#!/bin/sh\n")
    monkeypatch.setenv("ARENA_STELLA_BIN", str(fake_bin))

    agent = _mk(StellaAgent, tmp_path, model_name="zai/glm-5.2")
    env = _mock_env()
    await agent.install(env)

    env.upload_file.assert_awaited_once()
    uploaded_from = env.upload_file.await_args.args[0]
    assert uploaded_from == str(fake_bin)
    # a cp/chmod into /usr/local/bin ran as root
    root_cmds = [c.kwargs.get("command", "") for c in env.exec.await_args_list]
    assert any("/usr/local/bin/stella" in c for c in root_cmds)


async def test_binary_install_missing_env_raises(tmp_path, monkeypatch):
    monkeypatch.delenv("ARENA_STELLA_BIN", raising=False)
    agent = _mk(StellaAgent, tmp_path, model_name="zai/glm-5.2")
    with pytest.raises(FileNotFoundError, match="ARENA_STELLA_BIN"):
        await agent.install(_mock_env())


async def test_script_install_uses_override_env(tmp_path, monkeypatch):
    monkeypatch.setenv("ARENA_OXAGEN_INSTALL", "npm i -g @acme/oxagen@1.2.3")
    agent = _mk(OxagenAgent, tmp_path)
    env = _mock_env()
    await agent.install(env)
    ran = [c.kwargs.get("command", "") for c in env.exec.await_args_list]
    assert any("npm i -g @acme/oxagen@1.2.3" in c for c in ran)


async def test_run_invokes_agent_and_captures_output(tmp_path):
    agent = _mk(OxagenAgent, tmp_path)
    envelope = (
        '{"type":"result","usage":'
        '{"inputTokens":1000,"outputTokens":200,"cachedInputTokens":400}}'
    )
    env = _mock_env(stdout=envelope)
    context = MagicMock(metadata={})

    await agent.run("Fix the failing test", env, context)

    # the built command carried the model, json flag, and quoted instruction
    run_cmd = env.exec.await_args_list[-1].kwargs["command"]
    assert "oxagen --local --output-format json --model anthropic/claude-sonnet-5" in run_cmd
    assert "'Fix the failing test'" in run_cmd
    assert agent._agent_output.strip().startswith("{")


async def test_run_does_not_raise_when_agent_errors(tmp_path):
    # A crashing agent must NOT abort the trial before the verifier runs.
    agent = _mk(OxagenAgent, tmp_path)
    env = MagicMock()
    env.exec = AsyncMock(side_effect=RuntimeError("boom"))
    context = MagicMock(metadata={})
    await agent.run("do it", env, context)  # should swallow the error
    assert "agent execution error" in agent._agent_output


async def test_metrics_populate_context(tmp_path):
    agent = _mk(StellaAgent, tmp_path, model_name="zai/glm-5.2")
    agent._agent_output = (
        '{"type":"result","usage":{"inputTokens":5000,"outputTokens":800,'
        '"cachedInputTokens":4000},"costUsd":0.12}'
    )
    context = MagicMock(metadata={}, cost_usd=None)
    agent.populate_context_post_run(context)
    assert context.cost_usd == 0.12
    assert context.metadata["arena_stella_input_tokens"] == 1000  # 5000 - 4000
    assert context.metadata["arena_stella_cache_read_tokens"] == 4000


def test_byo_agent_loads_spec_and_name(tmp_path, monkeypatch):
    spec_file = tmp_path / "byo.toml"
    spec_file.write_text(
        'name = "cool-agent"\n'
        'binary = "cool"\n'
        'run_template = "{bin} --model {model} {instruction}"\n'
        "[install]\n"
        'kind = "script"\n'
        'script = "true"\n'
    )
    monkeypatch.setenv("ARENA_AGENT_SPEC", str(spec_file))
    monkeypatch.setenv("ARENA_AGENT_NAME", "cool-agent")

    assert ByoAgent.name() == "cool-agent"
    agent = _mk(ByoAgent, tmp_path)
    assert agent.spec().binary == "cool"


def test_byo_agent_name_defaults(monkeypatch):
    monkeypatch.delenv("ARENA_AGENT_NAME", raising=False)
    assert ByoAgent.name() == "arena-byo"
