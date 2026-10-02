"""Tests for EmulatedSandbox runtime backend, dry-run mode, and emulated report generation."""

from __future__ import annotations

import io
import json
import os
import tarfile
from pathlib import Path

import pytest

from strix.interface.cli_args import parse_arguments
from strix.report.sarif import build_sarif_report
from strix.report.state import ReportState
from strix.report.writer import write_executive_report
from strix.runtime.emulated import EmulatedSandboxClient, EmulatedSandboxSession
from strix.runtime.session_manager import cleanup, create_or_reuse


@pytest.fixture
def emulated_client(tmp_path: Path) -> EmulatedSandboxClient:
    return EmulatedSandboxClient(workspace_dir=tmp_path / "sandbox_workspace")


@pytest.mark.asyncio
async def test_client_create_and_delete(emulated_client: EmulatedSandboxClient) -> None:
    session = await emulated_client.create(name="test_session")
    assert isinstance(session, EmulatedSandboxSession)
    assert await session.running() is True
    assert session.supports_pty() is False
    assert session.workspace_path.exists()

    await emulated_client.delete(session)
    assert await session.running() is False


@pytest.mark.asyncio
async def test_file_read_write(emulated_client: EmulatedSandboxClient) -> None:
    session = await emulated_client.create()
    test_content = b"hello from emulated sandbox"
    await session.write(Path("test_file.txt"), io.BytesIO(test_content))

    data_io = await session.read(Path("test_file.txt"))
    assert data_io.read() == test_content

    # Path traversal safety check
    with pytest.raises(PermissionError):
        await session.read(Path("../../etc/passwd"))

    with pytest.raises(PermissionError):
        await session.write(Path("../../evil.txt"), io.BytesIO(b"evil"))

    await emulated_client.delete(session)


@pytest.mark.asyncio
async def test_hydrate_and_persist_workspace(emulated_client: EmulatedSandboxClient) -> None:
    session = await emulated_client.create()

    # Create in-memory tar
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
        data = b"initial payload file"
        ti = tarfile.TarInfo("init.txt")
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))
    tar_buf.seek(0)

    await session.hydrate_workspace(tar_buf)
    res_io = await session.read(Path("init.txt"))
    assert res_io.read() == b"initial payload file"

    # Write another file and persist workspace
    await session.write(Path("output.txt"), io.BytesIO(b"output content"))
    persisted_io = await session.persist_workspace()
    persisted_bytes = persisted_io.read()
    assert len(persisted_bytes) > 0

    with tarfile.open(fileobj=io.BytesIO(persisted_bytes), mode="r") as read_tar:
        names = read_tar.getnames()
        assert "init.txt" in names
        assert "output.txt" in names

    await emulated_client.delete(session)


@pytest.mark.asyncio
async def test_exec_filesystem_commands(emulated_client: EmulatedSandboxClient) -> None:
    session = await emulated_client.create()

    # pwd
    res_pwd = await session.exec("pwd")
    assert res_pwd.exit_code == 0
    assert "/workspace" in res_pwd.stdout.decode()

    # mkdir and ls
    res_mkdir = await session.exec("mkdir my_folder")
    assert res_mkdir.exit_code == 0
    res_ls = await session.exec("ls")
    assert res_ls.exit_code == 0
    assert "my_folder" in res_ls.stdout.decode()

    # cat
    await session.write(Path("my_folder/hello.txt"), io.BytesIO(b"world"))
    res_cat = await session.exec("cat my_folder/hello.txt")
    assert res_cat.exit_code == 0
    assert "world" in res_cat.stdout.decode()

    await emulated_client.delete(session)


@pytest.mark.asyncio
async def test_exec_simulated_tools_deterministic(emulated_client: EmulatedSandboxClient) -> None:
    session = await emulated_client.create()

    # nmap simulation
    res_nmap = await session.exec("nmap -sV -p 80,443 target.local")
    assert res_nmap.exit_code == 0
    assert "[EMULATED SANDBOX - DRY RUN MODE]" in res_nmap.stdout.decode()
    assert "STATE SERVICE VERSION" in res_nmap.stdout.decode()
    assert "80/tcp" in res_nmap.stdout.decode()

    # nuclei simulation
    res_nuclei = await session.exec("nuclei -u https://example.com -severity critical,high")
    assert res_nuclei.exit_code == 0
    assert "[EMULATED SANDBOX - DRY RUN MODE]" in res_nuclei.stdout.decode()
    assert "cve-2023-xxxx" in res_nuclei.stdout.decode()

    # sqlmap simulation
    res_sqlmap = await session.exec("sqlmap -u 'http://target.local/?id=1' --batch")
    assert res_sqlmap.exit_code == 0
    assert "[EMULATED SANDBOX - DRY RUN MODE]" in res_sqlmap.stdout.decode()
    assert "boolean-based blind" in res_sqlmap.stdout.decode()

    # semgrep simulation
    res_semgrep = await session.exec("semgrep --config auto .")
    assert res_semgrep.exit_code == 0
    assert "[EMULATED SANDBOX - DRY RUN MODE]" in res_semgrep.stdout.decode()
    assert "emulated.rule.simulated-finding" in res_semgrep.stdout.decode()

    # curl simulation
    res_curl = await session.exec("curl -I https://example.com")
    assert res_curl.exit_code == 0
    assert "HTTP/1.1 200 OK" in res_curl.stdout.decode()

    await emulated_client.delete(session)


