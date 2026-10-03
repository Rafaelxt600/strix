"""Tests for Gate 04: P1 Tool Manager and Go Tools management."""

from __future__ import annotations

import hashlib
import os
import subprocess
from typing import TYPE_CHECKING
from unittest.mock import patch

from strix.tools.manager import (
    ToolDefinition,
    ToolManager,
    ToolMetadata,
    ToolResolver,
    ToolResult,
    build_default_tool_manager,
    get_tool_manager,
)


if TYPE_CHECKING:
    from pathlib import Path


def test_tool_metadata_and_os_support() -> None:
    meta_all = ToolMetadata(
        name="test_tool",
        binary="test",
        category="scanner",
        supported_os=("linux", "darwin", "win32"),
    )
    assert meta_all.is_os_supported("linux") is True
    assert meta_all.is_os_supported("win32") is True
    assert meta_all.is_os_supported("nt") is True
    assert meta_all.is_os_supported("freebsd") is False

    meta_linux_only = ToolMetadata(
        name="linux_tool",
        binary="linux_bin",
        category="scanner",
        supported_os=("linux",),
    )
    assert meta_linux_only.is_os_supported("linux") is True
    assert meta_linux_only.is_os_supported("win32") is False


def test_tool_resolver(tmp_path: Path) -> None:
    # Create fake executable in tmp_path
    fake_bin = tmp_path / ("fake_cmd.exe" if os.name == "nt" else "fake_cmd")
    fake_bin.write_text("#!/bin/sh\necho 1.0\n")
    fake_bin.chmod(0o755)

    resolver = ToolResolver(extra_search_paths=[tmp_path])
    resolved = resolver.resolve("fake_cmd")
    assert resolved is not None
    assert resolved.name == fake_bin.name

    # Non-existent binary
    assert resolver.resolve("non_existent_binary_xyz_123") is None


def test_tool_manager_registration_and_lookup() -> None:
    manager = ToolManager()
    def_tool = ToolDefinition(
        metadata=ToolMetadata(
            name="custom_recon",
            binary="crecon",
            category="recon",
            min_version="v1.0.0",
        ),
        version_args=["-v"],
        simulated_output="[SIM] custom_recon v1.0.0\n",
    )
    manager.register(def_tool)

    assert manager.get("custom_recon") == def_tool
    assert manager.get("CUSTOM_RECON") == def_tool  # Case-insensitive
    assert manager.get("unknown") is None

    recon_tools = manager.list_tools(category="recon")
    assert len(recon_tools) == 1
    assert recon_tools[0].metadata.name == "custom_recon"

    scanner_tools = manager.list_tools(category="scanner")
    assert len(scanner_tools) == 0


def test_default_tool_manager_roster() -> None:
    manager = build_default_tool_manager()
    go_tools = manager.list_tools()

    expected_tools = {
        "nuclei",
        "httpx",
        "katana",
        "naabu",
        "ffuf",
        "subfinder",
        "govulncheck",
        "interactsh-client",
        "strix-tui",
    }
    registered_names = {t.metadata.name for t in go_tools}
    for expected in expected_tools:
        assert expected in registered_names, f"Expected {expected} in ToolManager roster"
        definition = manager.get(expected)
        assert definition is not None
        assert definition.metadata.is_go_tool is True

    # Cached singleton
    singleton = get_tool_manager()
    assert singleton is not None
    assert singleton.get("nuclei") is not None


def test_inspect_version_emulated() -> None:
    manager = build_default_tool_manager()
    with patch.dict(os.environ, {"STRIX_RUNTIME_BACKEND": "emulated"}):
        version = manager.inspect_version("nuclei")
        assert version == "v3.0.0"
        assert manager.inspect_version("unknown_tool") is None


def test_execute_emulated_dry_run() -> None:
    manager = build_default_tool_manager()
    with patch.dict(os.environ, {"STRIX_RUNTIME_BACKEND": "emulated"}):
        res = manager.execute("nuclei", ["-u", "http://target.local"])
        assert isinstance(res, ToolResult)
        assert res.success is True
        assert res.exit_code == 0
        assert res.execution_mode == "emulated"
        assert res.runtime == "EmulatedSandbox"
        assert res.source == "fixture"
        assert "[EMULATED SANDBOX - DRY RUN MODE]" in res.stdout
        assert "cve-2023-xxxx" in res.stdout


def test_execute_unknown_tool() -> None:
    manager = build_default_tool_manager()
    res = manager.execute("non_existent_tool_404", ["-arg"])
    assert res.success is False
    assert res.exit_code == 1
    assert "Unknown tool" in res.stderr
    assert res.failure_reason is not None


def test_execute_missing_binary_on_host() -> None:
    manager = ToolManager()
    manager.register(
        ToolDefinition(
            metadata=ToolMetadata(
                name="missing_cli",
                binary="definitely_not_on_path_binary_999",
                category="scanner",
            )
        )
    )
    # Force real execution mode
    res = manager.execute("missing_cli", ["--help"], emulated=False)
    assert res.success is False
    assert res.exit_code == 127
    assert "Binary not found" in res.stderr
    assert "PATH" in str(res.failure_reason)


def test_execute_timeout_handling() -> None:
    manager = ToolManager()
    manager.register(
        ToolDefinition(
            metadata=ToolMetadata(
                name="hang_tool",
                binary="python" if os.name != "nt" else "python.exe",
                category="test",
            )
        )
    )
    # Mock subprocess.run to raise TimeoutExpired
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["mock"], timeout=0.1)):
        res = manager.execute(
            "hang_tool",
            ["-c", "import time; time.sleep(1)"],
            emulated=False,
            timeout=0.1,
        )
        assert res.success is False
        assert res.timeout is True
        assert res.exit_code == 124
        assert "timed out" in res.stderr


def test_fixture_determinism() -> None:
    manager = build_default_tool_manager()
    with patch.dict(os.environ, {"STRIX_RUNTIME_BACKEND": "emulated"}):
        tools = ["nuclei", "httpx", "katana", "naabu", "ffuf", "subfinder"]
        for tool_name in tools:
            res1 = manager.execute(tool_name, ["--test"], emulated=True)
            res2 = manager.execute(tool_name, ["--test"], emulated=True)
            res3 = manager.execute(tool_name, ["--test"], emulated=True)

            h1 = hashlib.sha256(res1.stdout.encode()).hexdigest()
            h2 = hashlib.sha256(res2.stdout.encode()).hexdigest()
            h3 = hashlib.sha256(res3.stdout.encode()).hexdigest()

            assert h1 == h2 == h3, f"Non-deterministic output for {tool_name}"
            assert res1.exit_code == res2.exit_code == res3.exit_code == 0


def test_security_command_injection_prevention() -> None:
    manager = ToolManager()
    manager.register(
        ToolDefinition(
            metadata=ToolMetadata(
                name="echo_tool",
                binary="echo",
                category="test",
            )
        )
    )

    # In emulated mode: arguments are preserved as an array in ToolResult.command
    res = manager.execute("echo_tool", ["hello; rm -rf /", "`id`", "$(whoami)"], emulated=True)
    assert res.command == ["echo", "hello; rm -rf /", "`id`", "$(whoami)"]
    assert res.exit_code == 0
