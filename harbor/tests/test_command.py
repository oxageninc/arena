"""Command rendering + env forwarding. Pure — no Harbor required."""

from arena_harbor.command import build_command, forwarded_env, parse_version, render_template
from arena_harbor.spec import AgentSpec, InstallSpec
from arena_harbor.specs_builtin import OXAGEN_SPEC, STELLA_SPEC


def _spec(run_template, **kw):
    return AgentSpec(
        name="a",
        binary="mycli",
        run_template=run_template,
        install=InstallSpec(kind="script", script="true"),
        **kw,
    )


def test_render_template_replaces_known_leaves_unknown():
    out = render_template(
        "{bin} run {instruction} ${HOME} awk '{print $1}'",
        {"bin": "x", "instruction": "'go'"},
    )
    assert out == "x run 'go' ${HOME} awk '{print $1}'"


def test_build_command_splits_provider_and_quotes_instruction():
    spec = _spec("{bin} --provider {provider} --model {model_id} {instruction}")
    cmd = build_command(spec, "anthropic/claude-sonnet-5", "Fix the bug", budget="5", timeout="900")
    assert "--provider anthropic" in cmd
    assert "--model claude-sonnet-5" in cmd
    # instruction is shell-quoted for us
    assert "'Fix the bug'" in cmd


def test_build_command_bare_model_has_empty_provider():
    spec = _spec("{bin} -m {model} p={provider} i={model_id}")
    cmd = build_command(spec, "glm-5.2", "x")
    assert "-m glm-5.2" in cmd
    assert "p= " in cmd  # empty provider
    assert "i=glm-5.2" in cmd


def test_build_command_falls_back_to_default_model_and_budget():
    spec = _spec("{bin} {model} {budget} {instruction}", default_model="d/m", default_budget="7")
    cmd = build_command(spec, None, "task")
    assert "d/m" in cmd
    assert " 7 " in cmd


def test_instruction_with_shell_metachars_is_safe():
    spec = _spec("{bin} {instruction}")
    cmd = build_command(spec, "d/m", "rm -rf / ; echo $(whoami) `id`")
    # everything after {bin} is a single quoted token — no unquoted metachars
    assert cmd.startswith("mycli ")
    payload = cmd[len("mycli ") :]
    assert payload.startswith("'") and payload.endswith("'")


def test_forwarded_env_includes_declared_keys_and_arena_prefix():
    spec = _spec("{bin} {instruction}", env_keys=["MY_KEY", "ABSENT_KEY"])
    environ = {"MY_KEY": "secret", "ARENA_BUDGET": "3", "UNRELATED": "x"}
    env = forwarded_env(spec, environ)
    assert env == {"MY_KEY": "secret", "ARENA_BUDGET": "3"}


def test_parse_version_regex_then_first_line():
    assert parse_version("mycli v1.2.3 (build)", r"(\d+\.\d+\.\d+)") == "1.2.3"
    assert parse_version("mycli 9.9\nother", None) == "mycli 9.9"


def test_builtin_run_templates_render():
    oxa = build_command(OXAGEN_SPEC, "anthropic/claude-sonnet-5", "do it", budget="5")
    assert oxa.startswith("oxagen --local --output-format json --model anthropic/claude-sonnet-5")
    assert oxa.strip().endswith("'do it'")

    stella = build_command(STELLA_SPEC, "zai/glm-5.2", "do it", budget="5")
    assert stella == "stella --model zai/glm-5.2 --output-format json --budget 5 run 'do it'"
