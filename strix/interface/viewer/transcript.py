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


def _compute_duration(start_str: str | None, end_str: str | None) -> int | None:
    if not start_str or not end_str:
        return None
    try:
        t0 = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
        sec = int((t1 - t0).total_seconds())
    except (ValueError, TypeError):
        return None
    else:
        return None if sec < 0 else sec


def extract_all_targets(record: dict[str, Any]) -> list[str]:
    """Extract all unique targets listed in a run record."""
    results: list[str] = []
    for key in ("targets_info", "targets"):
        items = record.get(key)
        if isinstance(items, list):
            for entry in items:
                if isinstance(entry, str) and entry.strip() and entry.strip() not in results:
                    results.append(entry.strip())
                elif isinstance(entry, dict):
                    val = (
                        entry.get("original")
                        or entry.get("target")
                        or entry.get("url")
                        or entry.get("domain")
                        or entry.get("host")
                        or entry.get("name")
                    )
                    if isinstance(val, str) and val.strip() and val.strip() not in results:
                        results.append(val.strip())

    tgt = record.get("target")
    if isinstance(tgt, str) and tgt.strip() and tgt.strip() not in results:
        results.append(tgt.strip())
    pri = primary_target(record)
    if pri and pri not in results:
        results.append(pri)
    return results


def _extract_agent_names(data: Any) -> list[str]:
    names: list[str] = []
    if isinstance(data, dict):
        names_dict = data.get("names", {})
        if isinstance(names_dict, dict):
            names.extend(str(n) for n in names_dict.values() if n)
        agents_list = data.get("agents", [])
        if isinstance(agents_list, list):
            for a in agents_list:
                val = a.get("name") if isinstance(a, dict) else a
                if isinstance(val, str) and val.strip():
                    names.append(val.strip())
    elif isinstance(data, list):
        for a in data:
            val = a.get("name") if isinstance(a, dict) else a
            if isinstance(val, str) and val.strip():
                names.append(val.strip())
    return names


def _read_agents_summary(run_dir: Path) -> tuple[int, list[str]]:
    agents_path = run_dir / ".state" / "agents.json"
    if not agents_path.is_file():
        return 0, []
    data = _load_json(agents_path, default={})
    names = _extract_agent_names(data)
    if names:
        deduped = sorted(set(names))
        return len(deduped), deduped
    if isinstance(data, dict):
        statuses_dict = data.get("statuses", {})
        if isinstance(statuses_dict, dict):
            return len(statuses_dict), []
    return 0, []


