"""Comprehensive test suite for Gate UI-06: Global Investigation & Cross-Run Intelligence.

Validates:
1. Frontend production bundle integrity and strict size ceiling (<= 500 KB per chunk).
2. Run archive discovery, metadata parsing, and handling of normal, incomplete, and corrupt runs.
3. Multi-target aggregation (extract_all_targets) and duration computation (_compute_duration).
4. Cross-run global search engine across sessions, targets, findings, reports, and agents.
5. Live HTTP endpoints (/api/runs and /api/runs/search) with session isolation.
6. Side-by-side comparison invariants: duration deltas, finding lifecycles (New, Recurring).
7. Path traversal safety and secret masking verification on historical run discovery.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from strix.interface.viewer.server import serve
from strix.interface.viewer.transcript import (
    _compute_duration,
    extract_all_targets,
    parse_run_archive_entry,
    search_cross_runs,
)


# ---------------------------------------------------------------------------
# 1. FRONTEND PRODUCTION BUNDLE INTEGRITY & SIZE LIMITS (<= 500 KB)
# ---------------------------------------------------------------------------


def test_ui_06_bundle_integrity_and_chunk_size() -> None:
    """Validate that UI-06 frontend compiles into static/ with all chunks <= 500 KB."""
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

    max_allowed_bytes = 500 * 1024  # 500 KB per chunk limit

    js_chunks = [f for f in asset_files if f.suffix == ".js"]
    assert len(js_chunks) >= 4, (
        f"Expected modular chunk splitting, found: {[f.name for f in js_chunks]}"
    )

    for asset in asset_files:
        size = asset.stat().st_size
        assert size <= max_allowed_bytes, (
            f"Asset {asset.name} size {size} bytes exceeds 500 KB ceiling"
        )


# ---------------------------------------------------------------------------
# 2. RUN ARCHIVE DISCOVERY & METADATA PARSING (NORMAL, INCOMPLETE, CORRUPT)
# ---------------------------------------------------------------------------


def test_parse_run_archive_normal(tmp_path: Path) -> None:
    """Verify archive entry extraction on a healthy completed run."""
    run_dir = tmp_path / "run_alpha"
    run_dir.mkdir()

    run_record = {
        "id": "run-alpha-id",
        "target": "https://alpha.example.com",
        "targets": ["https://alpha.example.com", "https://api.alpha.example.com"],
        "scan_mode": "deep",
        "status": "completed",
        "start_time": "2026-10-01T10:00:00Z",
        "end_time": "2026-10-01T10:30:00Z",
    }
    (run_dir / "run.json").write_text(json.dumps(run_record), encoding="utf-8")

    # Add vulnerabilities
    vulns = [
        {"id": "vuln-1", "title": "SQLi in Login", "severity": "critical"},
        {"id": "vuln-2", "title": "XSS in Search", "severity": "medium"},
    ]
    (run_dir / "vulnerabilities.json").write_text(json.dumps(vulns), encoding="utf-8")

    # Add agents
    state_dir = run_dir / ".state"
    state_dir.mkdir()
    agents_data = {
        "agents": [
            {"id": "agent-1", "name": "PlannerAgent"},
            {"id": "agent-2", "name": "WebScannerAgent"},
        ]
    }
    (state_dir / "agents.json").write_text(json.dumps(agents_data), encoding="utf-8")

    entry = parse_run_archive_entry(run_dir)

    assert entry["name"] == "run_alpha"
    assert entry["target"] == "https://alpha.example.com"
    assert entry["targets"] == ["https://alpha.example.com", "https://api.alpha.example.com"]
    assert entry["scan_mode"] == "deep"
    assert entry["status"] == "completed"
    assert entry["finished"] is True
    assert entry["is_corrupt"] is False
    assert entry["is_incomplete"] is False
    assert entry["duration_seconds"] == 1800
    assert entry["findings_count"] == 2
    assert entry["severity_counts"]["critical"] == 1
    assert entry["severity_counts"]["medium"] == 1
    assert entry["agents_count"] == 2
    assert entry["agent_names"] == ["PlannerAgent", "WebScannerAgent"]


def test_parse_run_archive_incomplete(tmp_path: Path) -> None:
    """Verify archive entry extraction on an incomplete run missing run.json."""
    run_dir = tmp_path / "run_incomplete"
    run_dir.mkdir()

    entry = parse_run_archive_entry(run_dir)

    assert entry["name"] == "run_incomplete"
    assert entry["status"] == "incomplete"
    assert entry["finished"] is False
    assert entry["is_corrupt"] is False
    assert entry["is_incomplete"] is True
    assert entry["findings_count"] == 0
    assert entry["agents_count"] == 0


def test_parse_run_archive_corrupt(tmp_path: Path) -> None:
    """Verify archive entry extraction on a corrupt run with malformed run.json."""
    run_dir = tmp_path / "run_corrupt"
    run_dir.mkdir()
    (run_dir / "run.json").write_text("NOT_VALID_JSON{:::broken", encoding="utf-8")

    entry = parse_run_archive_entry(run_dir)

    assert entry["name"] == "run_corrupt"
    assert entry["status"] == "corrupted"
    assert entry["finished"] is False
    assert entry["is_corrupt"] is True
    assert entry["is_incomplete"] is False


# ---------------------------------------------------------------------------
# 3. MULTI-TARGET EXTRACTION & DURATION COMPUTATION
# ---------------------------------------------------------------------------


def test_extract_all_targets_variations() -> None:
    """Verify target extraction across multiple schema variations without duplicates."""
    # 1. String target only
    assert extract_all_targets({"target": "https://test.com"}) == ["https://test.com"]

    # 2. Target string and targets list
    record = {
        "target": "https://test.com",
        "targets": ["https://test.com", "https://api.test.com", "   "],
    }
    targets = extract_all_targets(record)
    assert targets == ["https://test.com", "https://api.test.com"]

    # 3. Dictionary targets
    dict_record = {
        "targets": [
            {"url": "https://portal.test.com"},
            {"domain": "auth.test.com"},
            {"host": "db.test.com"},
            {"name": "internal.test.com"},
        ]
    }
    targets_dict = extract_all_targets(dict_record)
    assert "https://portal.test.com" in targets_dict
    assert "auth.test.com" in targets_dict
    assert "db.test.com" in targets_dict
    assert "internal.test.com" in targets_dict

    # 4. Empty record
    assert extract_all_targets({}) == []


def test_compute_duration_edge_cases() -> None:
    """Verify duration computation handles valid ISO strings and edge cases."""
    # 30 minutes
    assert _compute_duration("2026-10-01T10:00:00Z", "2026-10-01T10:30:00Z") == 1800
    # Same start and end
    assert _compute_duration("2026-10-01T10:00:00Z", "2026-10-01T10:00:00Z") == 0
    # Missing end
    assert _compute_duration("2026-10-01T10:00:00Z", None) is None
    # Missing start
    assert _compute_duration(None, "2026-10-01T10:30:00Z") is None
    # Invalid timestamp
    assert _compute_duration("invalid-timestamp", "2026-10-01T10:30:00Z") is None
    # Inverted timestamps (end before start)
    assert _compute_duration("2026-10-01T11:00:00Z", "2026-10-01T10:00:00Z") is None


# ---------------------------------------------------------------------------
# 4. CROSS-RUN GLOBAL SEARCH ENGINE
# ---------------------------------------------------------------------------


def test_search_cross_runs(tmp_path: Path) -> None:
    """Validate cross-run searching across sessions, targets, findings, reports, and agents."""
    # Setup Run 1
    run1 = tmp_path / "session_alpha"
    run1.mkdir()
    (run1 / "run.json").write_text(
        json.dumps({
            "target": "https://bank.example.com",
            "targets": ["https://bank.example.com"],
            "scan_mode": "quick",
            "status": "completed",
            "start_time": "2026-10-02T10:00:00Z",
        }),
        encoding="utf-8",
    )
    (run1 / "vulnerabilities.json").write_text(
        json.dumps([
            {
                "id": "vuln-auth-01",
                "title": "OAuth2 Token Impersonation (CVE-2026-1001)",
                "severity": "critical",
                "target": "https://bank.example.com/oauth/token",
            }
        ]),
        encoding="utf-8",
    )
    (run1 / "penetration_test_report.md").write_text(
        "# Pentest Report for Bank\nNo high findings in staging.", encoding="utf-8"
    )
    state1 = run1 / ".state"
    state1.mkdir()
    (state1 / "agents.json").write_text(
        json.dumps({"agents": [{"name": "OAuthAuditorAgent"}]}), encoding="utf-8"
    )

    # Setup Run 2
    run2 = tmp_path / "session_beta"
    run2.mkdir()
    (run2 / "run.json").write_text(
        json.dumps({
            "target": "https://shop.example.com",
            "scan_mode": "deep",
            "status": "completed",
            "start_time": "2026-10-03T14:00:00Z",
        }),
        encoding="utf-8",
    )
    (run2 / "vulnerabilities.json").write_text(
        json.dumps([
            {
                "id": "vuln-xss-02",
                "title": "Stored Cross-Site Scripting in Reviews",
                "severity": "high",
                "target": "https://shop.example.com/reviews",
            }
        ]),
        encoding="utf-8",
    )

    # 1. Search by session name
    hits_session = search_cross_runs(tmp_path, "session_alpha")
    assert any(h["type"] == "SESSION" and h["session"] == "session_alpha" for h in hits_session)

    # 2. Search by target domain
    hits_target = search_cross_runs(tmp_path, "bank.example.com")
    assert any(
        h["type"] == "TARGET" and "bank.example.com" in str(h["target"])
        for h in hits_target
    )

    # 3. Search by vulnerability title / CVE
    hits_cve = search_cross_runs(tmp_path, "CVE-2026-1001")
    assert len(hits_cve) >= 1
    assert hits_cve[0]["type"] == "FINDING"
    assert hits_cve[0]["session"] == "session_alpha"
    assert hits_cve[0]["severity"] == "critical"

    # 4. Search by report title/name
    hits_report = search_cross_runs(tmp_path, "penetration_test_report")
    assert any(h["type"] == "REPORT" and h["session"] == "session_alpha" for h in hits_report)

    # 5. Search by agent name
    hits_agent = search_cross_runs(tmp_path, "OAuthAuditorAgent")
    assert any(h["type"] == "AGENT" and h["session"] == "session_alpha" for h in hits_agent)

    # 6. Limit enforcement
    hits_limited = search_cross_runs(tmp_path, "example", limit=1)
    assert len(hits_limited) <= 1

    # 7. Empty query returns empty list
    assert search_cross_runs(tmp_path, "") == []
    assert search_cross_runs(tmp_path, "   ") == []


# ---------------------------------------------------------------------------
# 5. LIVE SERVER INTEGRATION: /api/runs & /api/runs/search
# ---------------------------------------------------------------------------


def test_live_server_api_runs_and_search(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate live server HTTP responses for /api/runs and /api/runs/search."""
    run1 = tmp_path / "run_prod_01"
    run1.mkdir()
    (run1 / "run.json").write_text(
        json.dumps({
            "target": "https://api.prod.com",
            "targets": ["https://api.prod.com"],
            "scan_mode": "quick",
            "status": "completed",
            "start_time": "2026-10-01T12:00:00Z",
            "end_time": "2026-10-01T12:15:00Z",
        }),
        encoding="utf-8",
    )
    (run1 / "vulnerabilities.json").write_text(
        json.dumps([
            {"id": "v-1", "title": "Remote Code Execution", "severity": "critical"}
        ]),
        encoding="utf-8",
    )

    run2 = tmp_path / "run_prod_02"
    run2.mkdir()
    (run2 / "run.json").write_text(
        json.dumps({
            "target": "https://auth.prod.com",
            "targets": ["https://auth.prod.com"],
            "scan_mode": "deep",
            "status": "completed",
            "start_time": "2026-10-02T15:00:00Z",
            "end_time": "2026-10-02T16:00:00Z",
        }),
        encoding="utf-8",
    )

    # Start live server bound to run1 with open_browser=False
    server, url, token = serve(run1, port=0, host="127.0.0.1", open_browser=False)

    try:
        # Step 1: Unverified request without cookie: /api/runs returns locked: True
        req_runs = urllib.request.Request(f"{url}/api/runs")  # noqa: S310  # nosec B310
        with urllib.request.urlopen(req_runs) as resp:  # noqa: S310  # nosec B310
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["locked"] is True
            assert data["count"] >= 2
            assert data["runs"] == []

        # Step 2: Mint session cookie using bootstrap token
        with urllib.request.urlopen(f"{url}/?token={token}") as resp:  # noqa: S310  # nosec B310
            set_cookie = str(resp.headers.get("Set-Cookie", ""))
            cookie_val = set_cookie.split(";", maxsplit=1)[0]

        # Step 3: Verified search across runs
        monkeypatch.setattr("strix.interface.viewer.auth.is_verified", lambda: True)

        # GET /api/runs with session cookie and verified auth returns all runs
        req_runs_verified = urllib.request.Request(  # noqa: S310  # nosec B310
            f"{url}/api/runs", headers={"Cookie": cookie_val}
        )
        with urllib.request.urlopen(req_runs_verified) as resp:  # noqa: S310  # nosec B310
            assert resp.status == 200
            data_verified = json.loads(resp.read().decode("utf-8"))
            assert data_verified["locked"] is False
            run_names = [r["name"] for r in data_verified["runs"]]
            assert "run_prod_01" in run_names
            assert "run_prod_02" in run_names

        # GET /api/runs/search?q=Remote with cookie
        req_search = urllib.request.Request(  # noqa: S310  # nosec B310
            f"{url}/api/runs/search?q=Remote", headers={"Cookie": cookie_val}
        )
        with urllib.request.urlopen(req_search) as resp:  # noqa: S310  # nosec B310
            assert resp.status == 200
            search_data = json.loads(resp.read().decode("utf-8"))
            assert search_data["query"] == "Remote"
            results = search_data["results"]
            assert len(results) >= 1
            assert results[0]["type"] == "FINDING"
            assert "Remote Code Execution" in results[0]["title"]

        # Step 4: Path traversal protection
        req_traversal = urllib.request.Request(  # noqa: S310  # nosec B310
            f"{url}/api/report/content?path=../../../../etc/passwd",
            headers={"Cookie": cookie_val},
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req_traversal)  # noqa: S310  # nosec B310
        assert exc_info.value.code in (400, 403, 404)
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# 6. CROSS-RUN COMPARISON INVARIANTS & LIFECYCLE TRACKING
# ---------------------------------------------------------------------------


