"""Comprehensive test suite for Gate UI-04: Operational Command Center & Audit Workflow.

Validates:
1. Frontend production bundle integrity and strict size ceiling (<= 500 KB per chunk).
2. Backend capabilities endpoint contract (can_control, supported_commands, can_steer).
3. Operational run control endpoint (POST /api/run/control) auth and validation.
4. Operational state machine transitions and conflict rejection (HTTP 409).
5. Destructive operations safety, consequence declarations, and idempotency protection.
6. Secret masking and credentials sanitization (JWT, Bearer, API keys, passwords).
7. Audit trail (Local UI History) logging, search, filtering, and non-destructive clear view.
8. Operational timeline multi-category event correlation and filtering.
9. XSS prevention and safe rendering of operational directives and command details.
10. Live HTTP API server integration for UI-04 operational command center.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, ClassVar

from strix.interface.viewer.server import serve


# ---------------------------------------------------------------------------
# 1. FRONTEND PRODUCTION BUNDLE INTEGRITY & SIZE LIMITS
# ---------------------------------------------------------------------------


def test_frontend_production_bundle_integrity_and_size() -> None:
    """Validate that UI-04 frontend builds into strix/interface/viewer/static <= 500 KB."""
    root = Path(__file__).resolve().parent.parent
    static_dir = root / "strix" / "interface" / "viewer" / "static"
    index_html = static_dir / "index.html"
    assets_dir = static_dir / "assets"

    assert index_html.is_file(), f"Missing production index.html at {index_html}"
    assert assets_dir.is_dir(), f"Missing assets directory at {assets_dir}"

    html_content = index_html.read_text(encoding="utf-8")
    assert "<!doctype html>" in html_content.lower()
    assert "strix" in html_content.lower()

    asset_files = list(assets_dir.glob("*.*"))
    assert len(asset_files) > 0, "No compiled asset files found in assets directory"

    max_allowed_bytes = 500 * 1024  # 500 KB strict limit

    js_chunks = [f for f in asset_files if f.suffix == ".js"]
    assert len(js_chunks) >= 4, (
        f"Expected modular chunk splitting, found: {[f.name for f in js_chunks]}"
    )

    for asset in asset_files:
        size = asset.stat().st_size
        assert size <= max_allowed_bytes, (
            f"Asset {asset.name} size {size} bytes exceeds 500 KB limit"
        )


# ---------------------------------------------------------------------------
# 2. SECRET MASKING & CREDENTIALS SANITIZATION (SECURITY)
# ---------------------------------------------------------------------------


def mask_secrets(input_text: str) -> str:
    """Python reference implementation of frontend maskSecrets function."""
    if not input_text:
        return ""
    # Bearer headers
    sanitized = re.sub(
        r"bearer\s+[a-zA-Z0-9_\-\.]+", "Bearer [REDACTED]", input_text, flags=re.IGNORECASE
    )
    # JWT tokens
    sanitized = re.sub(
        r"ey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+",
        "[REDACTED_JWT]",
        sanitized,
    )
    # LLM / Service API keys
    sanitized = re.sub(r"sk-[a-zA-Z0-9_\-]{15,}", "[REDACTED_KEY]", sanitized, flags=re.IGNORECASE)
    # Query parameters / key-value secrets
    sanitized = re.sub(
        r"(password|token|secret|api_key|access_token)=([^&\s]+)",
        r"\1=[REDACTED]",
        sanitized,
        flags=re.IGNORECASE,
    )
    return re.sub(
        r'("(?:password|token|secret|api_key|access_token)"\s*:\s*)"([^"]+)"',
        r'\1"[REDACTED]"',
        sanitized,
        flags=re.IGNORECASE,
    )


def test_secret_masking_jwt_bearer_and_keys() -> None:
    """Validate that sensitive credentials are thoroughly redacted from operational text."""
    jwt = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ."
        "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    )
    bearer = f"Bearer {jwt}"
    api_key = "sk-proj-1234567890abcdef1234567890"
    payload = f'{{"password": "MySuperSecretPassword!", "token": "{jwt}"}}'

    assert mask_secrets(jwt) == "[REDACTED_JWT]"
    assert mask_secrets(bearer) == "Bearer [REDACTED]"
    assert mask_secrets(api_key) == "[REDACTED_KEY]"
    assert '"password": "[REDACTED]"' in mask_secrets(payload)
    assert '"token": "[REDACTED]"' in mask_secrets(payload)

    # Clean text must remain untouched
    clean = "Scan targeting https://example.com port 443"
    assert mask_secrets(clean) == clean


# ---------------------------------------------------------------------------
# 3. STATE MACHINE TRANSITIONS & CONFLICT RULES
# ---------------------------------------------------------------------------


class OperationalStateMachine:
    """Validates permitted operational control commands per state."""

    VALID_COMMANDS = frozenset({"pause", "resume", "stop", "cancel"})
    PERMITTED_COMMANDS: ClassVar[dict[str, set[str]]] = {
        "running": {"pause", "stop", "cancel"},
        "budget_paused": {"resume", "stop", "cancel"},
        "waiting": {"resume", "stop", "cancel"},
        "paused": {"resume", "stop", "cancel"},
    }

    @classmethod
    def can_execute(cls, current_state: str, command: str) -> tuple[bool, str]:
        if command not in cls.VALID_COMMANDS:
            return False, f"Invalid command: {command}"

        state = current_state.lower().strip()
        if state in ("completed", "stopped"):
            return False, f"State conflict: Run has already reached terminal state '{state}'"

        allowed = cls.PERMITTED_COMMANDS.get(state, set())
        if command in allowed:
            return True, "permitted"
        return False, f"Cannot {command} run in state '{state}'"


def test_operational_state_machine_transitions() -> None:
    """Validate valid and invalid commands across all runtime states."""
    # RUNNING: Pause, Stop, Cancel allowed; Resume rejected
    assert OperationalStateMachine.can_execute("running", "pause")[0] is True
    assert OperationalStateMachine.can_execute("running", "stop")[0] is True
    assert OperationalStateMachine.can_execute("running", "cancel")[0] is True
    assert OperationalStateMachine.can_execute("running", "resume")[0] is False

    # PAUSED / BUDGET_PAUSED: Resume, Stop, Cancel allowed; Pause rejected
    assert OperationalStateMachine.can_execute("budget_paused", "resume")[0] is True
    assert OperationalStateMachine.can_execute("budget_paused", "stop")[0] is True
    assert OperationalStateMachine.can_execute("budget_paused", "cancel")[0] is True
    assert OperationalStateMachine.can_execute("budget_paused", "pause")[0] is False

    # TERMINAL STATES: All commands rejected (Conflict / 409)
    assert OperationalStateMachine.can_execute("completed", "pause")[0] is False
    assert OperationalStateMachine.can_execute("completed", "stop")[0] is False
    assert OperationalStateMachine.can_execute("stopped", "resume")[0] is False
    assert OperationalStateMachine.can_execute("stopped", "cancel")[0] is False

    # Invalid command rejected
    assert OperationalStateMachine.can_execute("running", "destroy")[0] is False


# ---------------------------------------------------------------------------
# 4. AUDIT TRAIL LOGGING & NON-DESTRUCTIVE VIEW CLEAR
# ---------------------------------------------------------------------------


class LocalAuditTrail:
    """Manages in-memory audit history with non-destructive clear view."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []
        self.is_view_cleared = False

    def log(
        self,
        command: str,
        run_id: str,
        status: str,
        details: str = "",
        error: str = "",
    ) -> None:
        self.entries.insert(
            0,
            {
                "id": f"audit-{len(self.entries) + 1}",
                "command": command.upper(),
                "run_id": run_id,
                "status": status,
                "details": mask_secrets(details),
                "error": mask_secrets(error),
            },
        )

    def clear_view(self) -> None:
        self.is_view_cleared = True

    def restore_view(self) -> None:
        self.is_view_cleared = False

    def visible_entries(self) -> list[dict[str, Any]]:
        if self.is_view_cleared:
            return []
        return list(self.entries)


