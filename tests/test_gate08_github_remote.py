"""Tests for Gate 08: Validation of remote CI readiness, workflow integrity,
and safe remote discovery constraints.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
CI_WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


@pytest.fixture
def workflow_yaml() -> dict[str, Any]:
    assert CI_WORKFLOW_PATH.exists(), f"Workflow not found: {CI_WORKFLOW_PATH}"
    content = CI_WORKFLOW_PATH.read_text(encoding="utf-8")
    data = yaml.safe_load(content)
    assert isinstance(data, dict), "Workflow YAML must parse as a dictionary"
    return data


def test_remote_readiness_of_ci_workflow(workflow_yaml: dict[str, Any]) -> None:
    # 1. Triggers compatible with remote GitHub Actions
    assert "on" in workflow_yaml
    triggers = workflow_yaml["on"]
    assert "push" in triggers
    assert "pull_request" in triggers
    assert "workflow_dispatch" in triggers

    # 2. Windows runner target
    jobs = workflow_yaml.get("jobs", {})
    assert "windows-ci" in jobs
    assert jobs["windows-ci"].get("runs-on") == "windows-latest"

    # 3. Security: read-only permissions
    assert workflow_yaml.get("permissions") == {"contents": "read"}


def test_no_credential_leak_in_workflow_or_git_config() -> None:
    # Verify no tokens or keys embedded in workflow
    raw_workflow = CI_WORKFLOW_PATH.read_text(encoding="utf-8")
    for secret_marker in ["ghp_", "github_pat_", "sk-ant-", "bearer "]:
        assert secret_marker not in raw_workflow.lower(), f"Secret marker found: {secret_marker}"

    # Verify no tokens in git config
    git_config_path = REPO_ROOT / ".git" / "config"
    if git_config_path.exists():
        raw_config = git_config_path.read_text(encoding="utf-8")
        has_embedded_auth = "https://" in raw_config and "@" in raw_config
        assert not has_embedded_auth, "URL with credentials detected in git config!"


def test_git_head_has_ci_workflow() -> None:
    # Ensure HEAD commit tracks the CI workflow
    git_bin = shutil.which("git") or "git"
    result = subprocess.run(  # noqa: S603
        [git_bin, "ls-tree", "HEAD", ".github/workflows/ci.yml"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert ".github/workflows/ci.yml" in result.stdout