def parse_run_archive_entry(run_dir: Path) -> dict[str, Any]:
    """Parse complete metadata of a run for the session archive, handling corrupt/partial runs."""
    rec_file = run_record_path(run_dir)
    is_incomplete = not rec_file.is_file()
    is_corrupt = False
    record: dict[str, Any] = {}

    if not is_incomplete:
        try:
            parsed = json.loads(rec_file.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                record = parsed
            else:
                is_corrupt = True
        except (OSError, json.JSONDecodeError):
            is_corrupt = True

    start_time = record.get("start_time")
    end_time = record.get("end_time")
    duration_seconds = _compute_duration(start_time, end_time)

    vulns = read_vulnerabilities(run_dir)
    sev_counts = severity_counts(vulns)
    reports = list_run_reports(run_dir)
    agents_count, agent_names = _read_agents_summary(run_dir)
    targets = extract_all_targets(record)
    target_pri = primary_target(record) or (targets[0] if targets else None)

    if is_corrupt:
        status = "corrupted"
    elif is_incomplete:
        status = "incomplete"
    else:
        status = str(record.get("status") or "unknown").lower()

    finished = status in _TERMINAL_STATUSES and bool(end_time)

    return {
        "name": record.get("run_name") or run_dir.name,
        "target": target_pri,
        "targets": targets,
        "scan_mode": record.get("scan_mode"),
        "status": status,
        "start_time": start_time,
        "end_time": end_time,
        "duration_seconds": duration_seconds,
        "finished": finished,
        "severity_counts": sev_counts,
        "findings_count": len(vulns),
        "reports_count": len(reports),
        "agents_count": agents_count,
        "agent_names": agent_names,
        "is_corrupt": is_corrupt,
        "is_incomplete": is_incomplete,
    }


def _match_session(q: str, session_name: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
    if q in session_name.lower():
        return [{
            "type": "SESSION",
            "session": session_name,
            "entity": session_name,
            "title": f"Session: {session_name}",
            "timestamp": entry.get("start_time"),
            "severity": None,
            "target": entry.get("target"),
            "source": "run.json",
        }]
    return []


def _match_targets(q: str, session_name: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "type": "TARGET",
            "session": session_name,
            "entity": tgt,
            "title": f"Target: {tgt}",
            "timestamp": entry.get("start_time"),
            "severity": None,
            "target": tgt,
            "source": "targets_info",
        }
        for tgt in entry.get("targets", [])
        if q in tgt.lower()
    ]


def _match_findings(
    q: str, run_dir: Path, session_name: str, entry: dict[str, Any]
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for vuln in read_vulnerabilities(run_dir):
        if not isinstance(vuln, dict):
            continue
        v_id = str(vuln.get("id") or "")
        v_title = str(vuln.get("title") or "")
        v_desc = str(vuln.get("description") or "")
        v_sev = str(vuln.get("severity") or "low").lower()
        v_tgt = str(vuln.get("target") or entry.get("target") or "")
        if q in v_id.lower() or q in v_title.lower() or q in v_desc.lower():
            hits.append({
                "type": "FINDING",
                "session": session_name,
                "entity": v_id or v_title,
                "title": v_title or v_id,
                "timestamp": vuln.get("timestamp") or entry.get("start_time"),
                "severity": v_sev,
                "target": v_tgt or None,
                "source": "vulnerabilities.json",
            })
    return hits


def _match_reports(
    q: str, run_dir: Path, session_name: str, entry: dict[str, Any]
) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for rep in list_run_reports(run_dir):
        r_name = str(rep.get("name") or "")
        r_title = str(rep.get("title") or "")
        if q in r_name.lower() or q in r_title.lower():
            hits.append({
                "type": "REPORT",
                "session": session_name,
                "entity": rep.get("path") or r_name,
                "title": r_title or r_name,
                "timestamp": rep.get("updated_at") or entry.get("start_time"),
                "severity": None,
                "target": entry.get("target"),
                "source": r_name,
            })
    return hits


def _match_agents(q: str, session_name: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "type": "AGENT",
            "session": session_name,
            "entity": a_name,
            "title": f"Agent: {a_name}",
            "timestamp": entry.get("start_time"),
            "severity": None,
            "target": entry.get("target"),
            "source": "agents.json",
        }
        for a_name in entry.get("agent_names", [])
        if q in a_name.lower()
    ]


def search_cross_runs(
    base_dir: Path,
    query_str: str,
    *,
    runs_filter: list[Path] | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Search cross-run sessions, findings, targets, agents, tools, and reports."""
    q = query_str.lower().strip()
    if not q:
        return []

    results: list[dict[str, Any]] = []
    run_dirs: list[Path] = []
    if runs_filter is not None:
        run_dirs = runs_filter
    elif base_dir.is_dir():
        run_dirs = [c for c in base_dir.iterdir() if c.is_dir()]

    for run_dir in run_dirs:
        entry = parse_run_archive_entry(run_dir)
        session_name = str(entry.get("name") or run_dir.name)

        results.extend(_match_session(q, session_name, entry))
        results.extend(_match_targets(q, session_name, entry))
        results.extend(_match_findings(q, run_dir, session_name, entry))
        results.extend(_match_reports(q, run_dir, session_name, entry))
        results.extend(_match_agents(q, session_name, entry))

        if len(results) >= limit:
            break

    return results[:limit]


def _load_json(path: Path, *, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


__all__ = [
    "build_run_state",
    "extract_all_targets",
    "list_run_reports",
    "parse_run_archive_entry",
    "primary_target",
    "read_report_file",
    "read_report_markdown",
    "read_run_summary",
    "read_vulnerabilities",
    "search_cross_runs",
    "severity_counts",
]
