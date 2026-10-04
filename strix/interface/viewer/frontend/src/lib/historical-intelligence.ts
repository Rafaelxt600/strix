/**
 * Historical Intelligence & Cross-Run Analytics Engine (Gate UI-06)
 *
 * Implements authoritative correlation and comparison logic across multiple
 * runs, sessions, findings, targets, tools, and reports without synthetic data.
 */

import type { Vulnerability } from "@/types/issues";
import type {
  CrossRunComparison,
  FindingComparisonItem,
  FindingSeverityChange,
  GlobalMetrics,
  HistoricalFindingRecord,
  HistoricalRunSummary,
  HistoricalTargetRecord,
  ReportMetadata,
} from "@/types/control-center";
import type { RunListEntry } from "@/data/serverSource";

export interface LoadedRunComparisonData {
  runName: string;
  summary: RunListEntry | HistoricalRunSummary;
  vulnerabilities: Vulnerability[];
  reports?: ReportMetadata[];
}

/**
 * Safely compute finding composite identity.
 * Uses finding id when available; falls back to target + title.
 */
export function getFindingStableKey(vuln: Vulnerability): string {
  if (vuln.id && vuln.id.trim()) {
    return vuln.id.trim().toLowerCase();
  }
  const t = (vuln.target || "").trim().toLowerCase();
  const title = (vuln.title || "").trim().toLowerCase();
  return `${t}::${title}`;
}

/**
 * Safely normalize target URL/host.
 */
export function normalizeTarget(target?: string | null): string {
  if (!target) return "";
  let clean = target.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//, "");
  clean = clean.replace(/\/+$/, "");
  return clean;
}

/**
 * Compute Cross-Run Comparison across 2 or more loaded sessions.
 */
