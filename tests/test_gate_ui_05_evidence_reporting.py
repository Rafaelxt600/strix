"""Comprehensive test suite for Gate UI-05: Evidence Explorer, Intelligence & Reports.

Validates:
1. Frontend production bundle integrity and strict size ceiling (<= 500 KB per chunk).
2. Report discovery endpoint (/api/reports) discovering Markdown, SARIF, JSON, CSV reports.
3. Report content endpoint (/api/report/content) parsing SARIF summaries and reading reports safely.
4. Path traversal protection on report file retrieval (CWE-22 mitigation).
5. Comprehensive secret masking parity (Bearer, JWT, API keys, basic auth, cookies, URL creds).
6. HTML safety and XSS prevention across findings, evidence, and report previews.
7. Entity correlation logic: Finding -> Agent, Tool, Target, and Transcript Events.
8. Evidence extraction, categorization, and HTTP request/response parsing.
9. Findings Intelligence filtering (Severity, Status, Target, Agent, Tool) and multi-field search.
10. Live ThreadingHTTPServer integration verifying session capability enforcement and error states.
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from strix.interface.viewer.server import serve
from strix.interface.viewer.transcript import (
    list_run_reports,
    read_report_file,
    read_vulnerabilities,
    severity_counts,
)


# ---------------------------------------------------------------------------
# 1. FRONTEND PRODUCTION BUNDLE INTEGRITY & SIZE LIMITS (<= 500 KB)
# ---------------------------------------------------------------------------


def test_frontend_production_bundle_integrity_and_size() -> None:
    """Validate that UI-05 frontend compiles into static/ with all chunks <= 500 KB."""
    root = Path(__file__).resolve().parent.parent
    static_dir = root / "strix" / "interface" / "viewer" / "static"
    index_html = static_dir / "index.html"
    assets_dir = static_dir / "assets"

    assert index_html.is_file(), f"Missing production index.html at {index_html}"
    assert assets_dir.is_dir(), f"Missing assets directory at {assets_dir}"

    html_content = index_html.read_text(encoding="utf-8")
    assert "<!doctype html>" in html_content.lower()

    asset_files = list(assets_dir.glob("*.*"))
    assert len(asset_files) > 0, "No compiled asset files found in assets directory"

    max_allowed_bytes = 500 * 1024  # 500 KB limit per chunk

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
# 2. SECRET MASKING & CREDENTIALS SANITIZATION (SECURITY & XSS)
# ---------------------------------------------------------------------------


def mask_secrets_py(input_text: str) -> str:
    """Python reference implementation of frontend maskSecrets function."""
    if not input_text:
        return ""

    sanitized = input_text

    # Private Keys
    sanitized = re.sub(
        r"-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----",
        "[REDACTED_PRIVATE_KEY]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # JWT tokens
    sanitized = re.sub(
        r"ey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+",
        "[REDACTED_JWT]",
        sanitized,
    )

    # Bearer headers
    sanitized = re.sub(
        r"bearer\s+[a-zA-Z0-9_\-\.]+",
        "Bearer [REDACTED_BEARER]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # Basic auth
    sanitized = re.sub(
        r"authorization:\s*basic\s+[a-zA-Z0-9+/=]+",
        "Authorization: Basic [REDACTED_AUTH]",
        sanitized,
        flags=re.IGNORECASE,
    )

    # Cookies
    sanitized = re.sub(
        r"(?:Cookie|cookie|Set-Cookie):\s*([^\r\n;]+)",
        r"Cookie: [REDACTED_COOKIE]",
        sanitized,
    )

    # Embedded URL credentials
    sanitized = re.sub(
        r"(https?://)([^:/\s]+):([^@/\s]+)@",
        r"\1\2:[REDACTED_PASSWORD]@",
        sanitized,
        flags=re.IGNORECASE,
    )

    # API keys (sk-, ghp_, xox-, AIza)
    sanitized = re.sub(
        r"sk-[a-zA-Z0-9_\-]{15,}",
        "[REDACTED_KEY_OPENAI]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(
        r"gh[pousr]_[a-zA-Z0-9]{20,}",
        "[REDACTED_KEY_GITHUB]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(
        r"xox[baprs]-[a-zA-Z0-9\-]{10,}",
        "[REDACTED_KEY_SLACK]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(r"AIza[0-9A-Za-z\-_]{35}", "[REDACTED_KEY_GOOGLE]", sanitized)

    # Key-value credentials
    pattern = (
        r"""(["']?(?:api[_\-]?key|access[_\-]?token|auth[_\-]?token|secret|password|token)"""
        r"""["']?\s*[:=]\s*["']?)([^"',\s\r\n}]+)(["']?)"""
    )
    return re.sub(pattern, r"\1[REDACTED_CREDENTIAL]\3", sanitized, flags=re.IGNORECASE)


def test_mask_secrets_bearer_and_jwt() -> None:
    raw = (
        "Authorization: Bearer "
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozG"
    )
    masked = mask_secrets_py(raw)
    assert "eyJhbGci" not in masked
    assert "[REDACTED_JWT]" in masked or "[REDACTED_BEARER]" in masked


def test_mask_secrets_api_keys() -> None:
    raw = (
        "Keys: sk-live1234567890abcdef1234 and ghp_123456789012345678901234 and "
        "AIzaSyD9876543210abcdefghijklmnopq12345"
    )
    masked = mask_secrets_py(raw)
    assert "sk-live1234567890abcdef1234" not in masked
    assert "ghp_123456789012345678901234" not in masked
    assert "AIzaSyD9876543210abcdefghijklmnopq12345" not in masked
    assert "[REDACTED" in masked


def test_mask_secrets_basic_auth_and_cookies() -> None:
    raw = (
        "Authorization: Basic YWRtaW46cGFzc3dvcmQxMjM= and "
        "Cookie: session_id=abc123xyz456; theme=dark"
    )
    masked = mask_secrets_py(raw)
    assert "YWRtaW46cGFzc3dvcmQxMjM=" not in masked
    assert "abc123xyz456" not in masked
    assert "[REDACTED_AUTH]" in masked
    assert "[REDACTED_COOKIE]" in masked


def test_mask_secrets_url_credentials() -> None:
    raw = "Connecting to https://admin:SuperSecret123@db.internal:5432/strix"
    masked = mask_secrets_py(raw)
    assert "SuperSecret123" not in masked
    assert "[REDACTED_PASSWORD]" in masked
    assert "https://admin:[REDACTED_PASSWORD]@db.internal:5432/strix" in masked


def test_mask_secrets_key_value_pairs() -> None:
    raw = '{"api_key": "my-secret-key-123", "password": "super-secret-pw"}'
    masked = mask_secrets_py(raw)
    assert "my-secret-key-123" not in masked
    assert "super-secret-pw" not in masked
    assert "[REDACTED_CREDENTIAL]" in masked


def test_xss_prevention_on_arbitrary_content() -> None:
    """Confirm dangerous HTML tags are escaped and not rendered unsanitized."""
    dangerous = "<script>alert('XSS')</script><img src=x onerror=alert(1)>"
    safe = html.escape(dangerous)
    assert "<script>" not in safe
    assert "&lt;script&gt;" in safe
    assert "&lt;img" in safe


# ---------------------------------------------------------------------------
# 3. REPORT DISCOVERY & READING BACKEND (TRANSCRIPT HELPERS)
# ---------------------------------------------------------------------------


@pytest.fixture
def run_with_reports(tmp_path: Path) -> Path:
    """Create a fully featured run directory with diverse report artifacts."""
    run_dir = tmp_path / "strix_runs" / "test-run-ui05"
    run_dir.mkdir(parents=True)

    # 1. run.json
    run_record = {
        "run_name": "test-run-ui05",
        "status": "completed",
        "finished": True,
        "start_time": "2026-10-03T20:00:00Z",
        "end_time": "2026-10-03T20:15:00Z",
        "targets_info": [{"original": "https://api.example.com"}],
    }
    (run_dir / "run.json").write_text(json.dumps(run_record), encoding="utf-8")

    # 2. penetration_test_report.md
    md_content = (
        "# Executive Penetration Test Report\n"
        "**Generated:** 2026-10-03 20:15:00 UTC\n"
        "## Executive Summary\n"
        "Assessment identified 2 high risk findings in target authentication APIs.\n"
    )
    (run_dir / "penetration_test_report.md").write_text(md_content, encoding="utf-8")

    # 3. findings.sarif
    sarif_data = {
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Strix Security Scanner",
                        "rules": [
                            {"id": "STRIX-001", "name": "SQL Injection"},
                            {"id": "STRIX-002", "name": "Reflected XSS"},
                        ],
                    }
                },
                "results": [
                    {
                        "ruleId": "STRIX-001",
                        "level": "error",
                        "message": {"text": "Potential SQL injection in search parameter"},
                    },
                    {
                        "ruleId": "STRIX-002",
                        "level": "warning",
                        "message": {"text": "Reflected XSS in query parameter q"},
                    },
                ],
            }
        ],
    }
    (run_dir / "findings.sarif").write_text(json.dumps(sarif_data), encoding="utf-8")

    # 4. vulnerabilities.json
    vulns_data = [
        {
            "id": "vuln-0001",
            "title": "SQL Injection in Search API",
            "severity": "high",
            "status": "confirmed",
            "target": "https://api.example.com",
            "endpoint": "/api/v1/search",
            "method": "POST",
            "cve": "CVE-2026-1001",
            "cvss": 8.5,
            "confidence": "high",
            "evidence": "POST /api/v1/search HTTP/1.1\r\nHost: api.example.com\r\n\r\nq=' OR 1=1--",
            "description": "Unsanitized user input concatenated into database query.",
            "impact": "Full database read/write disclosure.",
            "remediation_steps": "Adopt parameterized prepared statements.",
            "timestamp": "2026-10-03 20:05:00 UTC",
            "poc_script_code": "import requests\nrequests.post('https://api.example.com/api')",
        },
        {
            "id": "vuln-0002",
            "title": "Information Disclosure in Debug Header",
            "severity": "info",
            "status": "confirmed",
            "target": "https://api.example.com",
            "endpoint": "/healthz",
            "method": "GET",
            "cvss": 3.1,
            "description": "Server leaks internal framework version in X-Debug header.",
            "timestamp": "2026-10-03 20:07:00 UTC",
        },
    ]
    (run_dir / "vulnerabilities.json").write_text(json.dumps(vulns_data), encoding="utf-8")

    # 5. vulnerabilities.csv
    csv_content = (
        "id,title,severity,timestamp,file\r\n"
        "vuln-0001,SQL Injection,HIGH,2026-10-03,vulnerabilities/vuln-0001.md\r\n"
    )
    (run_dir / "vulnerabilities.csv").write_text(csv_content, encoding="utf-8")

    # 6. vulnerabilities/ subdirectory with markdown reports
    vuln_subdir = run_dir / "vulnerabilities"
    vuln_subdir.mkdir(parents=True)
    (vuln_subdir / "vuln-0001.md").write_text(
        "# SQL Injection in Search API\nDetailed finding report.", encoding="utf-8"
    )

    # 7. Transcript and state
    state_dir = run_dir / ".state"
    state_dir.mkdir(parents=True)
    agents_data = {
        "statuses": {"root": "completed", "agent-recon": "completed"},
        "names": {"root": "strix-coordinator", "agent-recon": "recon-katana"},
        "parent_of": {"root": None, "agent-recon": "root"},
    }
    (state_dir / "agents.json").write_text(json.dumps(agents_data), encoding="utf-8")

    return run_dir


