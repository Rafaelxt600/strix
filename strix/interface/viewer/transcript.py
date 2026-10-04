"""Build the JSON payloads the viewer SPA consumes from a run directory."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from strix.core.paths import run_record_path
from strix.interface.tui.live_view import TuiLiveView


if TYPE_CHECKING:
    from pathlib import Path


logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = {"completed", "stopped", "failed", "interrupted"}

_KNOWN_SEVERITIES = ("critical", "high", "medium", "low")


def severity_counts(vulns: list[Any]) -> dict[str, int]:
    """Bucket vulnerabilities into critical/high/medium/low counts.

    Mirrors the SPA's ``severityCounts``: severities are lowercased and
    trimmed, and anything outside the four known buckets (``info``,
    ``informational``, ``unknown``, missing, ...) folds into ``low`` so the
    shared UI renders cleanly.
    """
    counts = dict.fromkeys(_KNOWN_SEVERITIES, 0)
    for vuln in vulns:
        raw = vuln.get("severity") if isinstance(vuln, dict) else None
        severity = str(raw or "").lower().strip()
        if severity not in counts:
            severity = "low"
        counts[severity] += 1
    return counts


def build_run_state(run_dir: Path) -> dict[str, Any]:
    """Agent graph + full per-agent event/message stream.

    Reuses the shared ``TuiLiveView`` projection so the viewer and the TUI
    share one parser for ``agents.json`` + ``agents.db`` and never drift.
    """
    view = TuiLiveView()
    view.hydrate_from_run_dir(run_dir)
    return {"agents": list(view.agents.values()), "events": view.events}


def read_run_summary(run_dir: Path) -> dict[str, Any]:
    """The ``run.json`` record plus a computed ``finished`` flag."""
    record = _load_json(run_record_path(run_dir), default={})
    if not isinstance(record, dict):
        record = {}
    status = record.get("status")
    finished = status in _TERMINAL_STATUSES and bool(record.get("end_time"))
    return {**record, "finished": finished}


def primary_target(record: dict[str, Any]) -> str | None:
    """The first target's original string from a run record, or None."""
    targets = record.get("targets_info")
    if isinstance(targets, list):
        for entry in targets:
            if isinstance(entry, dict):
                original = entry.get("original")
                if isinstance(original, str) and original:
                    return original
    return None


def read_vulnerabilities(run_dir: Path) -> list[Any]:
    """The ``vulnerabilities.json`` list (empty until a scan writes it)."""
    data = _load_json(run_dir / "vulnerabilities.json", default=[])
    return data if isinstance(data, list) else []


def read_report_markdown(run_dir: Path) -> str:
    """The executive report markdown (empty until a scan writes it)."""
    report_path = run_dir / "penetration_test_report.md"
    try:
        return report_path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _format_iso(mtime: float) -> str:
    return datetime.fromtimestamp(mtime, tz=UTC).isoformat()


def list_run_reports(run_dir: Path) -> list[dict[str, Any]]:
    """List existing report artifacts within ``run_dir`` (Markdown, SARIF, JSON, CSV)."""
    if not run_dir.is_dir():
        return []

    reports: list[dict[str, Any]] = []

    # Known canonical report artifacts
    canonical_files = [
        ("penetration_test_report.md", "Executive Penetration Test Report", "markdown"),
        ("findings.sarif", "SARIF 2.1.0 Static Analysis", "sarif"),
        ("vulnerabilities.json", "Vulnerabilities Findings Index", "json"),
        ("vulnerabilities.csv", "Vulnerabilities CSV Export", "csv"),
        ("run.json", "Run Execution & Telemetry Summary", "json"),
        ("coverage.json", "Test & Attack Surface Coverage", "json"),
    ]

    for fname, title, fmt in canonical_files:
        fpath = run_dir / fname
        if fpath.is_file():
            stat = fpath.stat()
            reports.append({
                "name": fname,
                "path": fname,
                "title": title,
                "format": fmt,
                "size_bytes": stat.st_size,
                "created_at": _format_iso(stat.st_ctime),
                "updated_at": _format_iso(stat.st_mtime),
            })

    # Subdirectory vulnerabilities/ with markdown findings
    vuln_dir = run_dir / "vulnerabilities"
    if vuln_dir.is_dir():
        for item in sorted(vuln_dir.glob("*.md")):
            if item.is_file():
                stat = item.stat()
                rel_path = f"vulnerabilities/{item.name}"
                reports.append({
                    "name": item.name,
                    "path": rel_path,
                    "title": f"Finding Detail: {item.stem}",
                    "format": "markdown",
                    "size_bytes": stat.st_size,
                    "created_at": _format_iso(stat.st_ctime),
                    "updated_at": _format_iso(stat.st_mtime),
                })

    return reports


