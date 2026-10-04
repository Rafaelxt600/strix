import React, { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  ExternalLink,
  GitCompare,
  Layers,
  Loader2,
  Minus,
  RefreshCw,
  Shield,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { fetchRunVulnerabilities, type RunListEntry } from "@/data/serverSource";
import type { ControlCenterView, CrossRunComparison } from "@/types/control-center";
import {
  computeCrossRunComparison,
  type LoadedRunComparisonData,
} from "@/lib/historical-intelligence";
import { maskSecrets } from "@/lib/security";
import { cn } from "@/lib/utils";

interface CrossRunComparePanelProps {
  selectedRunNames: string[];
  runs: RunListEntry[];
  onSelectRun: (runName: string) => void;
  onToggleSelectRun: (runName: string) => void;
  onSelectView?: (view: ControlCenterView) => void;
}

type LifecycleTab = "recurring" | "new" | "resolved" | "reopened" | "severity";

function formatSeconds(sec?: number | null): string {
  if (sec == null || isNaN(sec)) return "N/A";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function CrossRunComparePanel({
  selectedRunNames,
  runs,
  onSelectRun,
  onToggleSelectRun,
  onSelectView,
}: CrossRunComparePanelProps) {
  const [loading, setLoading] = useState(false);
  const [runsData, setRunsData] = useState<LoadedRunComparisonData[]>([]);
  const [activeTab, setActiveTab] = useState<LifecycleTab>("recurring");
  const [error, setError] = useState<string | null>(null);

  // Fetch vulnerabilities for all selected runs
  useEffect(() => {
    if (selectedRunNames.length < 2) {
      setRunsData([]);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const promises = selectedRunNames.map(async (name) => {
      const summary = runs.find((r) => r.name === name) || {
        name,
        target: null,
        scan_mode: "quick",
        finished: true,
        start_time: null,
        end_time: null,
        status: "completed",
        severity_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      };
      try {
        const vulnerabilities = await fetchRunVulnerabilities(name);
        return {
          runName: name,
          summary,
          vulnerabilities,
        };
      } catch (err) {
        console.warn(`Could not fetch vulnerabilities for run ${name}:`, err);
        return {
          runName: name,
          summary,
          vulnerabilities: [],
        };
      }
    });

    Promise.all(promises)
      .then((data) => {
        if (isMounted) {
          setRunsData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load comparison data");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedRunNames, runs]);

  // Compute side-by-side comparison
  const comparison: CrossRunComparison | null = useMemo(() => {
    if (runsData.length < 2) return null;
    return computeCrossRunComparison(runsData);
  }, [runsData]);

  if (selectedRunNames.length < 2) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-white/10 bg-zinc-950 p-8 text-center space-y-4 shadow-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mx-auto">
            <GitCompare className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Cross-Run Comparative Intelligence</h2>
            <p className="text-xs text-zinc-400 mt-1 max-w-lg mx-auto">
              Select 2 or more historical sessions from the list below to compare security metrics, duration differentials, and finding lifecycles (new, recurring, and resolved vulnerabilities).
            </p>
          </div>

          {/* Quick Select Grid */}
          <div className="mt-6 border-t border-white/10 pt-6 text-left">
            <h3 className="text-xs font-mono font-semibold uppercase text-zinc-400 mb-3">
              Quick Pick Sessions to Compare:
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono">
              {runs.slice(0, 9).map((r) => {
                const isSelected = selectedRunNames.includes(r.name);
                return (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => onToggleSelectRun(r.name)}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors text-xs",
                      isSelected
                        ? "border-cyan-500/50 bg-cyan-500/10 text-white"
                        : "border-white/10 bg-zinc-900/60 text-zinc-300 hover:border-white/20"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="mt-0.5 rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-0"
                    />
                    <div className="space-y-1 min-w-0">
                      <div className="font-semibold truncate text-white">{r.name}</div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {r.target || "Local Scope"}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        <span className="text-rose-400">{r.severity_counts.critical}C</span>
                        <span className="text-orange-400">{r.severity_counts.high}H</span>
                        <span className="text-amber-400">{r.severity_counts.medium}M</span>
                        <span>• {r.finished ? "Completed" : "Active"}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-16 text-center space-y-3 font-mono">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
        <p className="text-sm font-semibold text-white">
          Computing Cross-Run Differential & Correlation...
        </p>
        <p className="text-xs text-zinc-500">
          Loading vulnerabilities, comparing targets, and analyzing finding lifecycles.
        </p>
      </div>
    );
  }

  if (!comparison) {
    return null;
  }

  const { runs: compRuns, durationDiffs, findingsDiffs, criticalDiffs } = comparison;
  const earliestRun = compRuns[0];
  const latestRun = compRuns[compRuns.length - 1];

  return (
    <div className="space-y-6">
      {/* Comparison Top Banner */}
      <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 p-5 shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <GitCompare className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Multi-Session Differential Analysis</span>
                <span className="rounded bg-cyan-500/20 border border-cyan-500/30 px-2 py-0.2 text-[10px] font-mono text-cyan-300">
                  {compRuns.length} SESSIONS
                </span>
              </h2>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Baseline: <strong className="text-white">{earliestRun.name}</strong> → Latest:{" "}
                <strong className="text-white">{latestRun.name}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs">
            {compRuns.map((r, i) => (
              <React.Fragment key={r.name}>
                {i > 0 && <ArrowRight className="h-3 w-3 text-zinc-600" />}
                <button
                  type="button"
                  onClick={() => onSelectRun(r.name)}
                  className="rounded bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 text-zinc-300 hover:text-white"
                >
                  {r.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Differential KPI Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-4 font-mono">
          {/* Findings Net Diff */}
          <div className="rounded-lg border border-white/5 bg-black/60 p-3.5 space-y-1">
            <div className="text-[11px] text-zinc-400 uppercase">Findings Delta</div>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-xl font-bold",
                  (findingsDiffs[latestRun.name] ?? 0) > 0
                    ? "text-rose-400"
                    : (findingsDiffs[latestRun.name] ?? 0) < 0
                    ? "text-emerald-400"
                    : "text-zinc-300"
                )}
              >
                {(findingsDiffs[latestRun.name] ?? 0) > 0
                  ? `+${findingsDiffs[latestRun.name]}`
                  : findingsDiffs[latestRun.name] ?? 0}
              </span>
              <span className="text-xs text-zinc-500">
                ({earliestRun.findings_count} → {latestRun.findings_count})
              </span>
            </div>
            <div className="text-[10px] text-zinc-500">Net change in detected issues</div>
          </div>

          {/* Critical Vulnerabilities Diff */}
          <div className="rounded-lg border border-white/5 bg-black/60 p-3.5 space-y-1">
            <div className="text-[11px] text-zinc-400 uppercase">Criticals Delta</div>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-xl font-bold",
                  (criticalDiffs[latestRun.name] ?? 0) > 0
                    ? "text-rose-400"
                    : (criticalDiffs[latestRun.name] ?? 0) < 0
                    ? "text-emerald-400"
                    : "text-zinc-300"
                )}
              >
                {(criticalDiffs[latestRun.name] ?? 0) > 0
                  ? `+${criticalDiffs[latestRun.name]}`
                  : criticalDiffs[latestRun.name] ?? 0}
              </span>
              <span className="text-xs text-zinc-500">
                ({earliestRun.severity_counts.critical || 0} →{" "}
                {latestRun.severity_counts.critical || 0})
              </span>
            </div>
            <div className="text-[10px] text-zinc-500">Critical severity evolution</div>
          </div>

          {/* Duration Differential */}
          <div className="rounded-lg border border-white/5 bg-black/60 p-3.5 space-y-1">
            <div className="text-[11px] text-zinc-400 uppercase">Duration Delta</div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-white">
                {durationDiffs[latestRun.name] != null
                  ? `${durationDiffs[latestRun.name]! > 0 ? "+" : ""}${durationDiffs[
                      latestRun.name
                    ]}s`
                  : "N/A"}
              </span>
              <span className="text-xs text-zinc-500">
                ({formatSeconds(earliestRun.duration_seconds)} →{" "}
                {formatSeconds(latestRun.duration_seconds)})
              </span>
            </div>
            <div className="text-[10px] text-zinc-500">Execution time change</div>
          </div>

          {/* Target Changes */}
          <div className="rounded-lg border border-white/5 bg-black/60 p-3.5 space-y-1">
            <div className="text-[11px] text-zinc-400 uppercase">Target Surface</div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-cyan-300">
                {comparison.targetsDiff.same.length} shared
              </span>
              {(comparison.targetsDiff.added.length > 0 ||
                comparison.targetsDiff.removed.length > 0) && (
                <span className="text-xs text-zinc-400">
                  (+{comparison.targetsDiff.added.length} / -
                  {comparison.targetsDiff.removed.length})
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500">Target footprint stability</div>
          </div>
        </div>
      </div>

      {/* Side-by-Side Matrix Table */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 overflow-hidden shadow-xl">
        <div className="border-b border-white/10 bg-zinc-900/60 px-4 py-3">
          <h3 className="text-xs font-mono font-semibold uppercase text-zinc-300">
            Side-by-Side Session Matrix
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900/80 text-[11px] uppercase text-zinc-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-3">Metric / Property</th>
                {compRuns.map((r) => (
                  <th key={r.name} className="px-4 py-3 min-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-bold">{r.name}</span>
                      {r.name === latestRun.name && (
                        <span className="rounded bg-cyan-500/20 px-1 py-0.2 text-[9px] text-cyan-300">
                          LATEST
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-zinc-300">
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Target(s)</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 text-cyan-400 truncate max-w-xs">
                    {maskSecrets(r.target || "Local Scope")}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Execution Status</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 uppercase">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-bold",
                        r.finished
                          ? "bg-zinc-800 text-zinc-300 border border-zinc-700"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      )}
                    >
                      {r.finished ? "Completed" : "Active"}
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Scan Mode</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 uppercase text-zinc-400">
                    {r.scan_mode || "quick"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Total Duration</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 text-white font-semibold">
                    {formatSeconds(r.duration_seconds)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Total Findings</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 font-bold text-white">
                    {r.findings_count}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Critical / High</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5">
                    <span className="text-rose-400 font-bold">
                      {r.severity_counts.critical || 0}C
                    </span>{" "}
                    /{" "}
                    <span className="text-orange-400 font-bold">
                      {r.severity_counts.high || 0}H
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Medium / Low</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 text-zinc-400">
                    <span className="text-amber-400">{r.severity_counts.medium || 0}M</span> /{" "}
                    <span className="text-blue-400">{r.severity_counts.low || 0}L</span>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-zinc-400">Agents Involved</td>
                {compRuns.map((r) => (
                  <td key={r.name} className="px-4 py-2.5 text-purple-400 font-semibold">
                    {r.agents_count || 1} agents
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Finding Lifecycle Tracking */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4 shadow-xl font-mono">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-cyan-400" />
              <span>Finding Lifecycle Evolution</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Tracks persistence, recurrence, remediation, and severity shifts across compared sessions.
            </p>
          </div>

          {/* Sub-Tabs for Lifecycle */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("recurring")}
              className={cn(
                "rounded-lg px-2.5 py-1 border transition-colors",
                activeTab === "recurring"
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold"
                  : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-white"
              )}
            >
              Recurring ({comparison.sameFindings.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("new")}
              className={cn(
                "rounded-lg px-2.5 py-1 border transition-colors",
                activeTab === "new"
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40 font-semibold"
                  : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-white"
              )}
            >
              New ({comparison.newFindings.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("resolved")}
              className={cn(
                "rounded-lg px-2.5 py-1 border transition-colors",
                activeTab === "resolved"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold"
                  : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-white"
              )}
            >
              Resolved ({comparison.resolvedFindings.length})
            </button>
            {comparison.reopenedFindings.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("reopened")}
                className={cn(
                  "rounded-lg px-2.5 py-1 border transition-colors",
                  activeTab === "reopened"
                    ? "bg-purple-500/20 text-purple-300 border-purple-500/40 font-semibold"
                    : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-white"
                )}
              >
                Reopened ({comparison.reopenedFindings.length})
              </button>
            )}
            {comparison.severityChanges.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("severity")}
                className={cn(
                  "rounded-lg px-2.5 py-1 border transition-colors",
                  activeTab === "severity"
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold"
                    : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-white"
                )}
              >
                Severity Shifts ({comparison.severityChanges.length})
              </button>
            )}
          </div>
        </div>

        {/* Content based on Active Tab */}
        <div className="space-y-2">
          {activeTab === "recurring" && (
            <div className="space-y-2">
              {comparison.sameFindings.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No recurring findings persist across these sessions.
                </div>
              ) : (
                comparison.sameFindings.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 hover:bg-amber-500/10 transition-colors gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1.5 py-0.2 uppercase">
                          RECURRING
                        </span>
                        <span className="font-semibold text-white text-xs">{f.title}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Target: <span className="text-cyan-400">{maskSecrets(f.target || "N/A")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-zinc-500 text-[11px]">
                        In {f.sessions.length} sessions ({f.firstSeen} → {f.lastSeen})
                      </span>
                      <span className="rounded bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-300 uppercase">
                        {f.severity}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "new" && (
            <div className="space-y-2">
              {comparison.newFindings.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No new findings introduced in the latest session.
                </div>
              ) : (
                comparison.newFindings.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 hover:bg-rose-500/10 transition-colors gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold px-1.5 py-0.2 uppercase">
                          NEW
                        </span>
                        <span className="font-semibold text-white text-xs">{f.title}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Target: <span className="text-cyan-400">{maskSecrets(f.target || "N/A")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-zinc-500 text-[11px]">
                        Introduced in: {f.firstSeen}
                      </span>
                      <span className="rounded bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-300 uppercase">
                        {f.severity}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "resolved" && (
            <div className="space-y-2">
              {comparison.resolvedFindings.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No findings have been resolved between these sessions.
                </div>
              ) : (
                comparison.resolvedFindings.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 hover:bg-emerald-500/10 transition-colors gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-1.5 py-0.2 uppercase">
                          RESOLVED
                        </span>
                        <span className="font-semibold text-white text-xs line-through text-zinc-400">
                          {f.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        Target: {maskSecrets(f.target || "N/A")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-emerald-400 text-[11px]">
                        Last seen in: {f.lastSeen} (Absent in latest)
                      </span>
                      <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-400 uppercase">
                        {f.severity}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "reopened" && (
            <div className="space-y-2">
              {comparison.reopenedFindings.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 hover:bg-purple-500/10 transition-colors gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold px-1.5 py-0.2 uppercase">
                        REOPENED
                      </span>
                      <span className="font-semibold text-white text-xs">{f.title}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Target: <span className="text-cyan-400">{maskSecrets(f.target || "N/A")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-purple-300 text-[11px]">
                      Reappeared in: {f.lastSeen}
                    </span>
                    <span className="rounded bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-300 uppercase">
                      {f.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "severity" && (
            <div className="space-y-2">
              {comparison.severityChanges.map((sc, idx) => (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 hover:bg-cyan-500/10 transition-colors gap-2"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="font-semibold text-white text-xs">{sc.title}</div>
                    <div className="text-[11px] text-zinc-400">
                      From session <strong className="text-zinc-200">{sc.fromSession}</strong> →{" "}
                      <strong className="text-zinc-200">{sc.toSession}</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-400">
                      {sc.oldSeverity}
                    </span>
                    <ArrowRight className="h-3 w-3 text-zinc-500" />
                    <span className="rounded bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-300">
                      {sc.newSeverity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