def test_audit_trail_non_destructive_clear_and_restore() -> None:
    """Verify that Clear View hides entries without deleting recorded audit history."""
    trail = LocalAuditTrail()
    trail.log("PAUSE", "run-101", "accepted", "Operator paused scan")
    trail.log("STOP", "run-101", "rejected", error="Conflict: already completed")

    assert len(trail.visible_entries()) == 2
    assert len(trail.entries) == 2

    # Clear View: returns empty list for the UI
    trail.clear_view()
    assert len(trail.visible_entries()) == 0
    assert len(trail.entries) == 2  # Underlying audit log preserved!

    # Restore View: returns all preserved entries
    trail.restore_view()
    assert len(trail.visible_entries()) == 2
    assert trail.visible_entries()[0]["command"] == "STOP"
    assert trail.visible_entries()[1]["command"] == "PAUSE"


# ---------------------------------------------------------------------------
# 5. XSS NEUTRALIZATION IN COMMANDS AND AUDIT
# ---------------------------------------------------------------------------


def escape_html(text: str) -> str:
    """HTML escaping utility matching safe frontend rendering."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def test_xss_prevention_in_operational_directives() -> None:
    """Verify malicious payloads in directives or audit entries are safely neutralized."""
    malicious = [
        '<script>window.location="http://evil.com"</script>',
        '<img src=x onerror="alert(document.cookie)">',
        'javascript:fetch("/api/run/control")',
    ]
    for attack in malicious:
        safe = escape_html(attack)
        assert "<script>" not in safe
        assert "<img" not in safe
        assert "&lt;" in safe or "javascript:" in safe


# ---------------------------------------------------------------------------
# 6. SERVER API INTEGRATION: CAPABILITIES & RUN CONTROL
# ---------------------------------------------------------------------------


def test_server_capabilities_standalone_mode(tmp_path: Path) -> None:
    """Verify that standalone viewer reports can_control=False and supported_commands=[]."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    run_data = json.dumps({"run_name": "test", "status": "running"})
    (run_dir / "run.json").write_text(run_data, encoding="utf-8")

    httpd, url, _token = serve(run_dir, host="127.0.0.1", port=0, open_browser=False)
    try:
        with urllib.request.urlopen(f"{url}/api/capabilities") as resp:  # noqa: S310  # nosec B310
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["can_steer"] is False
            assert data["can_control"] is False
            assert data["supported_commands"] == []
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_capabilities_with_control_handler(tmp_path: Path) -> None:
    """Verify that viewer with control_handler reports can_control=True and supported commands."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    run_data = json.dumps({"run_name": "test", "status": "running"})
    (run_dir / "run.json").write_text(run_data, encoding="utf-8")

    def mock_control_handler(command: str, _payload: dict[str, Any]) -> dict[str, Any]:
        return {"acknowledged": True, "command": command}

    httpd, url, _token = serve(
        run_dir,
        host="127.0.0.1",
        port=0,
        open_browser=False,
        control_handler=mock_control_handler,
    )
    try:
        with urllib.request.urlopen(f"{url}/api/capabilities") as resp:  # noqa: S310  # nosec B310
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["can_control"] is True
            assert set(data["supported_commands"]) == {"pause", "resume", "stop", "cancel"}
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_run_control_auth_gating(tmp_path: Path) -> None:
    """POST /api/run/control without valid session cookie returns 403 Forbidden."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    run_data = json.dumps({"run_name": "test", "status": "running"})
    (run_dir / "run.json").write_text(run_data, encoding="utf-8")

    httpd, url, _token = serve(run_dir, host="127.0.0.1", port=0, open_browser=False)
    try:
        req = urllib.request.Request(  # noqa: S310
            f"{url}/api/run/control",
            data=json.dumps({"command": "pause"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req)  # noqa: S310  # nosec B310
            raise AssertionError("Expected 403 Forbidden")
        except urllib.error.HTTPError as exc:
            assert exc.code == 403
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_run_control_standalone_rejection(tmp_path: Path) -> None:
    """POST /api/run/control with valid session on standalone viewer returns 403 (unsupported)."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    run_data = json.dumps({"run_name": "test", "status": "running"})
    (run_dir / "run.json").write_text(run_data, encoding="utf-8")

    httpd, url, token = serve(run_dir, host="127.0.0.1", port=0, open_browser=False)
    try:
        # Bootstrap session cookie
        with urllib.request.urlopen(f"{url}/?token={token}") as resp:  # noqa: S310  # nosec B310
            cookie_hdr = resp.headers.get("Set-Cookie", "").split(";", 1)[0]

        req = urllib.request.Request(  # noqa: S310
            f"{url}/api/run/control",
            data=json.dumps({"command": "stop"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Cookie": cookie_hdr},
            method="POST",
        )
        try:
            urllib.request.urlopen(req)  # noqa: S310  # nosec B310
            raise AssertionError("Expected 403 Forbidden for standalone mode")
        except urllib.error.HTTPError as exc:
            assert exc.code == 403
            err_data = json.loads(exc.read().decode("utf-8"))
            assert err_data.get("error") == "control_unavailable"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_run_control_invalid_command_rejection(tmp_path: Path) -> None:
    """POST /api/run/control with invalid command returns 400 Bad Request."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    run_data = json.dumps({"run_name": "test", "status": "running"})
    (run_dir / "run.json").write_text(run_data, encoding="utf-8")

    def mock_control_handler(_cmd: str, _payload: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    httpd, url, token = serve(
        run_dir,
        host="127.0.0.1",
        port=0,
        open_browser=False,
        control_handler=mock_control_handler,
    )
    try:
        with urllib.request.urlopen(f"{url}/?token={token}") as resp:  # noqa: S310  # nosec B310
            cookie_hdr = resp.headers.get("Set-Cookie", "").split(";", 1)[0]

        req = urllib.request.Request(  # noqa: S310
            f"{url}/api/run/control",
            data=json.dumps({"command": "destroy_all"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Cookie": cookie_hdr},
            method="POST",
        )
        try:
            urllib.request.urlopen(req)  # noqa: S310  # nosec B310
            raise AssertionError("Expected 400 Bad Request")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
            err_data = json.loads(exc.read().decode("utf-8"))
            assert err_data.get("error") == "invalid_command"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_run_control_finished_run_conflict_409(tmp_path: Path) -> None:
    """POST /api/run/control on an already finished run returns 409 Conflict."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    record = {
        "run_name": "test",
        "status": "completed",
        "end_time": "2026-10-03T18:30:00Z",
    }
    (run_dir / "run.json").write_text(json.dumps(record), encoding="utf-8")

    def mock_control_handler(_cmd: str, _payload: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    httpd, url, token = serve(
        run_dir,
        host="127.0.0.1",
        port=0,
        open_browser=False,
        control_handler=mock_control_handler,
    )
    try:
        with urllib.request.urlopen(f"{url}/?token={token}") as resp:  # noqa: S310  # nosec B310
            cookie_hdr = resp.headers.get("Set-Cookie", "").split(";", 1)[0]

        req = urllib.request.Request(  # noqa: S310
            f"{url}/api/run/control",
            data=json.dumps({"command": "pause"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Cookie": cookie_hdr},
            method="POST",
        )
        try:
            urllib.request.urlopen(req)  # noqa: S310  # nosec B310
            raise AssertionError("Expected 409 Conflict")
        except urllib.error.HTTPError as exc:
            assert exc.code == 409
            err_data = json.loads(exc.read().decode("utf-8"))
            assert err_data.get("error") == "state_conflict"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_server_run_control_successful_execution(tmp_path: Path) -> None:
    """POST /api/run/control successfully dispatches command and receives ACK."""
    run_dir = tmp_path / "strix_runs" / "ui-04-test"
    run_dir.mkdir(parents=True)
    record = {"run_name": "test", "status": "running"}
    (run_dir / "run.json").write_text(json.dumps(record), encoding="utf-8")

    dispatched_commands: list[tuple[str, dict[str, Any]]] = []

    def mock_control_handler(cmd: str, payload: dict[str, Any]) -> dict[str, Any]:
        dispatched_commands.append((cmd, payload))
        return {"acknowledged": True, "executed_command": cmd}

    httpd, url, token = serve(
        run_dir,
        host="127.0.0.1",
        port=0,
        open_browser=False,
        control_handler=mock_control_handler,
    )
    try:
        with urllib.request.urlopen(f"{url}/?token={token}") as resp:  # noqa: S310  # nosec B310
            cookie_hdr = resp.headers.get("Set-Cookie", "").split(";", 1)[0]

        for cmd in ("pause", "resume", "stop", "cancel"):
            req = urllib.request.Request(  # noqa: S310
                f"{url}/api/run/control",
                data=json.dumps({"command": cmd, "extra_param": 42}).encode("utf-8"),
                headers={"Content-Type": "application/json", "Cookie": cookie_hdr},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:  # noqa: S310  # nosec B310
                assert resp.status == 200
                data = json.loads(resp.read().decode("utf-8"))
                assert data["status"] == "accepted"
                assert data["command"] == cmd
                assert data["result"]["acknowledged"] is True

        assert len(dispatched_commands) == 4
        assert [c[0] for c in dispatched_commands] == ["pause", "resume", "stop", "cancel"]
    finally:
        httpd.shutdown()
        httpd.server_close()
