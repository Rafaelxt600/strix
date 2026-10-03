"""Comprehensive test suite for Gate P1-2: Go TUI Implementation and Assisted Build.

Validates Go toolchain discovery, assisted cross-platform build automation,
CLI flag handling (--version / --help), ToolManager resolution and version probing,
security isolation (credential stripping), and Windows loopback IPC authentication.
"""

from __future__ import annotations

import os
import socket
import subprocess
import threading
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.build_tui import (
    build_tui,
    find_go_binary,
    get_go_version,
    tui_executable_name,
)
from strix.interface.tui import sidecar
from strix.interface.tui.backend.protocol import PROTOCOL_CAPABILITIES, PROTOCOL_VERSION
from strix.tools.manager import build_default_tool_manager


def test_go_toolchain_is_available() -> None:
    """Validate that Go 1.24+ is available in the environment."""
    go_bin = find_go_binary()
    assert go_bin is not None, "Go compiler binary not found on PATH or standard directories"
    assert go_bin.is_file(), f"Resolved Go binary does not exist: {go_bin}"

    major, minor, raw = get_go_version(go_bin)
    assert (major, minor) >= (1, 24), f"Expected Go >= 1.24, found: {raw}"


def test_build_tui_compilation(tmp_path: Path) -> None:
    """Validate that build_tui compiles a valid, executable sidecar binary."""
    go_bin = find_go_binary()
    if go_bin is None:
        pytest.skip("Go toolchain not available")

    target_exe = tmp_path / tui_executable_name()
    output_path, digest, size = build_tui(
        output_path=target_exe,
        copy_to_bin=False,
        go_binary=go_bin,
    )

    assert output_path == target_exe
    assert target_exe.is_file()
    assert size > 0
    assert len(digest) == 64  # SHA256 length


def test_strix_tui_cli_version_flag(tmp_path: Path) -> None:
    """Validate that strix-tui responds to --version and -v without requiring IPC."""
    go_bin = find_go_binary()
    if go_bin is None:
        pytest.skip("Go toolchain not available")

    target_exe = tmp_path / tui_executable_name()
    build_tui(output_path=target_exe, go_binary=go_bin)

    # Test --version with explicit STRIX_VERSION
    env = os.environ.copy()
    env["STRIX_VERSION"] = "1.6.2"
    res = subprocess.run(  # noqa: S603
        [str(target_exe), "--version"],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert res.returncode == 0
    assert res.stdout.strip() == "strix-tui v1.6.2"

    # Test -v shorthand
    res_short = subprocess.run(  # noqa: S603
        [str(target_exe), "-v"],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert res_short.returncode == 0
    assert res_short.stdout.strip() == "strix-tui v1.6.2"


def test_strix_tui_cli_help_flag(tmp_path: Path) -> None:
    """Validate that strix-tui responds to --help without requiring IPC."""
    go_bin = find_go_binary()
    if go_bin is None:
        pytest.skip("Go toolchain not available")

    target_exe = tmp_path / tui_executable_name()
    build_tui(output_path=target_exe, go_binary=go_bin)

    res = subprocess.run(  # noqa: S603
        [str(target_exe), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res.returncode == 0
    assert "Usage:" in res.stdout
    assert "--version" in res.stdout


def test_tool_manager_strix_tui_real_inspection(tmp_path: Path) -> None:
    """Validate that ToolManager resolves and probes the real strix-tui binary."""
    go_bin = find_go_binary()
    if go_bin is None:
        pytest.skip("Go toolchain not available")

    target_exe = tmp_path / tui_executable_name()
    build_tui(output_path=target_exe, go_binary=go_bin)

    manager = build_default_tool_manager()
    # Point the resolver to include our test directory
    manager.resolver.extra_search_paths.insert(0, tmp_path)

    # Confirm resolution
    resolved = manager.resolver.resolve("strix-tui")
    assert resolved is not None
    assert resolved.name == target_exe.name

    # Probe version with real execution
    with (
        patch.dict(os.environ, {"STRIX_VERSION": "1.6.2"}),
        patch.object(manager, "_is_emulated_mode", return_value=False),
    ):
        version = manager.inspect_version("strix-tui")
        assert version == "v1.6.2"


def test_child_environment_sanitization(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure sensitive credentials never reach the Go TUI child process."""
    sensitive_keys = {
        "OPENAI_API_KEY": "sk-secret-key-12345",
        "ANTHROPIC_API_KEY": "sk-ant-secret-key",
        "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
        "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "AWS_SESSION_TOKEN": "AQoDYXdzEJr1EXAMPLE",
        "GITHUB_TOKEN": "ghp_abcdef1234567890",
        "STRIX_TUI_TOKEN": "temp-token",
        "LLM_API_KEY": "llm-key",
        "SECRET_AUTH_KEY": "my-auth-secret",
    }
    for k, v in sensitive_keys.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("TERM", "xterm-256color")
    monkeypatch.setenv("LANG", "en_US.UTF-8")

    clean_env = sidecar.child_environment()

    assert clean_env.get("TERM") == "xterm-256color"
    assert clean_env.get("LANG") == "en_US.UTF-8"

    for k in sensitive_keys:
        assert k not in clean_env, f"Sensitive key leaked to child environment: {k}"


def test_windows_loopback_auth_handshake() -> None:
    """Validate loopback socket creation and HMAC token authentication."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    address = listener.getsockname()
    test_token = "secure-random-token-32bytes-long"  # noqa: S105

    def client_thread() -> None:
        with socket.create_connection(address) as s:
            s.sendall(test_token.encode("ascii"))

    t = threading.Thread(target=client_thread)
    t.start()

    conn = sidecar._accept_authenticated_connection(listener, test_token)
    assert conn is not None
    conn.close()
    listener.close()
    t.join()


def test_protocol_constants_conformance() -> None:
    """Ensure Go protocol.go and Python protocol.py declarations are strictly aligned."""
    go_protocol_path = (
        Path(__file__).resolve().parents[1]
        / "strix"
        / "interface"
        / "tui"
        / "internal"
        / "protocol"
        / "protocol.go"
    )
    assert go_protocol_path.is_file()
    source = go_protocol_path.read_text(encoding="utf-8")

    assert f"const Version = {PROTOCOL_VERSION}" in source
    for cap in PROTOCOL_CAPABILITIES:
        assert f'"{cap}"' in source