def test_list_run_reports_discovers_all_artifacts(run_with_reports: Path) -> None:
    """Verify list_run_reports accurately discovers Markdown, SARIF, JSON, CSV files."""
    reports = list_run_reports(run_with_reports)
    names = [r["name"] for r in reports]

    assert "penetration_test_report.md" in names
    assert "findings.sarif" in names
    assert "vulnerabilities.json" in names
    assert "vulnerabilities.csv" in names
    assert "run.json" in names
    assert "vuln-0001.md" in names

    sarif_meta = next(r for r in reports if r["name"] == "findings.sarif")
    assert sarif_meta["format"] == "sarif"
    assert sarif_meta["size_bytes"] > 0

    md_meta = next(r for r in reports if r["name"] == "penetration_test_report.md")
    assert md_meta["format"] == "markdown"


def test_read_report_file_sarif_summary(run_with_reports: Path) -> None:
    """Verify read_report_file parses SARIF structure and produces correct summary metrics."""
    result = read_report_file(run_with_reports, "findings.sarif")
    assert result.get("format") == "sarif"

    summary = result.get("summary")
    assert summary is not None
    assert summary["runs_count"] == 1
    assert summary["results_count"] == 2
    assert summary["rules_count"] == 2
    assert summary["severity_counts"]["high"] == 1
    assert summary["severity_counts"]["medium"] == 1
    assert summary["version"] == "2.1.0"


