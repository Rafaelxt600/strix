import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  GitCompare,
  Layers,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  StopCircle,
  Target,
  Terminal,
  Zap,
} from "lucide-react";
import type { LoadedRun, RunListEntry, RunsPayload } from "@/data/serverSource";
import type {
  ConnectionState,
  ControlCenterView,
  OfficialSessionStatus,
  RealtimeTelemetry,
  SessionInspectionDetails,
  SessionStateClassification,
} from "@/types/control-center";
import { runTitle } from "@/lib/target-utils";
import { maskSecrets } from "@/lib/security";
import { cn } from "@/lib/utils";
import { SessionArchiveTable } from "./sessions/SessionArchiveTable";
import { GlobalSearchPanel } from "./sessions/GlobalSearchPanel";
import { CrossRunComparePanel } from "./sessions/CrossRunComparePanel";
import { HistoricalIntelligencePanel } from "./sessions/HistoricalIntelligencePanel";

interface SessionsViewProps {
  currentRun: LoadedRun | null;
  activeRunName: string | null;
  runsPayload: RunsPayload | null;
  onSelectRun: (runName: string | null) => void;
  onSelectView?: (view: ControlCenterView) => void;
  onOpenVerify?: () => void;
  verified?: boolean;
  telemetry?: RealtimeTelemetry;
}

type SessionsSubView = "archive" | "search" | "compare" | "intelligence" | "inspector";

