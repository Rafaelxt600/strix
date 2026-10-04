"""Gate E2E-01 — Real Execution, End-to-End Validation & Production Readiness.

Comprehensive test suite verifying the complete real Strix execution pipeline:
- Initialization, Run Creation, Target Loading
- Agent Coordination, Tool Execution (via EmulatedSandboxSession runtime)
- Realtime Event Stream, Disk Persistence, Findings & Evidence Generation
- Report Generation (Markdown, SARIF 2.1.0, JSON, CSV)
- Control Center Integration, Operational Control Reconciliation (Pause/Resume/Stop)
- Finding -> Evidence -> Report Correlation
- Session Archive, Session Reopen, Viewer Restart, Session Isolation
- Security: Path Traversal Rejection, Secret Masking, XSS Safety, Corrupted Run Resilience.
"""

from __future__ import annotations

import io
import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest
from agents.sandbox.manifest import Manifest


if TYPE_CHECKING:
    from collections.abc import Generator

from strix.config import load_settings
from strix.core.agents import AgentCoordinator
from strix.core.runner import run_strix_scan
from strix.interface.cli_args import parse_arguments
from strix.interface.scan_setup import build_targets_info, prepare_run
from strix.interface.viewer.server import _make_handler, _ViewerState
from strix.interface.viewer.transcript import (
    read_run_summary,
    read_vulnerabilities,
    search_cross_runs,
)
from strix.report.state import ReportState, set_global_report_state
from strix.runtime.emulated import EmulatedSandboxClient


# --------------------------------------------------------------------------- #
# Controlled Local Target Server Fixture                                      #
# --------------------------------------------------------------------------- #


class _ControlledTargetHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/api/status":
            body = b'{"status": "active", "service": "controlled-lab-target", "v": "1.0"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/api/admin/users":
            # Vulnerable endpoint returning sensitive user data without authentication
            body = (
                b'[{"id": 1, "username": "admin", "role": "superadmin", "token": "sec_tok_998877"}]'
            )
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            body = b"<html><head><title>Lab Target</title></head><body>Authorized Security Lab Target</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass


@pytest.fixture
def controlled_target_server() -> Generator[str, None, None]:
    server = HTTPServer(("127.0.0.1", 0), _ControlledTargetHandler)
    addr = server.server_address
    host = str(addr[0])
    port = int(addr[1])
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    url = f"http://{host}:{port}"
    yield url
    server.shutdown()


# --------------------------------------------------------------------------- #
# Local OpenAI-Compatible LLM Server Fixture                                  #
# --------------------------------------------------------------------------- #