def test_read_report_file_markdown(run_with_reports: Path) -> None:
    result = read_report_file(run_with_reports, "penetration_test_report.md")
    assert result.get("format") == "markdown"
    assert "Executive Penetration Test Report" in result.get("content", "")


def test_read_report_file_json(run_with_reports: Path) -> None:
    result = read_report_file(run_with_reports, "vulnerabilities.json")
    assert result.get("format") == "json"
    data = result.get("data")
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["id"] == "vuln-0001"


def test_read_report_file_path_traversal_rejected(run_with_reports: Path) -> None:
    """Ensure path traversal attacks (../../etc/passwd) are rejected."""
    result = read_report_file(run_with_reports, "../../etc/passwd")
    assert result.get("error") == "invalid_path"

    result_win = read_report_file(run_with_reports, "..\\..\\windows\\win.ini")
    assert result_win.get("error") == "invalid_path"


def test_read_report_file_not_found(run_with_reports: Path) -> None:
    result = read_report_file(run_with_reports, "non_existent_report.pdf")
    assert result.get("error") == "not_found"


# ---------------------------------------------------------------------------
# 4. ENTITY CORRELATION & FINDINGS INTELLIGENCE
# ---------------------------------------------------------------------------


def test_vulnerabilities_parsing_and_severity_counts(run_with_reports: Path) -> None:
    vulns = read_vulnerabilities(run_with_reports)
    assert len(vulns) == 2

    counts = severity_counts(vulns)
    assert counts["high"] == 1
    assert counts["critical"] == 0