function formatSessionDuration(startStr?: string | null, endStr?: string | null): string {
  if (!startStr) return "N/A";
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return "N/A";
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  if (isNaN(end) || end < start) return "N/A";
  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatRelativeTime(timestamp?: string | null): string {
  if (!timestamp) return "N/A";
  const t = new Date(timestamp).getTime();
  if (isNaN(t)) return "N/A";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function resolveSessionDetails(
  run: LoadedRun | null,
  activeRunName: string | null,
  telemetry?: RealtimeTelemetry
): SessionInspectionDetails {
  if (!run) {
    return {
      id: activeRunName || "N/A",
      status: "stopped",
      classification: "stopped",
      startTime: null,
      lastActivity: null,
      duration: "N/A",
      agentCount: 0,
      eventCount: 0,
      findingCount: 0,
      errorCount: 0,
      transportState: telemetry?.connectionState || "DISCONNECTED",
      reconnectCount: telemetry?.reconnectAttempts || 0,
      deduplicatedCount: telemetry?.deduplicatedCount || 0,
    };
  }

  const { summary, raw, finished, vulnerabilities, transcript } = run;
  const events = transcript.events;
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;

  // Calculate real error count
  const errorCount = events.filter((e) => {
    const d = (e.data as Record<string, unknown>) || {};
    return d.error != null || d.is_error === true || d.status === "failed";
  }).length;

  const rawStatus = String(raw.status || summary.status || "").toLowerCase();

  // Resolve official status
  let status: OfficialSessionStatus = "running";
  if (finished) {
    status = "completed";
  } else if (rawStatus.includes("budget") || rawStatus.includes("paused")) {
    status = "budget_paused";
  } else if (rawStatus.includes("wait")) {
    status = "waiting";
  } else if (rawStatus.includes("stop") || rawStatus.includes("cancel")) {
    status = "stopped";
  } else {
    status = "running";
  }

  // Resolve semantic classification (active, paused, completed, stopped, error)
  let classification: SessionStateClassification = "active";
  if (errorCount > 0 && finished && vulnerabilities.length === 0) {
    classification = "error";
  } else if (status === "budget_paused" || telemetry?.isPaused) {
    classification = "paused";
  } else if (status === "completed") {
    classification = "completed";
  } else if (status === "stopped") {
    classification = "stopped";
  } else {
    classification = "active";
  }

  const duration = formatSessionDuration(summary.startTime, summary.endTime);
  const lastActivity = lastEvent ? formatRelativeTime(lastEvent.timestamp) : "N/A";

  return {
    id: summary.runId || activeRunName || "session-local-01",
    status,
    classification,
    startTime: summary.startTime ? new Date(summary.startTime).toLocaleString() : "N/A",
    lastActivity,
    duration,
    agentCount: transcript.agents.length,
    eventCount: events.length,
    findingCount: vulnerabilities.length,
    errorCount,
    transportState: telemetry?.connectionState || "CONNECTED",
    reconnectCount: telemetry?.reconnectAttempts || 0,
    deduplicatedCount: telemetry?.deduplicatedCount || 0,
    scanMode: summary.scanMode || "quick",
    target: summary.targets?.[0] || null,
  };
}

export function SessionsView({
  currentRun,
  activeRunName,
  runsPayload,
  onSelectRun,
  onSelectView,
  onOpenVerify,
  verified,
  telemetry,
}: SessionsViewProps) {
  const [subView, setSubView] = useState<SessionsSubView>("archive");
  const [selectedRunNames, setSelectedRunNames] = useState<string[]>([]);
  const [pinnedRunNames, setPinnedRunNames] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("strix_pinned_runs");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const runs = runsPayload?.runs || [];
  const isLocked = runsPayload?.locked ?? false;

  // Persist pinned run names to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("strix_pinned_runs", JSON.stringify(pinnedRunNames));
    } catch (e) {
      console.warn("Could not save pinned runs:", e);
    }
  }, [pinnedRunNames]);

  const sessionDetails = useMemo(
    () => resolveSessionDetails(currentRun, activeRunName, telemetry),
    [currentRun, activeRunName, telemetry]
  );

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleToggleSelectRun = (runName: string) => {
    setSelectedRunNames((prev) =>
      prev.includes(runName) ? prev.filter((r) => r !== runName) : [...prev, runName]
    );
  };

  const handleSelectAllRuns = () => {
    setSelectedRunNames(runs.map((r) => r.name));
  };

  const handleClearSelectedRuns = () => {
    setSelectedRunNames([]);
  };

  const handleTogglePinRun = (runName: string) => {
    setPinnedRunNames((prev) =>
      prev.includes(runName) ? prev.filter((r) => r !== runName) : [...prev, runName]
    );
  };

  const handleCompareSelected = () => {
    setSubView("compare");
  };

  return (
    <div className="space-y-6 p-6">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <Clock className="h-6 w-6 text-cyan-400" />
            <span>Session Archive & Cross-Run Intelligence</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Global session repository, cross-run diffing, multi-session search, and deep canonical audit tree.
          </p>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/80 p-1 text-xs font-mono">
          <button
            type="button"
            onClick={() => setSubView("archive")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              subView === "archive"
                ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Archive ({runs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView("search")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              subView === "search"
                ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Global Search</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView("compare")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              subView === "compare"
                ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <GitCompare className="h-3.5 w-3.5" />
            <span>Compare</span>
            {selectedRunNames.length > 0 && (
              <span className="rounded bg-cyan-500/30 px-1.5 py-0.2 text-[10px] text-cyan-200 font-bold">
                {selectedRunNames.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubView("intelligence")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              subView === "intelligence"
                ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Intelligence</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView("inspector")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
              subView === "inspector"
                ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30"
                : "text-zinc-400 hover:text-white"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Inspector</span>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                sessionDetails.classification === "active" ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              )}
            />
          </button>
        </div>
      </div>

      {/* Verification Required Banner (Session Isolation Gate) */}
      {isLocked && !verified && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-amber-200">
            <Lock className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Cross-run investigation is locked for unverified sessions to preserve isolation. Verify local session to unlock full fleet access.
            </span>
          </div>
          {onOpenVerify && (
            <button
              type="button"
              onClick={onOpenVerify}
              className="rounded-lg bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 font-mono shrink-0"
            >
              Verify Session
            </button>
          )}
        </div>
      )}

      {/* VIEW: ARCHIVE */}
      {subView === "archive" && (
        <SessionArchiveTable
          runs={runs}
          activeRunName={activeRunName}
          selectedRunNames={selectedRunNames}
          pinnedRunNames={pinnedRunNames}
          onToggleSelectRun={handleToggleSelectRun}
          onSelectAllRuns={handleSelectAllRuns}
          onClearSelectedRuns={handleClearSelectedRuns}
          onTogglePinRun={handleTogglePinRun}
          onSelectRun={(name) => {
            onSelectRun(name);
            setSubView("inspector");
          }}
          onCompareSelected={handleCompareSelected}
          onSelectView={onSelectView}
        />
      )}

      {/* VIEW: GLOBAL SEARCH */}
      {subView === "search" && (
        <GlobalSearchPanel
          onSelectRun={(name) => {
            onSelectRun(name);
            setSubView("inspector");
          }}
          onSelectView={onSelectView}
          activeRunName={activeRunName}
        />
      )}

      {/* VIEW: COMPARE */}
      {subView === "compare" && (
        <CrossRunComparePanel
          selectedRunNames={selectedRunNames}
          runs={runs}
          onSelectRun={(name) => {
            onSelectRun(name);
            setSubView("inspector");
          }}
          onToggleSelectRun={handleToggleSelectRun}
          onSelectView={onSelectView}
        />
      )}

      {/* VIEW: HISTORICAL INTELLIGENCE */}
      {subView === "intelligence" && (
        <HistoricalIntelligencePanel
          runs={runs}
          onSelectRun={(name) => {
            onSelectRun(name);
            setSubView("inspector");
          }}
          onSelectView={onSelectView}
        />
      )}

      {/* VIEW: CANONICAL SESSION INSPECTOR (UI-03 & UI-04 Preserved Deep Spec) */}
      {subView === "inspector" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-zinc-950 via-zinc-900/90 to-zinc-950 p-6 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Session Inspector</span>
                    <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                      CANONICAL AUDIT TREE
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 font-mono mt-0.5">
                    Target: {maskSecrets(sessionDetails.target || "Local Project Environment")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Semantic State Badge */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono font-semibold uppercase",
                    sessionDetails.classification === "active" &&
                      "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse",
                    sessionDetails.classification === "paused" &&
                      "bg-amber-500/15 text-amber-300 border border-amber-500/30",
                    sessionDetails.classification === "completed" &&
                      "bg-blue-500/15 text-blue-300 border border-blue-500/30",
                    sessionDetails.classification === "stopped" &&
                      "bg-zinc-800 text-zinc-300 border border-zinc-700",
                    sessionDetails.classification === "error" &&
                      "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  <span>
                    {sessionDetails.classification === "active"
                      ? "SESSÃO ATIVA"
                      : sessionDetails.classification === "paused"
                      ? "SESSÃO PAUSADA"
                      : sessionDetails.classification === "completed"
                      ? "SESSÃO CONCLUÍDA"
                      : sessionDetails.classification === "stopped"
                      ? "SESSÃO INTERROMPIDA"
                      : "SESSÃO COM ERRO"}
                  </span>
                </span>

                {activeRunName && (
                  <button
                    type="button"
                    onClick={() => onSelectRun(null)}
                    className="flex items-center gap-1 rounded bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs text-cyan-400 transition-colors font-mono"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Return Live</span>
                  </button>
                )}
              </div>
            </div>

            {/* Tree Representation Visualizer */}
            <div className="mt-5 rounded-lg border border-white/5 bg-black/80 p-4 font-mono text-xs text-zinc-300 shadow-inner space-y-2">
              <div className="text-zinc-500 font-semibold select-none flex items-center justify-between pb-1 border-b border-white/5">
                <span>OPERATIONAL SPEC TREE (GATE UI-03)</span>
                <span className="text-[10px] text-zinc-600">ID: {sessionDetails.id}</span>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="text-white font-bold flex items-center gap-1.5">
                  <span className="text-cyan-400">Session</span>
                  <span className="text-zinc-500 font-normal">[{sessionDetails.id}]</span>
                </div>

                {/* Tree Nodes */}
                <div className="pl-4 border-l border-zinc-800 space-y-1.5">
                  {/* ID */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── ID:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-semibold">{sessionDetails.id}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy("id", sessionDetails.id)}
                        className="text-zinc-500 hover:text-white"
                      >
                        {copiedField === "id" ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Status:</span>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-bold uppercase",
                        sessionDetails.status === "running" && "bg-blue-500/20 text-blue-300 border border-blue-500/30",
                        sessionDetails.status === "waiting" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                        sessionDetails.status === "budget_paused" && "bg-purple-500/20 text-purple-300 border border-purple-500/30",
                        sessionDetails.status === "completed" && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                        sessionDetails.status === "stopped" && "bg-zinc-800 text-zinc-400 border border-zinc-700"
                      )}
                    >
                      {sessionDetails.status}
                    </span>
                  </div>

                  {/* Start Time */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Start Time:</span>
                    <span className="text-zinc-200">{sessionDetails.startTime || "N/A"}</span>
                  </div>

                  {/* Last Activity */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Last Activity:</span>
                    <span className="text-cyan-300">{sessionDetails.lastActivity}</span>
                  </div>

                  {/* Duration */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Duration:</span>
                    <span className="text-white font-semibold">{sessionDetails.duration}</span>
                  </div>

                  {/* Agent Count */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Agent Count:</span>
                    <span className="text-cyan-400 font-semibold">{sessionDetails.agentCount} nodes</span>
                  </div>

                  {/* Event Count */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Event Count:</span>
                    <span className="text-white">
                      {sessionDetails.eventCount}{" "}
                      {sessionDetails.deduplicatedCount > 0 && (
                        <span className="text-zinc-500">({sessionDetails.deduplicatedCount} deduped)</span>
                      )}
                    </span>
                  </div>

                  {/* Finding Count */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Finding Count:</span>
                    <span className="text-rose-400 font-bold">{sessionDetails.findingCount} vulnerabilities</span>
                  </div>

                  {/* Error Count */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">├── Error Count:</span>
                    <span
                      className={cn(
                        "font-semibold",
                        sessionDetails.errorCount > 0 ? "text-rose-400" : "text-emerald-400"
                      )}
                    >
                      {sessionDetails.errorCount} errors
                    </span>
                  </div>

                  {/* Transport State */}
                  <div className="flex items-center justify-between hover:bg-white/[0.02] p-1 rounded">
                    <span className="text-zinc-400">└── Transport State:</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-[10px] font-bold uppercase",
                          sessionDetails.transportState === "CONNECTED" && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                          sessionDetails.transportState === "CONNECTING" && "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30",
                          sessionDetails.transportState === "RECONNECTING" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                          sessionDetails.transportState === "ERROR" && "bg-rose-500/20 text-rose-300 border border-rose-500/30",
                          sessionDetails.transportState === "DISCONNECTED" && "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        )}
                      >
                        {sessionDetails.transportState}
                      </span>
                      {sessionDetails.reconnectCount > 0 && (
                        <span className="text-amber-400 text-[10px]">
                          (retry #{sessionDetails.reconnectCount})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SESSION ACTIONS BAR (GATE UI-04) */}
            <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                <span className="text-zinc-500 font-semibold uppercase">SESSION ACTIONS:</span>
                <span>[{sessionDetails.id}]</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy("session_action_id", sessionDetails.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/80 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/10 transition-colors font-mono"
                >
                  {copiedField === "session_action_id" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-zinc-400" />
                  )}
                  <span>{copiedField === "session_action_id" ? "Copied" : "Copy ID"}</span>
                </button>

                {onSelectView && (
                  <>
                    <button
                      type="button"
                      onClick={() => onSelectView("events")}
                      className="flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/20 transition-colors font-mono"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      <span>Open Events</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectView("findings")}
                      className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 transition-colors font-mono"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span>Open Findings</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectView("logs")}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20 transition-colors font-mono"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      <span>Open Logs</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectView("agents")}
                      className="flex items-center gap-1.5 rounded-lg border border-purple-500/20 bg-purple-500/10 px-2.5 py-1.5 text-xs text-purple-300 hover:bg-purple-500/20 transition-colors font-mono"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      <span>Open Agents</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
