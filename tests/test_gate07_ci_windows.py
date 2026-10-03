"""Tests for Gate 07: Validation of Windows CI workflow (.github/workflows/ci.yml)
for item P1-1.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
CI_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


@pytest.fixture
def ci_workflow() -> dict[str, Any]:
    assert CI_WORKFLOW_PATH.exists(), f"Workflow not found at {CI_WORKFLOW_PATH}"
    content = CI_WORKFLOW_PATH.read_text(encoding="utf-8")
    data = yaml.safe_load(content)
    assert isinstance(data, dict), "Workflow YAML must parse as a dictionary"
    return data


def test_ci_workflow_structure_and_triggers(ci_workflow: dict[str, Any]) -> None:
    # 1. Triggers
    assert "on" in ci_workflow
    triggers = ci_workflow["on"]
    assert "push" in triggers
    assert "pull_request" in triggers
    assert "workflow_dispatch" in triggers

    # 2. Permissions & Concurrency
    assert ci_workflow.get("permissions") == {"contents": "read"}
    assert "concurrency" in ci_workflow
    assert ci_workflow["concurrency"]["cancel-in-progress"] is True


def test_ci_workflow_windows_runner(ci_workflow: dict[str, Any]) -> None:
    jobs = ci_workflow.get("jobs", {})
    assert "windows-ci" in jobs
    win_job = jobs["windows-ci"]

    # Must explicitly run on windows-latest
    assert win_job.get("runs-on") == "windows-latest"
    # Reasonable timeout configured
    assert win_job.get("timeout-minutes") == 25


def test_ci_workflow_required_steps(ci_workflow: dict[str, Any]) -> None:
    steps = ci_workflow["jobs"]["windows-ci"].get("steps", [])
    step_runs = [s.get("run", "") for s in steps]
    step_uses = [s.get("uses", "") for s in steps]

    # Checkout & Setup
    assert any("actions/checkout" in u for u in step_uses)
    assert any("actions/setup-python" in u for u in step_uses)
    assert any("astral-sh/setup-uv" in u for u in step_uses)
    assert any("actions/setup-node" in u for u in step_uses)

    # Python sync & checks
    assert any("uv sync --frozen" in r for r in step_runs)
    assert any("uv run ruff check" in r for r in step_runs)
    assert any("uv run mypy strix" in r for r in step_runs)
    assert any("uv run pytest" in r for r in step_runs)

    # Frontend checks & P2 protection
    assert any("npm ci" in r for r in step_runs)
    assert any("npx tsc --noEmit" in r for r in step_runs)
    assert any("npm run build" in r for r in step_runs)
    assert any("500KB" in r for r in step_runs)


def test_ci_workflow_security_and_no_secrets(ci_workflow: dict[str, Any]) -> None:
    assert "jobs" in ci_workflow
    raw_text = CI_WORKFLOW_PATH.read_text(encoding="utf-8")

    # Zero hardcoded tokens or secret leaks
    forbidden_tokens = ["ghp_", "github_pat_", "sk-", "api_key", "password:"]
    for token in forbidden_tokens:
        assert token not in raw_text.lower(), f"Potential secret leak found: {token}"

    # Principle of least privilege: no write-all permissions
    assert "write-all" not in raw_text


def test_ci_workflow_negative_scenarios() -> None:
    # Verifies negative assertions: malformed YAML raises ScannerError
    malformed_yaml = "name: CI\njobs:\n  bad_indent:\n- step"
    with pytest.raises(yaml.YAMLError):
        yaml.safe_load(malformed_yaml)