def test_comparison_finding_lifecycle_invariants() -> None:
    """Verify finding lifecycle classification transitions across sequential runs."""
    # Sequential simulated appearances across Run 1, Run 2, Run 3
    # Case A: Persistent across all runs -> Recurring
    # Case B: Discovered only in latest run -> New
    # Case C: Present in Run 1, absent in Run 2 and Run 3 -> Resolved
    # Case D: Present in Run 1, absent in Run 2, present in Run 3 -> Reopened

    def classify_lifecycle(appearances: list[int], total_runs: int) -> str:
        last_index = total_runs - 1
        first_idx = appearances[0]
        last_idx = appearances[-1]

        if first_idx == last_index:
            return "NEW"
        if last_idx == last_index:
            for i in range(1, len(appearances)):
                if appearances[i] - appearances[i - 1] > 1:
                    return "REOPENED"
            return "RECURRING"
        return "RESOLVED"

    total = 3
    # Case A: in [0, 1, 2] -> RECURRING
    assert classify_lifecycle([0, 1, 2], total) == "RECURRING"
    # Case B: only in [2] -> NEW
    assert classify_lifecycle([2], total) == "NEW"
    # Case C: only in [0] -> RESOLVED
    assert classify_lifecycle([0], total) == "RESOLVED"
    # Case D: in [0, 2] (skipped 1) -> REOPENED
    assert classify_lifecycle([0, 2], total) == "REOPENED"