export function computeCrossRunComparison(
  runsData: LoadedRunComparisonData[]
): CrossRunComparison {
  if (!runsData || runsData.length === 0) {
    return {
      runs: [],
      durationDiffs: {},
      findingsDiffs: {},
      criticalDiffs: {},
      sameFindings: [],
      newFindings: [],
      resolvedFindings: [],
      reopenedFindings: [],
      severityChanges: [],
      targetsDiff: { same: [], added: [], removed: [] },
    };
  }

  // Ensure deterministic chronological order (oldest to newest)
  const sorted = [...runsData].sort((a, b) => {
    const tA = a.summary.start_time ? new Date(a.summary.start_time).getTime() : 0;
    const tB = b.summary.start_time ? new Date(b.summary.start_time).getTime() : 0;
    return tA - tB;
  });

  const runs: HistoricalRunSummary[] = sorted.map((r) => ({
    name: r.summary.name,
    target: r.summary.target,
    targets: r.summary.targets || (r.summary.target ? [r.summary.target] : []),
    scan_mode: r.summary.scan_mode,
    status: r.summary.status,
    start_time: r.summary.start_time,
    end_time: r.summary.end_time,
    duration_seconds: r.summary.duration_seconds ?? null,
    finished: r.summary.finished,
    severity_counts: r.summary.severity_counts as Record<string, number>,
    findings_count: r.vulnerabilities.length,
    reports_count: r.reports?.length ?? 0,
    agents_count: r.summary.agents_count ?? 0,
    agent_names: r.summary.agent_names ?? [],
    is_corrupt: r.summary.is_corrupt ?? false,
    is_incomplete: r.summary.is_incomplete ?? false,
  }));

  const durationDiffs: Record<string, number | null> = {};
  const findingsDiffs: Record<string, number> = {};
  const criticalDiffs: Record<string, number> = {};

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    if (i === 0) {
      durationDiffs[curr.runName] = 0;
      findingsDiffs[curr.runName] = 0;
      criticalDiffs[curr.runName] = 0;
    } else {
      const prev = sorted[i - 1];
      const dCurr = curr.summary.duration_seconds ?? null;
      const dPrev = prev.summary.duration_seconds ?? null;
      durationDiffs[curr.runName] = dCurr !== null && dPrev !== null ? dCurr - dPrev : null;
      findingsDiffs[curr.runName] = curr.vulnerabilities.length - prev.vulnerabilities.length;
      const cCurr = curr.summary.severity_counts?.critical || 0;
      const cPrev = prev.summary.severity_counts?.critical || 0;
      criticalDiffs[curr.runName] = cCurr - cPrev;
    }
  }

  // Findings tracking across the selected runs
  const findingMap = new Map<
    string,
    {
      title: string;
      target: string | null;
      appearances: { session: string; severity: string; index: number }[];
    }
  >();

  sorted.forEach((run, idx) => {
    run.vulnerabilities.forEach((v) => {
      const key = getFindingStableKey(v);
      const existing = findingMap.get(key);
      const entry = {
        session: run.runName,
        severity: (v.severity || "low").toLowerCase(),
        index: idx,
      };
      if (!existing) {
        findingMap.set(key, {
          title: v.title || key,
          target: v.target || run.summary.target,
          appearances: [entry],
        });
      } else {
        existing.appearances.push(entry);
      }
    });
  });

  const sameFindings: FindingComparisonItem[] = [];
  const newFindings: FindingComparisonItem[] = [];
  const resolvedFindings: FindingComparisonItem[] = [];
  const reopenedFindings: FindingComparisonItem[] = [];
  const severityChanges: FindingSeverityChange[] = [];

  const lastIndex = sorted.length - 1;

  findingMap.forEach((info, key) => {
    const apps = info.appearances;
    const firstApp = apps[0];
    const lastApp = apps[apps.length - 1];
    const presentInLatest = lastApp.index === lastIndex;

    // Check severity changes between appearances
    for (let i = 1; i < apps.length; i++) {
      if (apps[i].severity !== apps[i - 1].severity) {
        severityChanges.push({
          id: key,
          title: info.title,
          oldSeverity: apps[i - 1].severity,
          newSeverity: apps[i].severity,
          fromSession: apps[i - 1].session,
          toSession: apps[i].session,
        });
      }
    }

    let status: "NEW" | "RECURRING" | "RESOLVED" | "REOPENED" | "UNKNOWN" = "UNKNOWN";

    if (firstApp.index === lastIndex) {
      status = "NEW";
      newFindings.push({
        id: key,
        title: info.title,
        severity: lastApp.severity,
        target: info.target,
        sessions: apps.map((a) => a.session),
        firstSeen: firstApp.session,
        lastSeen: lastApp.session,
        status,
      });
    } else if (presentInLatest) {
      // Check if it disappeared in between (reopened)
      let gap = false;
      for (let i = 1; i < apps.length; i++) {
        if (apps[i].index - apps[i - 1].index > 1) {
          gap = true;
          break;
        }
      }
      if (gap) {
        status = "REOPENED";
        reopenedFindings.push({
          id: key,
          title: info.title,
          severity: lastApp.severity,
          target: info.target,
          sessions: apps.map((a) => a.session),
          firstSeen: firstApp.session,
          lastSeen: lastApp.session,
          status,
        });
      } else {
        status = "RECURRING";
        sameFindings.push({
          id: key,
          title: info.title,
          severity: lastApp.severity,
          target: info.target,
          sessions: apps.map((a) => a.session),
          firstSeen: firstApp.session,
          lastSeen: lastApp.session,
          status,
        });
      }
    } else {
      status = "RESOLVED";
      resolvedFindings.push({
        id: key,
        title: info.title,
        severity: lastApp.severity,
        target: info.target,
        sessions: apps.map((a) => a.session),
        firstSeen: firstApp.session,
        lastSeen: lastApp.session,
        status,
      });
    }
  });

  // Target comparison between earliest and latest run
  const firstTargets = new Set(
    (sorted[0].summary.targets || [sorted[0].summary.target || ""]).filter(Boolean)
  );
  const latestTargets = new Set(
    (sorted[lastIndex].summary.targets || [sorted[lastIndex].summary.target || ""]).filter(Boolean)
  );

  const sameTargets: string[] = [];
  const addedTargets: string[] = [];
  const removedTargets: string[] = [];

  firstTargets.forEach((t) => {
    if (latestTargets.has(t)) {
      sameTargets.push(t);
    } else {
      removedTargets.push(t);
    }
  });

  latestTargets.forEach((t) => {
    if (!firstTargets.has(t)) {
      addedTargets.push(t);
    }
  });

  return {
    runs,
    durationDiffs,
    findingsDiffs,
    criticalDiffs,
    sameFindings,
    newFindings,
    resolvedFindings,
    reopenedFindings,
    severityChanges,
    targetsDiff: {
      same: sameTargets,
      added: addedTargets,
      removed: removedTargets,
    },
  };
}