@pytest.mark.asyncio
async def test_exec_unknown_command(emulated_client: EmulatedSandboxClient) -> None:
    session = await emulated_client.create()
    res = await session.exec("nonexistent_binary_foo_bar --option")
    assert res.exit_code == 0
    assert "[EMULATED SANDBOX - DRY RUN MODE]" in res.stdout.decode()
    await emulated_client.delete(session)


@pytest.mark.asyncio
async def test_session_manager_integration() -> None:
    os.environ["STRIX_RUNTIME_BACKEND"] = "emulated"
    scan_id = "test-scan-emulated-123"
    bundle = await create_or_reuse(
        scan_id,
        image="test-image",
        local_sources=[],
    )
    session = bundle["session"]
    assert isinstance(session, EmulatedSandboxSession)
    assert await session.running() is True
    assert bundle["caido_client"] is not None
    resolved_client = await bundle["caido_client"].get()
    assert resolved_client is None

    await cleanup(scan_id)
    assert await session.running() is False


def test_cli_dry_run_flag() -> None:
    args = parse_arguments(["-n", "-t", "http://example.local", "--dry-run"])
    assert args.dry_run is True
    assert os.environ.get("STRIX_RUNTIME_BACKEND") == "emulated"


def test_report_state_and_writer_tagging(tmp_path: Path) -> None:
    os.environ["STRIX_RUNTIME_BACKEND"] = "emulated"
    state = ReportState(run_name="test_run_tagging")
    state._run_dir = tmp_path / "run_test"
    state._run_dir.mkdir(parents=True, exist_ok=True)

    # Validate run record tagging
    run_rec = state.run_record
    assert run_rec.get("execution_mode") == "emulated"
    assert run_rec.get("runtime") == "EmulatedSandbox"

    # Add finding
    report_id = state.add_vulnerability_report(
        title="Simulated SQL Injection",
        severity="high",
        description="Deterministic fixture vulnerability for pipeline validation.",
        target="http://example.local",
    )
    state._save_artifacts()

    # Check saved finding json
    vulns_file = tmp_path / "run_test" / "vulnerabilities.json"
    assert vulns_file.exists()
    vulns = json.loads(vulns_file.read_text(encoding="utf-8"))
    assert len(vulns) == 1
    assert vulns[0]["execution_mode"] == "emulated"
    assert vulns[0]["source"] == "fixture"
    assert vulns[0]["runtime"] == "EmulatedSandbox"

    # Check vulnerability markdown
    vuln_md_path = tmp_path / "run_test" / "vulnerabilities" / f"{report_id}.md"
    assert vuln_md_path.exists()
    vuln_md = vuln_md_path.read_text(encoding="utf-8")
    assert "[!WARNING]" in vuln_md
    assert "SIMULATED FINDING (EMULATED SANDBOX / DRY RUN)" in vuln_md
    assert "EMULATED (Simulated Fixture)" in vuln_md

    # Check executive report
    write_executive_report(tmp_path / "run_test", "Executive summary of test scan.")
    exec_report_path = tmp_path / "run_test" / "penetration_test_report.md"
    exec_report_content = exec_report_path.read_text(encoding="utf-8")
    assert "SIMULATED SCAN REPORT (EMULATED SANDBOX / DRY RUN)" in exec_report_content

    # Check SARIF export
    sarif_doc = build_sarif_report(vulns)
    runs = sarif_doc.get("runs", [])
    assert len(runs) > 0
    results = runs[0].get("results", [])
    assert len(results) == 1
    res_props = results[0].get("properties", {})
    assert res_props.get("execution_mode") == "emulated"
    assert res_props.get("runtime") == "EmulatedSandbox"
    strix_props = res_props.get("strix", {})
    assert strix_props.get("execution_mode") == "emulated"
    assert strix_props.get("source") == "fixture"