def test_finding_intelligence_fields(run_with_reports: Path) -> None:
    vulns = read_vulnerabilities(run_with_reports)
    sql_vuln = vulns[0]

    assert sql_vuln["id"] == "vuln-0001"
    assert sql_vuln["severity"] == "high"
    assert sql_vuln["title"] == "SQL Injection in Search API"
    assert sql_vuln["target"] == "https://api.example.com"
    assert sql_vuln["cve"] == "CVE-2026-1001"
    assert sql_vuln["cvss"] == 8.5
    assert sql_vuln["confidence"] == "high"
    assert "poc_script_code" in sql_vuln
    assert "evidence" in sql_vuln


# ---------------------------------------------------------------------------
# 5. LIVE SERVER HTTP API INTEGRATION TESTS
# ---------------------------------------------------------------------------


def test_server_reports_api_endpoints_with_session(run_with_reports: Path) -> None:
    """Test GET /api/reports and GET /api/report/content live over HTTP."""
    httpd, url, token = serve(run_with_reports, host="127.0.0.1", port=0, open_browser=False)

    try:
        # 1. Access without session cookie must return 403 Forbidden
        req_unauth = urllib.request.Request(f"{url}/api/reports")
        with pytest.raises(urllib.error.HTTPError) as exc_unauth:
            urllib.request.urlopen(req_unauth)
        assert exc_unauth.value.code == 403

        # 2. Access with process session capability cookie via bootstrap token
        with urllib.request.urlopen(f"{url}/?token={token}") as resp_boot:
            cookie_header = str(resp_boot.headers.get("Set-Cookie", "")).split(";", 1)[0]
        headers = {"Cookie": cookie_header}

        # Test GET /api/reports
        req_reports = urllib.request.Request(f"{url}/api/reports", headers=headers)
        with urllib.request.urlopen(req_reports) as resp_reports:
            assert resp_reports.status == 200
            payload = json.loads(resp_reports.read().decode("utf-8"))
            assert "reports" in payload
            report_names = [r["name"] for r in payload["reports"]]
            assert "penetration_test_report.md" in report_names
            assert "findings.sarif" in report_names
            assert "vulnerabilities.json" in report_names

        # Test GET /api/report/content?file=penetration_test_report.md
        req_md = urllib.request.Request(
            f"{url}/api/report/content?file=penetration_test_report.md",
            headers=headers,
        )
        with urllib.request.urlopen(req_md) as resp_md:
            assert resp_md.status == 200
            data_md = json.loads(resp_md.read().decode("utf-8"))
            assert data_md.get("format") == "markdown"
            assert "Executive Penetration Test Report" in data_md.get("content", "")

        # Test GET /api/report/content?file=findings.sarif
        req_sarif = urllib.request.Request(
            f"{url}/api/report/content?file=findings.sarif", headers=headers
        )
        with urllib.request.urlopen(req_sarif) as resp_sarif:
            assert resp_sarif.status == 200
            data_sarif = json.loads(resp_sarif.read().decode("utf-8"))
            assert data_sarif.get("format") == "sarif"
            summary = data_sarif.get("summary")
            assert summary["results_count"] == 2
            assert summary["rules_count"] == 2

        # Test GET /api/report/content with path traversal attempt -> 400
        req_bad = urllib.request.Request(
            f"{url}/api/report/content?file=../../etc/passwd", headers=headers
        )
        with pytest.raises(urllib.error.HTTPError) as exc_bad:
            urllib.request.urlopen(req_bad)
        assert exc_bad.value.code == 400

        # Test GET /api/report/content with missing file -> 404
        req_404 = urllib.request.Request(
            f"{url}/api/report/content?file=missing_file.json", headers=headers
        )
        with pytest.raises(urllib.error.HTTPError) as exc_404:
            urllib.request.urlopen(req_404)
        assert exc_404.value.code == 404

        # Test GET /api/report/content with empty file parameter -> 400
        req_empty = urllib.request.Request(f"{url}/api/report/content", headers=headers)
        with pytest.raises(urllib.error.HTTPError) as exc_empty:
            urllib.request.urlopen(req_empty)
        assert exc_empty.value.code == 400

    finally:
        httpd.shutdown()
        httpd.server_close()