/**
 * Compute Historical Finding Tracking across all runs.
 */
export function computeHistoricalFindingTracking(
  runsData: LoadedRunComparisonData[]
): HistoricalFindingRecord[] {
  if (!runsData || runsData.length === 0) return [];

  // Sort chronological
  const sorted = [...runsData].sort((a, b) => {
    const tA = a.summary.start_time ? new Date(a.summary.start_time).getTime() : 0;
    const tB = b.summary.start_time ? new Date(b.summary.start_time).getTime() : 0;
    return tA - tB;
  });

  const lastIndex = sorted.length - 1;
  const findingMap = new Map<
    string,
    {
      title: string;
      appearances: {
        session: string;
        severity: string;
        status: string;
        timestamp?: string | null;
        index: number;
      }[];
    }
  >();

  sorted.forEach((run, idx) => {
    run.vulnerabilities.forEach((v) => {
      const key = getFindingStableKey(v);
      const entry = {
        session: run.runName,
        severity: (v.severity || "low").toLowerCase(),
        status: (v.status || "open").toLowerCase(),
        timestamp: v.timestamp || run.summary.start_time,
        index: idx,
      };
      const existing = findingMap.get(key);
      if (!existing) {
        findingMap.set(key, {
          title: v.title || key,
          appearances: [entry],
        });
      } else {
        existing.appearances.push(entry);
      }
    });
  });

  const records: HistoricalFindingRecord[] = [];

  findingMap.forEach((info, key) => {
    const apps = info.appearances;
    const first = apps[0];
    const last = apps[apps.length - 1];

    let lifecycle: "NEW" | "RECURRING" | "RESOLVED" | "REOPENED" | "UNKNOWN" = "UNKNOWN";

    if (first.index === lastIndex) {
      lifecycle = "NEW";
    } else if (last.index === lastIndex) {
      let gap = false;
      for (let i = 1; i < apps.length; i++) {
        if (apps[i].index - apps[i - 1].index > 1) {
          gap = true;
          break;
        }
      }
      lifecycle = gap ? "REOPENED" : "RECURRING";
    } else {
      lifecycle = "RESOLVED";
    }

    records.push({
      id: key,
      title: info.title,
      firstSeenSession: first.session,
      lastSeenSession: last.session,
      firstSeenTimestamp: first.timestamp,
      lastSeenTimestamp: last.timestamp,
      occurrences: apps.length,
      sessions: apps.map((a) => a.session),
      severityHistory: apps.map((a) => ({
        session: a.session,
        severity: a.severity,
        timestamp: a.timestamp ?? undefined,
      })),
      statusHistory: apps.map((a) => ({
        session: a.session,
        status: a.status,
        timestamp: a.timestamp ?? undefined,
      })),
      lifecycle,
    });
  });

  return records.sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Compute Historical Target records across runs.
 * Supports both LoadedRunComparisonData and summary RunListEntry.
 */
export function computeHistoricalTargets(
  runs: (LoadedRunComparisonData | RunListEntry | HistoricalRunSummary)[]
): HistoricalTargetRecord[] {
  const targetMap = new Map<
    string,
    {
      sessions: Set<string>;
      firstSeen?: string | null;
      lastSeen?: string | null;
      findingsCount: number;
      severityCounts: Record<string, number>;
    }
  >();

  runs.forEach((item) => {
    const summary = "summary" in item ? item.summary : item;
    const runName = "runName" in item ? item.runName : item.name;
    const targets = summary.targets || (summary.target ? [summary.target] : []);
    const startTime = summary.start_time;
    const vulns = "vulnerabilities" in item ? item.vulnerabilities : [];

    targets.forEach((rawTgt) => {
      const tgt = rawTgt.trim();
      if (!tgt) return;
      const norm = normalizeTarget(tgt);
      if (!norm) return;

      let entry = targetMap.get(norm);
      if (!entry) {
        entry = {
          sessions: new Set([runName]),
          firstSeen: startTime,
          lastSeen: startTime,
          findingsCount: 0,
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        };
        targetMap.set(norm, entry);
      } else {
        entry.sessions.add(runName);
        if (startTime) {
          if (!entry.firstSeen || new Date(startTime) < new Date(entry.firstSeen)) {
            entry.firstSeen = startTime;
          }
          if (!entry.lastSeen || new Date(startTime) > new Date(entry.lastSeen)) {
            entry.lastSeen = startTime;
          }
        }
      }

      if (vulns.length > 0) {
        entry.findingsCount += vulns.length;
        vulns.forEach((v) => {
          const s = (v.severity || "low").toLowerCase();
          if (s in entry!.severityCounts) entry!.severityCounts[s]++;
          else entry!.severityCounts.low++;
        });
      } else {
        const sc = summary.severity_counts || {};
        const sum =
          summary.findings_count ??
          ((sc.critical || 0) + (sc.high || 0) + (sc.medium || 0) + (sc.low || 0));
        entry.findingsCount += sum;
        Object.entries(sc).forEach(([k, v]) => {
          const lk = k.toLowerCase();
          if (lk in entry!.severityCounts) entry!.severityCounts[lk] += v;
        });
      }
    });
  });

  const results: HistoricalTargetRecord[] = [];
  targetMap.forEach((val, target) => {
    results.push({
      target,
      sessions: Array.from(val.sessions),
      firstSeen: val.firstSeen,
      lastSeen: val.lastSeen,
      totalFindings: val.findingsCount,
      severityCounts: val.severityCounts,
    });
  });

  return results.sort((a, b) => b.totalFindings - a.totalFindings);
}

/**
 * Compute Global Metrics from summary runs list.
 */
export function computeGlobalMetrics(runs: (RunListEntry | HistoricalRunSummary)[]): GlobalMetrics {
  let completedRuns = 0;
  let runningRuns = 0;
  let stoppedRuns = 0;
  let errorRuns = 0;
  let totalFindings = 0;
  let criticalFindings = 0;
  const targetsSet = new Set<string>();
  const agentsSet = new Set<string>();
  let totalReports = 0;

  runs.forEach((r) => {
    const s = String(r.status || "").toLowerCase();
    if (r.finished || s === "completed") {
      completedRuns++;
    } else if (s === "running") {
      runningRuns++;
    } else if (s.includes("stop") || s.includes("cancel")) {
      stoppedRuns++;
    } else if (s === "failed" || s === "corrupted" || s === "incomplete" || s === "error") {
      errorRuns++;
    }

    if (r.target) targetsSet.add(normalizeTarget(r.target));
    if (r.targets) r.targets.forEach((t) => targetsSet.add(normalizeTarget(t)));
    if (r.agent_names) r.agent_names.forEach((a) => agentsSet.add(a));

    if (r.findings_count) {
      totalFindings += r.findings_count;
    } else if (r.severity_counts) {
      const sum = Object.values(r.severity_counts).reduce((acc, v) => acc + (v || 0), 0);
      totalFindings += sum;
    }

    if (r.severity_counts?.critical) {
      criticalFindings += r.severity_counts.critical;
    }

    if (r.reports_count) {
      totalReports += r.reports_count;
    }
  });

  return {
    totalRuns: runs.length,
    completedRuns,
    runningRuns,
    stoppedRuns,
    errorRuns,
    totalFindings,
    criticalFindings,
    uniqueTargets: targetsSet.size,
    uniqueAgents: agentsSet.size,
    totalReports,
  };
}
