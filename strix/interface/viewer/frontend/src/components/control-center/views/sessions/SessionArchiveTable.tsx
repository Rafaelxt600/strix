import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  GitCompare,
  Pin,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Star,
  Target,
  Users,
} from "lucide-react";
import type { RunListEntry } from "@/data/serverSource";
import type { ControlCenterView } from "@/types/control-center";
import { maskSecrets } from "@/lib/security";
import { cn } from "@/lib/utils";

interface SessionArchiveTableProps {
  runs: RunListEntry[];
  activeRunName: string | null;
  selectedRunNames: string[];
  pinnedRunNames: string[];
  onToggleSelectRun: (runName: string) => void;
  onSelectAllRuns: () => void;
  onClearSelectedRuns: () => void;
  onTogglePinRun: (runName: string) => void;
  onSelectRun: (runName: string) => void;
  onCompareSelected: () => void;
  onSelectView?: (view: ControlCenterView) => void;
}

type SortField = "newest" | "oldest" | "duration" | "findings" | "critical" | "target";
type StatusFilter = "all" | "active" | "completed" | "stopped" | "corrupt";
type DateFilter = "all" | "today" | "24h" | "7d" | "30d";

function formatDurationSeconds(sec?: number | null): string {
  if (sec == null || isNaN(sec)) return "N/A";
  if (sec < 0) return "N/A";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function SessionArchiveTable({
  runs,
  activeRunName,
  selectedRunNames,
  pinnedRunNames,
  onToggleSelectRun,
  onSelectAllRuns,
  onClearSelectedRuns,
  onTogglePinRun,
  onSelectRun,
  onCompareSelected,
  onSelectView,
}: SessionArchiveTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("newest");

  // Filter runs based on search, status, date, and pinned state
  const filteredRuns = useMemo(() => {
    const now = Date.now();
    return runs.filter((r) => {
      // 1. Pinned filter
      if (pinnedOnly && !pinnedRunNames.includes(r.name)) {
        return false;
      }

      // 2. Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = r.name.toLowerCase().includes(q);
        const matchesTarget = (r.target || "").toLowerCase().includes(q);
        const matchesMode = (r.scan_mode || "").toLowerCase().includes(q);
        const matchesTargets = (r.targets || []).some((t) => t.toLowerCase().includes(q));
        if (!matchesName && !matchesTarget && !matchesMode && !matchesTargets) {
          return false;
        }
      }

      // 3. Status filter
      if (statusFilter === "active" && r.finished) return false;
      if (statusFilter === "completed" && (!r.finished || r.is_corrupt)) return false;
      if (statusFilter === "stopped" && r.status !== "stopped") return false;
      if (statusFilter === "corrupt" && !r.is_corrupt && !r.is_incomplete) return false;

      // 4. Date filter
      if (dateFilter !== "all" && r.start_time) {
        const startMs = new Date(r.start_time).getTime();
        if (!isNaN(startMs)) {
          const diffMs = now - startMs;
          if (dateFilter === "today") {
            const startDay = new Date(r.start_time).toDateString();
            const today = new Date().toDateString();
            if (startDay !== today) return false;
          } else if (dateFilter === "24h" && diffMs > 24 * 3600 * 1000) {
            return false;
          } else if (dateFilter === "7d" && diffMs > 7 * 24 * 3600 * 1000) {
            return false;
          } else if (dateFilter === "30d" && diffMs > 30 * 24 * 3600 * 1000) {
            return false;
          }
        }
      }

      return true;
    });
  }, [runs, search, statusFilter, dateFilter, pinnedOnly, pinnedRunNames]);

  // Sort filtered runs
  const sortedRuns = useMemo(() => {
    return [...filteredRuns].sort((a, b) => {
      if (sortField === "newest") {
        const tA = a.start_time ? new Date(a.start_time).getTime() : 0;
        const tB = b.start_time ? new Date(b.start_time).getTime() : 0;
        return tB - tA;
      }
      if (sortField === "oldest") {
        const tA = a.start_time ? new Date(a.start_time).getTime() : 0;
        const tB = b.start_time ? new Date(b.start_time).getTime() : 0;
        return tA - tB;
      }
      if (sortField === "duration") {
        const dA = a.duration_seconds ?? -1;
        const dB = b.duration_seconds ?? -1;
        return dB - dA;
      }
      if (sortField === "findings") {
        const fA =
          (a.findings_count ??
            (a.severity_counts.critical +
              a.severity_counts.high +
              a.severity_counts.medium +
              a.severity_counts.low));
        const fB =
          (b.findings_count ??
            (b.severity_counts.critical +
              b.severity_counts.high +
              b.severity_counts.medium +
              b.severity_counts.low));
        return fB - fA;
      }
      if (sortField === "critical") {
        return (b.severity_counts.critical || 0) - (a.severity_counts.critical || 0);
      }
      if (sortField === "target") {
        return (a.target || "").localeCompare(b.target || "");
      }
      return 0;
    });
  }, [filteredRuns, sortField]);

  return (
    <div className="space-y-4">
      {/* Search, Filter & Sort Controls */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-4 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search session name, target, scan mode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-zinc-900/90 pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:border-cyan-500/50 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-2.5 text-xs text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Actions & Compare Button */}
          <div className="flex flex-wrap items-center gap-2">
            {selectedRunNames.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-cyan-400 font-semibold">
                  {selectedRunNames.length} selected
                </span>
                <button
                  type="button"
                  onClick={onCompareSelected}
                  disabled={selectedRunNames.length < 2}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold font-mono transition-colors",
                    selectedRunNames.length >= 2
                      ? "bg-cyan-500 text-black hover:bg-cyan-400 shadow-lg shadow-cyan-500/20"
                      : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
                  )}
                  title={
                    selectedRunNames.length < 2
                      ? "Select at least 2 sessions to compare"
                      : "Compare selected sessions side-by-side"
                  }
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  <span>Compare Selected ({selectedRunNames.length})</span>
                </button>
                <button
                  type="button"
                  onClick={onClearSelectedRuns}
                  className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
                >
                  Clear
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onSelectAllRuns}
              className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
            >
              Select All
            </button>
          </div>
        </div>

        {/* Filter Pills Bar */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5 text-xs font-mono">
          {/* Status Filters */}
          <div className="flex items-center gap-1 bg-zinc-900/60 p-1 rounded-lg border border-white/5">
            <span className="text-zinc-500 px-1 text-[11px]">Status:</span>
            {(["all", "active", "completed", "stopped", "corrupt"] as StatusFilter[]).map(
              (status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "rounded px-2 py-0.5 capitalize transition-colors",
                    statusFilter === status
                      ? "bg-white/15 text-white font-medium shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {status}
                </button>
              )
            )}
          </div>

          {/* Date Filters */}
          <div className="flex items-center gap-1 bg-zinc-900/60 p-1 rounded-lg border border-white/5">
            <span className="text-zinc-500 px-1 text-[11px]">Period:</span>
            {(["all", "today", "24h", "7d", "30d"] as DateFilter[]).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setDateFilter(period)}
                className={cn(
                  "rounded px-2 py-0.5 uppercase transition-colors",
                  dateFilter === period
                    ? "bg-cyan-500/20 text-cyan-300 font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                {period}
              </button>
            ))}
          </div>

          {/* Pinned Toggle */}
          <button
            type="button"
            onClick={() => setPinnedOnly(!pinnedOnly)}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 border transition-colors",
              pinnedOnly
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 font-medium"
                : "border-white/10 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            )}
          >
            <Star className={cn("h-3 w-3", pinnedOnly ? "fill-amber-400 text-amber-400" : "")} />
            <span>Pinned Only ({pinnedRunNames.length})</span>
          </button>

          {/* Sort Selector */}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-zinc-500 text-[11px]">Sort:</span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="h-7 rounded border border-white/10 bg-zinc-900 px-2 text-xs text-zinc-300 focus:border-cyan-500/50 focus:outline-none"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="duration">Longest Duration</option>
              <option value="findings">Most Findings</option>
              <option value="critical">Most Criticals</option>
              <option value="target">Target Name</option>
            </select>
          </div>
        </div>
      </div>

      {/* Archive Grid / Table */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 text-[11px] font-mono uppercase text-zinc-400 border-b border-white/10">
              <tr>
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={
                      sortedRuns.length > 0 &&
                      sortedRuns.every((r) => selectedRunNames.includes(r.name))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectAllRuns();
                      } else {
                        onClearSelectedRuns();
                      }
                    }}
                    className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-0"
                  />
                </th>
                <th className="w-10 px-2 py-3 text-center">Pin</th>
                <th className="px-4 py-3">Session Name & Status</th>
                <th className="px-4 py-3">Target(s)</th>
                <th className="px-3 py-3">Scan Mode</th>
                <th className="px-3 py-3">Started</th>
                <th className="px-3 py-3">Duration</th>
                <th className="px-3 py-3">Findings</th>
                <th className="px-3 py-3">Agents</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {sortedRuns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-zinc-500">
                    No sessions match your filter criteria in the archive.
                  </td>
                </tr>
              ) : (
                sortedRuns.map((r) => {
                  const isSelected = selectedRunNames.includes(r.name);
                  const isPinned = pinnedRunNames.includes(r.name);
                  const isCurrent = activeRunName === r.name;
                  const totalFindings =
                    r.findings_count ??
                    (r.severity_counts.critical +
                      r.severity_counts.high +
                      r.severity_counts.medium +
                      r.severity_counts.low);

                  return (
                    <tr
                      key={r.name}
                      className={cn(
                        "transition-colors hover:bg-white/[0.03]",
                        isCurrent && "bg-cyan-500/[0.06] border-l-2 border-l-cyan-400",
                        isSelected && "bg-white/[0.04]"
                      )}
                    >
                      {/* Select Checkbox */}
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelectRun(r.name)}
                          className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-0"
                        />
                      </td>

                      {/* Pin Star */}
                      <td className="px-2 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => onTogglePinRun(r.name)}
                          className="text-zinc-600 hover:text-amber-400 transition-colors"
                          title={isPinned ? "Unpin session" : "Pin session"}
                        >
                          <Star
                            className={cn(
                              "h-3.5 w-3.5",
                              isPinned ? "fill-amber-400 text-amber-400" : ""
                            )}
                          />
                        </button>
                      </td>

                      {/* Session Name & Status Badge */}
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectRun(r.name)}
                              className="font-semibold text-white hover:text-cyan-300 text-xs text-left"
                            >
                              {r.name}
                            </button>
                            {isCurrent && (
                              <span className="rounded bg-cyan-500/20 border border-cyan-500/30 px-1.5 py-0.2 text-[10px] text-cyan-300">
                                ACTIVE
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {r.is_corrupt ? (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-300">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                <span>CORRUPTED</span>
                              </span>
                            ) : r.is_incomplete ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                                <Clock className="h-2.5 w-2.5" />
                                <span>INCOMPLETE</span>
                              </span>
                            ) : r.finished ? (
                              <span className="inline-flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300">
                                <CheckCircle2 className="h-2.5 w-2.5 text-zinc-400" />
                                <span>COMPLETED</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-300 animate-pulse">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                <span>RUNNING</span>
                              </span>
                            )}

                            {r.status && r.status !== "completed" && r.status !== "running" && (
                              <span className="text-[10px] text-zinc-500 uppercase">
                                [{r.status}]
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Target(s) */}
                      <td className="px-4 py-3">
                        <div className="max-w-[220px] truncate text-zinc-300">
                          <span className="text-cyan-400">
                            {maskSecrets(r.target || "Local Scope")}
                          </span>
                          {r.targets && r.targets.length > 1 && (
                            <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.2 text-[10px] text-zinc-400 font-normal">
                              +{r.targets.length - 1} more
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Scan Mode */}
                      <td className="px-3 py-3">
                        <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase text-zinc-400">
                          {r.scan_mode || "quick"}
                        </span>
                      </td>

                      {/* Started */}
                      <td className="px-3 py-3 text-zinc-400 text-[11px]">
                        {r.start_time ? (
                          <div className="flex flex-col">
                            <span>{new Date(r.start_time).toLocaleDateString()}</span>
                            <span className="text-zinc-600 text-[10px]">
                              {new Date(r.start_time).toLocaleTimeString()}
                            </span>
                          </div>
                        ) : (
                          "N/A"
                        )}
                      </td>

                      {/* Duration */}
                      <td className="px-3 py-3 text-zinc-300 font-semibold">
                        {formatDurationSeconds(r.duration_seconds)}
                      </td>

                      {/* Findings Pill */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "font-bold",
                              r.severity_counts.critical > 0
                                ? "text-rose-400"
                                : totalFindings > 0
                                ? "text-amber-400"
                                : "text-zinc-500"
                            )}
                          >
                            {totalFindings}
                          </span>
                          {totalFindings > 0 && (
                            <div className="flex items-center gap-1 text-[10px]">
                              {r.severity_counts.critical > 0 && (
                                <span className="text-rose-400 font-semibold">
                                  {r.severity_counts.critical}C
                                </span>
                              )}
                              {r.severity_counts.high > 0 && (
                                <span className="text-orange-400 font-semibold">
                                  {r.severity_counts.high}H
                                </span>
                              )}
                              {r.severity_counts.medium > 0 && (
                                <span className="text-amber-400 font-semibold">
                                  {r.severity_counts.medium}M
                                </span>
                              )}
                              {r.severity_counts.low > 0 && (
                                <span className="text-blue-400 font-semibold">
                                  {r.severity_counts.low}L
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Agents Count */}
                      <td className="px-3 py-3 text-zinc-400">
                        <span className="text-purple-400 font-semibold">
                          {r.agents_count ?? 1}
                        </span>{" "}
                        <span className="text-[10px] text-zinc-500">nodes</span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectRun(r.name)}
                            className={cn(
                              "rounded px-2.5 py-1 text-xs transition-colors",
                              isCurrent
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                : "bg-white/5 text-zinc-300 hover:bg-white/10"
                            )}
                          >
                            {isCurrent ? "Inspecting" : "Inspect"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="flex items-center justify-between border-t border-white/5 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500 font-mono">
          <span>
            Showing {sortedRuns.length} of {runs.length} recorded sessions
          </span>
          <div className="flex items-center gap-3">
            <span>
              Pinned: <strong className="text-amber-400">{pinnedRunNames.length}</strong>
            </span>
            <span>
              Selected for Compare:{" "}
              <strong className="text-cyan-400">{selectedRunNames.length}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