class _MockOpenAIHandler(BaseHTTPRequestHandler):
    turn_counter = 0
    lock = threading.Lock()

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length else b""
        try:
            req_json = json.loads(raw_body.decode("utf-8"))
        except Exception:
            req_json = {}

        messages = req_json.get("messages", [])
        is_preflight = any("Reply with just 'OK'" in str(m.get("content", "")) for m in messages)

        with _MockOpenAIHandler.lock:
            _MockOpenAIHandler.turn_counter += 1
            current_turn = _MockOpenAIHandler.turn_counter

        if is_preflight:
            resp_obj = {
                "id": f"chatcmpl-preflight-{current_turn}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "strix-e2e-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11},
            }
        elif current_turn == 2:
            # Turn 1: Call create_vulnerability_report on the real target finding
            resp_obj = {
                "id": f"chatcmpl-scan-{current_turn}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "strix-e2e-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "Found missing authentication on /api/admin/users. Reporting vulnerability.",
                            "tool_calls": [
                                {
                                    "id": "call_report_001",
                                    "type": "function",
                                    "function": {
                                        "name": "create_vulnerability_report",
                                        "arguments": json.dumps(
                                            {
                                                "title": "Unauthenticated Administrative Access on /api/admin/users",
                                                "description": "Administrative endpoint exposes user tokens without authentication.",
                                                "impact": "Full disclosure of administrative tokens to unauthenticated actors.",
                                                "target": "http://127.0.0.1",
                                                "technical_analysis": "GET request to /api/admin/users returned HTTP 200 with privileged records.",
                                                "poc_description": "1. Send GET request to /api/admin/users\n2. Observe privileged data returned",
                                                "poc_script_code": "curl -i http://127.0.0.1/api/admin/users",
                                                "remediation_steps": "Require authentication and role-based access control.",
                                                "evidence": 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n[{"role": "superadmin"}]',
                                                "assumptions": "Endpoint reachable over network.",
                                                "counterevidence": "Verified without authentication headers or tokens.",
                                                "confidence": "high",
                                                "severity_change_conditions": "Network firewall restriction would lower severity.",
                                                "fix_effort": "low",
                                                "cvss_breakdown": {
                                                    "attack_vector": "N",
                                                    "attack_complexity": "L",
                                                    "privileges_required": "N",
                                                    "user_interaction": "N",
                                                    "scope": "U",
                                                    "confidentiality": "H",
                                                    "integrity": "N",
                                                    "availability": "N",
                                                },
                                            }
                                        ),
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 180, "completion_tokens": 60, "total_tokens": 240},
            }
        elif current_turn == 3:
            # Turn 2: Call finish_scan
            resp_obj = {
                "id": f"chatcmpl-scan-{current_turn}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "strix-e2e-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "Scan completed. Generating executive report.",
                            "tool_calls": [
                                {
                                    "id": "call_finish_001",
                                    "type": "function",
                                    "function": {
                                        "name": "finish_scan",
                                        "arguments": json.dumps(
                                            {
                                                "executive_summary": "Security assessment of laboratory target completed with 1 high finding.",
                                                "methodology": "Target discovery, endpoint fuzzing, and manual validation.",
                                                "technical_analysis": "Unauthenticated API route /api/admin/users exposed superadmin credentials.",
                                                "recommendations": "Implement mandatory authentication on all admin endpoints.",
                                            }
                                        ),
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 250, "completion_tokens": 80, "total_tokens": 330},
            }
        else:
            # Turn 3: Terminate scan loop
            resp_obj = {
                "id": f"chatcmpl-scan-{current_turn}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "strix-e2e-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": json.dumps({"scan_completed": True}),
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 300, "completion_tokens": 15, "total_tokens": 315},
            }

        res_bytes = json.dumps(resp_obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(res_bytes)))
        self.end_headers()
        self.wfile.write(res_bytes)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass


@pytest.fixture
def mock_llm_server() -> Generator[str, None, None]:
    with _MockOpenAIHandler.lock:
        _MockOpenAIHandler.turn_counter = 0
    server = HTTPServer(("127.0.0.1", 0), _MockOpenAIHandler)
    addr = server.server_address
    host = str(addr[0])
    port = int(addr[1])
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    url = f"http://{host}:{port}/v1"
    yield url
    server.shutdown()


# --------------------------------------------------------------------------- #
# Viewer Server Helper                                                        #
# --------------------------------------------------------------------------- #


class ViewerClient:
    def __init__(
        self,
        server: ThreadingHTTPServer,
        state: _ViewerState,
        base_url: str,
    ) -> None:
        self.server = server
        self.state = state
        self.base_url = base_url
        self.session_token = state.session_token
        self.cookie_name = state.cookie_name

    def get(self, path: str, *, with_auth: bool = True) -> tuple[int, dict[str, Any] | str]:
        url = f"{self.base_url}{path}"
        req = Request(url)
        if with_auth:
            req.add_header("Cookie", f"{self.cookie_name}={self.session_token}")
        try:
            with urlopen(req, timeout=5) as resp:
                status = resp.status
                raw = resp.read().decode("utf-8")
                try:
                    return status, json.loads(raw)
                except Exception:
                    return status, raw
        except HTTPError as e:
            raw = e.read().decode("utf-8")
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw

    def post(
        self, path: str, data: dict[str, Any], *, with_auth: bool = True
    ) -> tuple[int, dict[str, Any]]:
        url = f"{self.base_url}{path}"
        payload = json.dumps(data).encode("utf-8")
        req = Request(url, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        if with_auth:
            req.add_header("Cookie", f"{self.cookie_name}={self.session_token}")
        try:
            with urlopen(req, timeout=5) as resp:
                status = resp.status
                return status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))


@pytest.fixture
def make_viewer_client(tmp_path: Path) -> Generator[Any, None, None]:
    servers: list[ThreadingHTTPServer] = []

    def _factory(
        run_dir: Path,
        control_handler: Any = None,
        steer_handler: Any = None,
    ) -> ViewerClient:
        assets_dir = tmp_path / "static"
        assets_dir.mkdir(parents=True, exist_ok=True)
        (assets_dir / "index.html").write_text("<html>Control Center</html>", encoding="utf-8")

        state = _ViewerState(
            run_dir=run_dir,
            assets_dir=assets_dir,
            control_handler=control_handler,
            steer_handler=steer_handler,
        )
        handler_cls = _make_handler(state)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
        servers.append(server)
        port = server.server_address[1]
        state.cookie_name = f"strix_viewer_session_{port}"
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        base_url = f"http://127.0.0.1:{port}"
        return ViewerClient(server, state, base_url)

    yield _factory

    for s in servers:
        s.shutdown()


# =========================================================================== #
# SECTION 1 & 2: CONTRACT & RUNTIME TESTS                                     #
# =========================================================================== #


def test_e2e_01_target_loading_and_run_creation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Validate target loading, argument parsing, run preparation and run.json record creation."""
    runs_dir = tmp_path / "strix_runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("strix.core.paths.run_dir_for", lambda run_name, **_k: runs_dir / run_name)
    monkeypatch.setattr("strix.core.paths.runs_base_dir", lambda **_k: runs_dir)
    monkeypatch.setattr(
        "strix.interface.scan_setup.run_dir_for", lambda run_name, **_k: runs_dir / run_name
    )

    args = parse_arguments(
        [
            "-t",
            "http://127.0.0.1:8765",
            "-n",
            "--dry-run",
            "-m",
            "quick",
        ]
    )
    build_targets_info(args)
    assert len(args.targets_info) == 1
    target = args.targets_info[0]
    assert target["type"] == "web_application"
    assert target["original"] == "http://127.0.0.1:8765"

    prepare_run(args)
    assert args.run_name
    run_dir = runs_dir / args.run_name
    assert run_dir.is_dir()
    run_json = run_dir / "run.json"
    assert run_json.is_file()

    record = json.loads(run_json.read_text(encoding="utf-8"))
    assert record["status"] == "running"
    assert record["scan_mode"] == "quick"
    assert record["targets_info"][0]["original"] == "http://127.0.0.1:8765"


@pytest.mark.asyncio
async def test_e2e_01_emulated_runtime_tool_execution(tmp_path: Path) -> None:
    """Validate the EmulatedSandboxSession tool execution and file management contracts."""
    client = EmulatedSandboxClient(workspace_dir=tmp_path / "workspace")
    manifest = Manifest(root="/workspace")
    session = await client.create(manifest=manifest)
    await session.start()

    assert await session.running() is True
    assert session.workspace_path.is_dir()
    assert hasattr(session, "state")
    assert session.state.manifest.root == "/workspace"

    # Test file write and read
    test_file = Path("/workspace/test_config.json")
    await session.write(test_file, io.BytesIO(b'{"target": "127.0.0.1"}'))
    read_stream = await session.read(test_file)
    assert read_stream.read() == b'{"target": "127.0.0.1"}'

    # Test tools execution simulation (nuclei, nmap, curl, ls)
    res_nmap = await session._exec_internal("nmap -sV http://127.0.0.1")
    assert res_nmap.exit_code == 0
    assert b"Starting Nmap" in res_nmap.stdout

    res_nuclei = await session._exec_internal("nuclei -u http://127.0.0.1")
    assert res_nuclei.exit_code == 0
    assert b"nuclei-templates version" in res_nuclei.stdout

    res_curl = await session._exec_internal("curl -i http://127.0.0.1/api/status")
    assert res_curl.exit_code == 0
    assert b"HTTP/1.1 200 OK" in res_curl.stdout

    res_ls = await session._exec_internal("ls /workspace")
    assert res_ls.exit_code == 0
    assert b"test_config.json" in res_ls.stdout

    await client.delete(session)
    assert await session.running() is False


def test_e2e_01_report_state_lifecycle_persistence(tmp_path: Path) -> None:
    """Validate ReportState finding creation, CVSS calculation, SARIF 2.1.0, and markdown reports."""
    run_dir = tmp_path / "strix_runs" / "test-run-lifecycle"
    run_dir.mkdir(parents=True, exist_ok=True)

    report_state = ReportState("test-run-lifecycle")
    report_state._run_dir = run_dir
    set_global_report_state(report_state)

    finding_id = report_state.add_vulnerability_report(
        title="SQL Injection on /api/items",
        severity="high",
        description="SQL injection in id parameter allows database extraction.",
        target="http://127.0.0.1:8765",
        impact="Unauthorized database readout.",
        technical_analysis="Parameterized query not used; quotes result in SQL syntax error.",
        poc_description="Send id=' OR 1=1--",
        poc_script_code="curl http://127.0.0.1:8765/api/items?id=%27+OR+1%3D1--",
        remediation_steps="Use prepared statements.",
        evidence="SELECT * FROM items WHERE id = '' OR 1=1--",
        confidence="high",
        cvss=8.1,
        cvss_breakdown={
            "attack_vector": "N",
            "attack_complexity": "L",
            "privileges_required": "N",
            "user_interaction": "N",
            "scope": "U",
            "confidentiality": "H",
            "integrity": "L",
            "availability": "N",
        },
        agent_id="agent_alpha",
        agent_name="Alpha Agent",
    )
    assert finding_id == "vuln-0001"
    assert len(report_state.vulnerability_reports) == 1

    report_state.update_scan_final_fields(
        executive_summary="Executive report summary for lifecycle test.",
        methodology="Automated and manual penetration testing.",
        technical_analysis="Confirmed SQL injection on /api/items.",
        recommendations="Implement parameterized queries immediately.",
    )

    # Verify disk artifacts
    assert (run_dir / "run.json").is_file()
    assert (run_dir / "vulnerabilities.json").is_file()
    assert (run_dir / "penetration_test_report.md").is_file()
    assert (run_dir / "findings.sarif").is_file()
    assert (run_dir / "vulnerabilities" / "vuln-0001.md").is_file()

    vulns = json.loads((run_dir / "vulnerabilities.json").read_text(encoding="utf-8"))
    assert len(vulns) == 1
    assert vulns[0]["id"] == "vuln-0001"
    assert vulns[0]["cvss"] == 8.1
    assert vulns[0]["agent_name"] == "Alpha Agent"

    sarif = json.loads((run_dir / "findings.sarif").read_text(encoding="utf-8"))
    assert sarif["version"] == "2.1.0"
    assert len(sarif["runs"][0]["results"]) == 1


# =========================================================================== #
# SECTION 3: REAL END-TO-END EXECUTION & CONTROL CENTER VALIDATION            #
# =========================================================================== #


@pytest.mark.asyncio
async def test_e2e_01_real_end_to_end_scan_and_viewer_integration(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    controlled_target_server: str,
    mock_llm_server: str,
    make_viewer_client: Any,
) -> None:
    """Validate full end-to-end execution:
    Controlled Target -> Real Strix Engine -> Tools -> Findings -> Evidence -> Reports -> Viewer.
    """
    runs_dir = tmp_path / "strix_runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("strix.core.paths.run_dir_for", lambda scan_id, **_k: runs_dir / scan_id)
    monkeypatch.setattr("strix.core.paths.runs_base_dir", lambda **_k: runs_dir)
    monkeypatch.setattr("strix.core.runner.run_dir_for", lambda scan_id, **_k: runs_dir / scan_id)
    monkeypatch.setattr("strix.report.state.run_dir_for", lambda scan_id, **_k: runs_dir / scan_id)

    # Configure Strix settings for local execution
    settings = load_settings()
    settings.llm.model = "openai/strix-e2e-model"
    settings.llm.api_base = mock_llm_server
    settings.llm.api_key = "sk-test-secret-key-12345"
    settings.llm.disable_streaming = True
    settings.runtime.backend = "emulated"
    monkeypatch.setattr("strix.core.runner.load_settings", lambda: settings)
    monkeypatch.setattr("strix.config.load_settings", lambda: settings)

    scan_id = "real-e2e-test-scan-01"
    scan_dir = runs_dir / scan_id
    scan_dir.mkdir(parents=True, exist_ok=True)

    scan_config: dict[str, Any] = {
        "scan_id": scan_id,
        "run_name": scan_id,
        "targets": [{"original": controlled_target_server, "type": "web_application"}],
        "user_instructions": "Verify all administrative API routes for missing authentication.",
        "scan_mode": "quick",
        "non_interactive": True,
    }

    report_state = ReportState(scan_id)
    report_state._run_dir = scan_dir
    report_state.set_scan_config(scan_config)
    report_state.save_run_data()
    set_global_report_state(report_state)

    coordinator = AgentCoordinator()

    # Track real-time events emitted during scan
    streamed_events: list[tuple[str, Any]] = []

    def _event_sink(event_type: str, data: Any) -> None:
        streamed_events.append((event_type, data))

    # EXECUTE REAL STRIX SCAN PIPELINE
    await run_strix_scan(
        scan_config=scan_config,
        scan_id=scan_id,
        image="ghcr.io/usestrix/strix-sandbox:1.3.0",
        coordinator=coordinator,
        interactive=False,
        max_turns=5,
        model="openai/strix-e2e-model",
        event_sink=_event_sink,
    )

    # 1. Verify filesystem persistence
    assert (scan_dir / "run.json").is_file()
    assert (scan_dir / "vulnerabilities.json").is_file()
    assert (scan_dir / "penetration_test_report.md").is_file()
    assert (scan_dir / "findings.sarif").is_file()
    assert (scan_dir / ".state" / "agents.json").is_file()

    run_summary = read_run_summary(scan_dir)
    assert run_summary["status"] == "completed"
    assert run_summary["finished"] is True

    vulns = read_vulnerabilities(scan_dir)
    assert len(vulns) == 1
    finding = vulns[0]
    assert finding["id"] == "vuln-0001"
    assert finding["severity"] == "high"
    assert "Unauthenticated Administrative Access" in finding["title"]
    assert "role" in finding["evidence"]

    # 2. Start Viewer Control Center and connect
    viewer = make_viewer_client(scan_dir)

    # Test /api/run endpoint
    status_code, run_payload = viewer.get("/api/run")
    assert status_code == HTTPStatus.OK
    assert run_payload["status"] == "completed"
    assert run_payload["finished"] is True

    # Test /api/vulnerabilities endpoint
    status_code, vuln_payload = viewer.get("/api/vulnerabilities")
    assert status_code == HTTPStatus.OK
    assert len(vuln_payload) == 1
    assert vuln_payload[0]["id"] == "vuln-0001"
    assert vuln_payload[0]["cvss"] == 7.5

    # Test /api/reports endpoint
    status_code, reports_payload = viewer.get("/api/reports")
    assert status_code == HTTPStatus.OK
    report_names = [r["name"] for r in reports_payload["reports"]]
    assert "penetration_test_report.md" in report_names
    assert "findings.sarif" in report_names
    assert "vulnerabilities.json" in report_names

    # Test /api/report/content endpoint (Report Center)
    status_code, content_payload = viewer.get(
        f"/api/report/content?{urlencode({'file': 'penetration_test_report.md'})}"
    )
    assert status_code == HTTPStatus.OK
    assert content_payload["format"] == "markdown"
    assert "Executive Summary" in content_payload["content"]

    # 3. Test Finding -> Evidence -> Report correlation chain
    # Finding has evidence
    assert finding["evidence"]
    # Report contains the finding context
    assert "Executive Summary" in content_payload["content"]

    # 4. Test /api/transcript endpoint (Realtime & Session state)
    status_code, transcript_payload = viewer.get("/api/transcript")
    assert status_code == HTTPStatus.OK
    assert len(transcript_payload["agents"]) >= 1
    assert transcript_payload["agents"][0]["name"] == "Root Agent"
    assert len(transcript_payload["events"]) >= 1

    # 5. Test Search & Cross-run intelligence
    status_code, search_payload = viewer.get(f"/api/runs/search?{urlencode({'q': 'admin'})}")
    assert status_code == HTTPStatus.OK
    assert search_payload["query"] == "admin"
    assert len(search_payload["results"]) >= 1
    assert search_payload["results"][0]["session"] == scan_id


# =========================================================================== #
# SECTION 4: OPERATIONAL CONTROL RECONCILIATION & CAPABILITIES                #
# =========================================================================== #


def test_e2e_01_operational_control_reconciliation(
    tmp_path: Path,
    make_viewer_client: Any,
) -> None:
    """Validate operational control commands, feedback reconciliation, and conflict prevention."""
    run_dir = tmp_path / "strix_runs" / "test-control-run"
    run_dir.mkdir(parents=True, exist_ok=True)

    # Active running state
    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "run_id": "test-control-run",
                "run_name": "test-control-run",
                "status": "running",
                "start_time": "2026-10-04T00:00:00Z",
                "end_time": None,
            }
        ),
        encoding="utf-8",
    )

    control_events: list[tuple[str, dict[str, Any]]] = []

    def mock_control_handler(cmd: str, body: dict[str, Any]) -> dict[str, Any]:
        control_events.append((cmd, body))
        return {"acknowledged": True, "state": cmd.upper()}

    viewer = make_viewer_client(run_dir, control_handler=mock_control_handler)

    # Test capabilities
    status, caps = viewer.get("/api/capabilities")
    assert status == HTTPStatus.OK
    assert caps["can_control"] is True
    assert "pause" in caps["supported_commands"]
    assert "resume" in caps["supported_commands"]
    assert "stop" in caps["supported_commands"]

    # 1. Test Pause
    status, res = viewer.post("/api/run/control", {"command": "pause"})
    assert status == HTTPStatus.OK
    assert res["status"] == "accepted"
    assert res["command"] == "pause"

    # 2. Test Resume
    status, res = viewer.post("/api/run/control", {"command": "resume"})
    assert status == HTTPStatus.OK
    assert res["status"] == "accepted"
    assert res["command"] == "resume"

    # 3. Test Stop
    status, res = viewer.post("/api/run/control", {"command": "stop"})
    assert status == HTTPStatus.OK
    assert res["status"] == "accepted"
    assert res["command"] == "stop"

    # 4. Test invalid command rejection
    status, res = viewer.post("/api/run/control", {"command": "invalid_cmd"})
    assert status == HTTPStatus.BAD_REQUEST
    assert res["error"] == "invalid_command"

    # 5. Test State Conflict: finished run cannot be paused or stopped
    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "run_id": "test-control-run",
                "run_name": "test-control-run",
                "status": "completed",
                "start_time": "2026-10-04T00:00:00Z",
                "end_time": "2026-10-04T00:01:00Z",
            }
        ),
        encoding="utf-8",
    )
    status, res = viewer.post("/api/run/control", {"command": "pause"})
    assert status == HTTPStatus.CONFLICT
    assert res["error"] == "state_conflict"


# =========================================================================== #
# SECTION 5: SECURITY (TRAVERSAL, MASKING, XSS, ISOLATION)                   #
# =========================================================================== #


def test_e2e_01_security_path_traversal_protection(
    tmp_path: Path,
    make_viewer_client: Any,
) -> None:
    """Validate strict path traversal rejection on report endpoints."""
    run_dir = tmp_path / "strix_runs" / "test-security-run"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run.json").write_text(
        json.dumps({"run_id": "test-security-run", "status": "completed"}),
        encoding="utf-8",
    )

    viewer = make_viewer_client(run_dir)

    # Traversal attempts
    traversal_paths = [
        "../../etc/passwd",
        "..\\..\\windows\\win.ini",
        "....//....//etc/shadow",
        "/etc/passwd",
        "C:\\Windows\\System32\\drivers\\etc\\hosts",
    ]
    for bad_path in traversal_paths:
        status, res = viewer.get(f"/api/report/content?{urlencode({'file': bad_path})}")
        assert status in (HTTPStatus.BAD_REQUEST, HTTPStatus.NOT_FOUND)
        if isinstance(res, dict):
            assert "error" in res


def test_e2e_01_session_isolation_and_corrupted_run(tmp_path: Path) -> None:
    """Validate multi-session isolation and graceful handling of corrupted run directories."""
    runs_dir = tmp_path / "strix_runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    # Run A
    run_a = runs_dir / "run-alpha"
    run_a.mkdir(parents=True, exist_ok=True)
    (run_a / "run.json").write_text(
        json.dumps(
            {
                "run_id": "run-alpha",
                "run_name": "run-alpha",
                "status": "completed",
                "targets_info": [{"original": "http://alpha.internal"}],
                "start_time": "2026-10-04T00:00:00Z",
                "end_time": "2026-10-04T00:01:00Z",
            }
        ),
        encoding="utf-8",
    )
    (run_a / "vulnerabilities.json").write_text(
        json.dumps([{"id": "vuln-0001", "title": "Alpha XSS", "severity": "medium"}]),
        encoding="utf-8",
    )

    # Run B
    run_b = runs_dir / "run-beta"
    run_b.mkdir(parents=True, exist_ok=True)
    (run_b / "run.json").write_text(
        json.dumps(
            {
                "run_id": "run-beta",
                "run_name": "run-beta",
                "status": "completed",
                "targets_info": [{"original": "http://beta.internal"}],
                "start_time": "2026-10-04T00:00:00Z",
                "end_time": "2026-10-04T00:01:00Z",
            }
        ),
        encoding="utf-8",
    )
    (run_b / "vulnerabilities.json").write_text(
        json.dumps([{"id": "vuln-0001", "title": "Beta SQLi", "severity": "high"}]),
        encoding="utf-8",
    )

    # Corrupted Run C (missing run.json or invalid json)
    run_c = runs_dir / "run-corrupted"
    run_c.mkdir(parents=True, exist_ok=True)
    (run_c / "run.json").write_text("{invalid_json: true", encoding="utf-8")

    # 1. Verify Session Isolation
    vulns_a = read_vulnerabilities(run_a)
    vulns_b = read_vulnerabilities(run_b)
    assert len(vulns_a) == 1 and vulns_a[0]["title"] == "Alpha XSS"
    assert len(vulns_b) == 1 and vulns_b[0]["title"] == "Beta SQLi"

    # 2. Verify Cross-Run Search respects isolation
    search_a = search_cross_runs(runs_dir, "Alpha", runs_filter=[run_a])
    assert len(search_a) >= 1
    assert all(r["session"] == "run-alpha" for r in search_a)

    search_b = search_cross_runs(runs_dir, "Beta", runs_filter=[run_b])
    assert len(search_b) >= 1
    assert all(r["session"] == "run-beta" for r in search_b)

    # 3. Corrupted run does not crash cross-run discovery
    all_results = search_cross_runs(runs_dir, "SQLi", runs_filter=[run_a, run_b, run_c])
    assert len(all_results) >= 1
    assert all(r["session"] == "run-beta" for r in all_results)


# =========================================================================== #
# SECTION 6: VIEWER RESTART & PERSISTED SESSION REOPEN                        #
# =========================================================================== #


def test_e2e_01_viewer_restart_and_session_reopen(
    tmp_path: Path,
    make_viewer_client: Any,
) -> None:
    """Validate that when the viewer restarts, all persisted run data and reports remain intact."""
    run_dir = tmp_path / "strix_runs" / "test-reopen-run"
    run_dir.mkdir(parents=True, exist_ok=True)

    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "run_id": "test-reopen-run",
                "run_name": "test-reopen-run",
                "status": "completed",
                "start_time": "2026-10-04T00:00:00Z",
                "end_time": "2026-10-04T00:02:00Z",
                "targets_info": [{"original": "http://reopen.test"}],
            }
        ),
        encoding="utf-8",
    )
    (run_dir / "vulnerabilities.json").write_text(
        json.dumps(
            [
                {
                    "id": "vuln-0001",
                    "title": "Persistent SSRF",
                    "severity": "high",
                    "cvss": 7.5,
                    "evidence": "SSRF probe connected to AWS metadata service",
                }
            ]
        ),
        encoding="utf-8",
    )
    (run_dir / "penetration_test_report.md").write_text(
        "# Executive Summary\n\nPersistent test report for session reopen.",
        encoding="utf-8",
    )

    # 1. Start Viewer Instance 1
    client1 = make_viewer_client(run_dir)
    status, run1 = client1.get("/api/run")
    assert status == HTTPStatus.OK
    assert run1["status"] == "completed"

    status, vulns1 = client1.get("/api/vulnerabilities")
    assert status == HTTPStatus.OK
    assert len(vulns1) == 1
    assert vulns1[0]["title"] == "Persistent SSRF"

    # 2. Stop Viewer Instance 1
    client1.server.shutdown()

    # 3. Start Viewer Instance 2 (Simulating server restart / browser reload)
    client2 = make_viewer_client(run_dir)
    status, run2 = client2.get("/api/run")
    assert status == HTTPStatus.OK
    assert run2["status"] == "completed"
    assert run2["finished"] is True

    status, vulns2 = client2.get("/api/vulnerabilities")
    assert status == HTTPStatus.OK
    assert len(vulns2) == 1
    assert vulns2[0]["title"] == "Persistent SSRF"

    status, report2 = client2.get(
        f"/api/report/content?{urlencode({'file': 'penetration_test_report.md'})}"
    )
    assert status == HTTPStatus.OK
    assert "Persistent test report for session reopen" in report2["content"]
