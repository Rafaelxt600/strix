import React, { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  Lock,
  Play,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  Target,
} from "lucide-react";
import type { LoadedRun, RunListEntry, RunsPayload } from "@/data/serverSource";
import { runTitle } from "@/lib/target-utils";
import { cn } from "@/lib/utils";

interface SessionsViewProps {
  currentRun: LoadedRun | null;
  activeRunName: string | null;
  runsPayload: RunsPayload | null;
  onSelectRun: (runName: string | null) => void;
  onOpenVerify?: () => void;
  verified?: boolean;
}

export function SessionsView({
  currentRun,
  activeRunName,
  runsPayload,
  onSelectRun,
  onOpenVerify,
  verified,
}: SessionsViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");

  const runs = runsPayload?.runs || [];
  const isLocked = runsPayload?.locked ?? false;

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      const matchesSearch =
        search.trim() === "" ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.target && r.target.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && !r.finished) ||
        (statusFilter === "completed" && r.finished);

      return matchesSearch && matchesStatus;
    });
  }, [runs, search, statusFilter]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <Clock className="h-5 w-5 text-cyan-400" />
            <span>Session & Run Intelligence</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage autonomous execution sessions, inspect historical pentest runs, and switch execution contexts.
          </p>
        </div>

        {/* Filter / Search Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search sessions or targets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 rounded-lg border border-white/10 bg-zinc-900/80 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>

          <div className="flex rounded-lg border border-white/10 bg-zinc-900/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                statusFilter === "all" ? "bg-white/10 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              All ({runs.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                statusFilter === "active" ? "bg-white/10 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("completed")}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                statusFilter === "completed" ? "bg-white/10 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Completed
            </button>
          </div>
        </div>
      </div>

      {/* Active Session Hero Card */}
      {currentRun && (
        <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-zinc-950 via-cyan-950/20 to-zinc-950 p-5 shadow-lg">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-semibold uppercase text-emerald-400">
                Current Loaded Session
              </span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-zinc-300">
                {activeRunName || currentRun.summary.runId || "Default Live Session"}
              </span>
            </div>

            {activeRunName && (
              <button
                type="button"
                onClick={() => onSelectRun(null)}
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Return to Live Default</span>
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs font-mono">
            <div>
              <span className="text-zinc-500">Target</span>
              <p className="mt-1 text-sm font-semibold text-white truncate">
                {(currentRun.summary.targets && currentRun.summary.targets[0]) || "Local Project"}
              </p>
            </div>
            <div>
              <span className="text-zinc-500">Scan Mode</span>
              <p className="mt-1 text-sm font-semibold text-cyan-300 capitalize">
                {currentRun.summary.scanMode || "Quick"}
              </p>
            </div>
            <div>
              <span className="text-zinc-500">Agents Involved</span>
              <p className="mt-1 text-sm font-semibold text-white">
                {currentRun.transcript.agents.length} nodes
              </p>
            </div>
            <div>
              <span className="text-zinc-500">Findings</span>
              <p className="mt-1 text-sm font-semibold text-rose-400">
                {currentRun.vulnerabilities.length} vulnerabilities
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Historical Sessions List */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center justify-between">
          <span>Session Repository ({filteredRuns.length})</span>
          {isLocked && !verified && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 font-mono">
              <Lock className="h-3.5 w-3.5" />
              <span>Full History Locked (Verification Required)</span>
            </span>
          )}
        </h3>

        {isLocked && !verified && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-center">
            <p className="text-xs text-amber-300/90">
              The local server gates cross-run history behind local email verification to ensure session isolation.
            </p>
            <button
              type="button"
              onClick={onOpenVerify}
              className="mt-2 rounded-md bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30"
            >
              Verify Session to Unlock
            </button>
          </div>
        )}

        {filteredRuns.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">
            {search ? "No sessions match your filter criteria." : "No prior sessions recorded on this machine yet."}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredRuns.map((r) => {
              const isActive = (activeRunName && r.name === activeRunName) || (!activeRunName && !r.finished);
              return (
                <div
                  key={r.name}
                  onClick={() => onSelectRun(r.name)}
                  className={cn(
                    "flex flex-col gap-2 py-3 px-3 rounded-lg transition-colors cursor-pointer sm:flex-row sm:items-center sm:justify-between",
                    isActive ? "bg-white/[0.08] border border-cyan-500/30" : "hover:bg-white/[0.03]"
                  )}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white font-mono">{r.name}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.2 text-[10px] font-mono uppercase font-semibold",
                          r.finished
                            ? "bg-zinc-800 text-zinc-400 border border-zinc-700"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse"
                        )}
                      >
                        {r.finished ? "Completed" : "Active"}
                      </span>
                      {r.scan_mode && (
                        <span className="text-[10px] text-zinc-500 font-mono">
                          [{r.scan_mode}]
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span className="flex items-center gap-1 truncate max-w-[280px]">
                        <Target className="h-3 w-3 text-cyan-400 shrink-0" />
                        {r.target || "Local Scope"}
                      </span>
                      {r.start_time && (
                        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                          <Calendar className="h-3 w-3 shrink-0" />
                          {new Date(r.start_time).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <span className="text-rose-400 font-semibold">{r.severity_counts.critical}C</span>
                      <span className="text-orange-400 font-semibold">{r.severity_counts.high}H</span>
                      <span className="text-amber-400 font-semibold">{r.severity_counts.medium}M</span>
                      <span className="text-blue-400 font-semibold">{r.severity_counts.low}L</span>
                    </div>

                    <button
                      type="button"
                      className="rounded bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
                    >
                      {isActive ? "Active" : "Switch"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