def _parse_sarif_report(target: Path, meta: dict[str, Any]) -> dict[str, Any]:
    try:
        content_str = target.read_text(encoding="utf-8")
        data = json.loads(content_str)
    except (OSError, json.JSONDecodeError) as exc:
        return {"error": "parse_error", "message": str(exc)}

    runs = data.get("runs", []) if isinstance(data, dict) else []
    total_results = 0
    total_rules = 0
    severity_counts_dict: dict[str, int] = {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
        "info": 0,
    }

    for r in runs:
        if isinstance(r, dict):
            results = r.get("results", [])
            if isinstance(results, list):
                total_results += len(results)
                for res in results:
                    if isinstance(res, dict):
                        level = str(res.get("level", "warning")).lower()
                        if level in ("error", "critical"):
                            severity_counts_dict["high"] += 1
                        elif level in ("warning", "medium"):
                            severity_counts_dict["medium"] += 1
                        elif level in ("note", "info"):
                            severity_counts_dict["info"] += 1
                        else:
                            severity_counts_dict["low"] += 1
            driver = r.get("tool", {}).get("driver", {})
            if isinstance(driver, dict):
                rules = driver.get("rules", [])
                if isinstance(rules, list):
                    total_rules += len(rules)

    summary = {
        "runs_count": len(runs),
        "results_count": total_results,
        "rules_count": total_rules,
        "severity_counts": severity_counts_dict,
        "version": data.get("version", "2.1.0") if isinstance(data, dict) else "unknown",
    }
    return {
        **meta,
        "format": "sarif",
        "summary": summary,
        "data": data,
        "raw": content_str,
    }


def _read_text_or_json(target: Path, meta: dict[str, Any], fmt: str) -> dict[str, Any]:
    try:
        content_str = target.read_text(encoding="utf-8")
        parsed = json.loads(content_str) if fmt == "json" else None
    except (OSError, json.JSONDecodeError) as exc:
        return {"error": "read_error", "message": str(exc)}
    else:
        if fmt == "json":
            return {**meta, "format": "json", "data": parsed, "raw": content_str}
        return {**meta, "format": fmt, "content": content_str}


def read_report_file(run_dir: Path, rel_path: str) -> dict[str, Any]:
    """Read a report file within ``run_dir`` safely, returning its format and content."""
    clean_path = rel_path.strip().lstrip("/\\")
    target = (run_dir / clean_path).resolve()
    base = run_dir.resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return {"error": "invalid_path", "message": "Path traversal rejected"}

    if not target.is_file():
        return {"error": "not_found", "message": f"Report file not found: {clean_path}"}

    stat = target.stat()
    meta = {
        "name": target.name,
        "path": clean_path,
        "size_bytes": stat.st_size,
        "created_at": _format_iso(stat.st_ctime),
        "updated_at": _format_iso(stat.st_mtime),
    }

    lower_name = target.name.lower()
    if lower_name.endswith(".sarif") or target.name == "findings.sarif":
        return _parse_sarif_report(target, meta)

    fmt = "text"
    if lower_name.endswith(".json"):
        fmt = "json"
    elif lower_name.endswith(".md"):
        fmt = "markdown"
    elif lower_name.endswith(".csv"):
        fmt = "csv"

    return _read_text_or_json(target, meta, fmt)


def _load_json(path: Path, *, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


__all__ = [
    "build_run_state",
    "list_run_reports",
    "primary_target",
    "read_report_file",
    "read_report_markdown",
    "read_run_summary",
    "read_vulnerabilities",
    "severity_counts",
]
