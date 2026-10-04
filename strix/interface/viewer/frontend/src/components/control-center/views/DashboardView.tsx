import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  DollarSign,
  Layers,
  Radio,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  Target,
  Terminal,
  Wrench,
} from "lucide-react";
import type { LoadedRun, McpConnectionStatus } from "@/data/serverSource";
import type { ControlCenterView, RealtimeTelemetry } from "@/types/control-center";
import { severityCounts } from "@/lib/local-run-parser";
import { runTitle } from "@/lib/target-utils";
import { cn } from "@/lib/utils";

interface DashboardViewProps {
  run: LoadedRun | null;
  activeRunName?: string | null;
  mcpConnections: McpConnectionStatus[];
  onSelectView: (view: ControlCenterView) => void;
  onSelectFinding?: (findingId: string) => void;
  onSelectVulnerability?: (findingId: string) => void;
  error?: string | null;
  telemetry?: RealtimeTelemetry;
}

export function DashboardView({
  run,
  activeRunName,
  mcpConnections,
  onSelectView,
  onSelectFinding,
  onSelectVulnerability,
  error,
  telemetry,
}: DashboardViewProps) {
  const handleSelectFinding = onSelectFinding || onSelectVulnerability || (() => {});
  const connState = telemetry?.connectionState ?? "CONNECTED";
  if (error) {
    return (
      <div className="flex h-96 flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 rounded-full bg-rose-500/10 p-3 text-rose-400">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-semibold text-white">Connection Error</h3>
        <p className="mt-1 max-w-md text-sm text-zinc-400">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-96 flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 rounded-full bg-zinc-800 p-3 text-zinc-400">
          <Layers className="h-8 w-8 animate-pulse" />
        </div>
        <h3 className="text-lg font-semibold text-white">Loading Strix Control Center...</h3>
        <p className="mt-1 text-sm text-zinc-500">Connecting to local session stream</p>
      </div>
    );
  }

  const { summary, raw, finished, vulnerabilities, transcript } = run;
  const counts = severityCounts(vulnerabilities);
  const agentCount = transcript.agents.length;
  const eventCount = transcript.events.length;
  const toolEvents = transcript.events.filter((e) => e.type === "tool");
  const recentEvents = [...transcript.events].slice(-5).reverse();

  // Extract LLM cost and tokens from raw run
  const llmUsage = (raw.llm_usage as Record<string, unknown>) || {};
  const cost = typeof llmUsage.cost === "number" ? `$${llmUsage.cost.toFixed(2)}` : "$0.00";
  const tokens = typeof llmUsage.total_tokens === "number" ? llmUsage.total_tokens.toLocaleString() : "0";

  return (
    <div className="space-y-6 p-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 p-6 shadow-xl">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  connState === "CONNECTED" && !finished
                    ? "bg-emerald-400 animate-pulse"
                    : connState === "CONNECTING"
                    ? "bg-cyan-400 animate-ping"
                    : connState === "RECONNECTING"
                    ? "bg-amber-400 animate-bounce"
                    : finished
                    ? "bg-zinc-500"
                    : "bg-zinc-600"
                )}
              />
              <span className="text-xs font-mono text-emerald-400 tracking-wider uppercase font-semibold">
                {connState === "CONNECTED" && !finished
                  ? `Autonomous Security Mission Control • LIVE (${telemetry?.transportMode?.toUpperCase() || "STREAM"})`
                  : connState === "RECONNECTING"
                  ? `Reconnecting to local engine (Attempt ${telemetry?.reconnectAttempts || 1})...`
                  : finished
                  ? "Autonomous Security Mission Control • RUN FINISHED"
                  : "Autonomous Security Mission Control"}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {summary.targets?.[0] ? runTitle(summary.targets[0], summary.runName || summary.runId || "Local Autonomous Scan") : "Local Autonomous Scan"}
            </h1>
            <p className="text-xs text-zinc-400 font-mono">
              Session ID: <span className="text-zinc-200">{summary.runId || "active"}</span> • Mode:{" "}
              <span className="text-cyan-300 uppercase">{summary.scanMode || "standard"}</span> • Status:{" "}
              <span className={finished ? "text-zinc-400" : "text-emerald-400 font-semibold"}>
                {finished ? "Completed" : "Active Scanning"}
              </span>
              {telemetry?.lastHeartbeat && (
                <span className="text-zinc-500 hidden sm:inline ml-2">
                  • Last Sync: {new Date(telemetry.lastHeartbeat).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectView("agents")}
              className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              <Bot className="h-4 w-4" />
              <span>Inspect Agent Graph</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectView("findings")}
              className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors"
            >
              <ShieldAlert className="h-4 w-4" />
              <span>Review Findings ({vulnerabilities.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Active Agents */}
        <div
          onClick={() => onSelectView("agents")}
          className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-cyan-500/30 hover:bg-zinc-900/60"
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Agents</span>
            <Bot className="h-4 w-4 text-cyan-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">{agentCount}</div>
          <div className="mt-1 text-[11px] text-zinc-500">Autonomous Nodes</div>
        </div>

        {/* Total Findings */}
        <div
          onClick={() => onSelectView("findings")}
          className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-rose-500/30 hover:bg-zinc-900/60"
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Findings</span>
            <ShieldAlert className="h-4 w-4 text-rose-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-400">
            {vulnerabilities.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            {counts.critical} Crit • {counts.high} High
          </div>
        </div>

        {/* Tool Executions */}
        <div
          onClick={() => onSelectView("tools")}
          className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-emerald-500/30 hover:bg-zinc-900/60"
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Tool Invocations</span>
            <Wrench className="h-4 w-4 text-emerald-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">{toolEvents.length}</div>
          <div className="mt-1 text-[11px] text-zinc-500">Local & Sandboxed</div>
        </div>

        {/* Event Stream */}
        <div
          onClick={() => onSelectView("events")}
          className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-amber-500/30 hover:bg-zinc-900/60"
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Events</span>
            <Activity className="h-4 w-4 text-amber-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white flex items-baseline gap-2">
            <span>{eventCount}</span>
            {(telemetry?.eventsPerSecond ?? 0) > 0 && (
              <span className="text-xs font-normal text-emerald-400 font-mono">
                {telemetry?.eventsPerSecond} ev/s
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            {telemetry?.deduplicatedCount ? `${telemetry.deduplicatedCount} deduped • ` : ""}Traced Operations
          </div>
        </div>

        {/* MCP Connectors */}
        <div
          onClick={() => onSelectView("tools")}
          className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-950/60 p-4 transition-all hover:border-purple-500/30 hover:bg-zinc-900/60"
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">MCP Roster</span>
            <Server className="h-4 w-4 text-purple-400 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {mcpConnections.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">Servers Connected</div>
        </div>

        {/* LLM Cost */}
        <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-4">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Budget Consumed</span>
            <DollarSign className="h-4 w-4 text-zinc-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">{cost}</div>
          <div className="mt-1 text-[11px] text-zinc-500 font-mono">{tokens} tokens</div>
        </div>
      </div>

      {/* Connection & Transport Telemetry Panel (Gate UI-03) */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Connection & Transport Telemetry</h3>
            <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-300">
              GATE UI-03 SPEC
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-zinc-500">Transport:</span>
            <span className="text-cyan-300 font-semibold uppercase">{telemetry?.transportMode || "realtime"}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono text-xs">
          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Connection State</span>
            <div className="mt-1 flex items-center gap-1.5 font-bold text-white">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  connState === "CONNECTED"
                    ? "bg-emerald-400 animate-pulse"
                    : connState === "CONNECTING"
                    ? "bg-cyan-400 animate-ping"
                    : connState === "RECONNECTING"
                    ? "bg-amber-400 animate-bounce"
                    : connState === "ERROR"
                    ? "bg-rose-500"
                    : "bg-zinc-500"
                )}
              />
              <span>{connState}</span>
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Last Sync</span>
            <div className="mt-1 text-zinc-200 font-semibold">
              {telemetry?.lastHeartbeat ? new Date(telemetry.lastHeartbeat).toLocaleTimeString() : "N/A"}
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Reconnect Count</span>
            <div className="mt-1 text-zinc-200 font-semibold">
              {telemetry?.reconnectAttempts ?? 0}
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Events Received</span>
            <div className="mt-1 text-white font-semibold">
              {telemetry?.totalEventsReceived ?? eventCount}
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Deduplicated</span>
            <div className="mt-1 text-cyan-300 font-semibold">
              {telemetry?.deduplicatedCount ?? 0}
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">System Errors</span>
            <div
              className={cn(
                "mt-1 font-semibold",
                (telemetry?.errorCount ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"
              )}
            >
              {telemetry?.errorCount ?? 0} errors
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Target Details & Recent Events */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Target Scope & Findings Summary */}
        <div className="space-y-6 lg:col-span-2">
          {/* Target Profile Card */}
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">Active Target Scope</h3>
              </div>
              <button
                type="button"
                onClick={() => onSelectView("targets")}
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
              >
                <span>Scope Details</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
                <div className="text-[11px] font-mono text-zinc-500">Target URI / Resource</div>
                <div className="mt-1 text-sm font-mono font-medium text-white truncate">
                  {summary.targets?.[0] || "Local Project Environment"}
                </div>
              </div>

              <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
                <div className="text-[11px] font-mono text-zinc-500">Scan Mode & Depth</div>
                <div className="mt-1 text-sm font-medium text-emerald-400 capitalize">
                  {summary.scanMode || "Quick Scan"}
                </div>
              </div>
            </div>

            {/* Severity Distribution Bar */}
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">Vulnerability Distribution</span>
                <span className="text-zinc-300 font-semibold">{vulnerabilities.length} Total</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                {counts.critical > 0 && (
                  <div
                    style={{ width: `${(counts.critical / Math.max(1, vulnerabilities.length)) * 100}%` }}
                    className="bg-rose-500 transition-all"
                    title={`Critical: ${counts.critical}`}
                  />
                )}
                {counts.high > 0 && (
                  <div
                    style={{ width: `${(counts.high / Math.max(1, vulnerabilities.length)) * 100}%` }}
                    className="bg-orange-500 transition-all"
                    title={`High: ${counts.high}`}
                  />
                )}
                {counts.medium > 0 && (
                  <div
                    style={{ width: `${(counts.medium / Math.max(1, vulnerabilities.length)) * 100}%` }}
                    className="bg-amber-500 transition-all"
                    title={`Medium: ${counts.medium}`}
                  />
                )}
                {counts.low > 0 && (
                  <div
                    style={{ width: `${(counts.low / Math.max(1, vulnerabilities.length)) * 100}%` }}
                    className="bg-blue-500 transition-all"
                    title={`Low: ${counts.low}`}
                  />
                )}
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-1">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> {counts.critical} Critical
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-orange-500" /> {counts.high} High
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> {counts.medium} Medium
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> {counts.low} Low
                </span>
              </div>
            </div>
          </div>

          {/* Top Vulnerabilities List */}
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-white">Highlighted Findings</h3>
              </div>
              <button
                type="button"
                onClick={() => onSelectView("findings")}
                className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 font-medium"
              >
                <span>All Findings</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            {vulnerabilities.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">
                No vulnerabilities reported in this session yet.
              </div>
            ) : (
              <div className="mt-3 divide-y divide-white/5">
                {vulnerabilities.slice(0, 4).map((vuln) => (
                  <div
                    key={vuln.id}
                    onClick={() => {
                      handleSelectFinding(vuln.id);
                      onSelectView("findings");
                    }}
                    className="flex cursor-pointer items-center justify-between py-3 hover:bg-white/[0.02] px-2 rounded-md transition-colors"
                  >
                    <div className="space-y-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase",
                            vuln.severity === "critical" && "bg-rose-500/20 text-rose-300 border border-rose-500/30",
                            vuln.severity === "high" && "bg-orange-500/20 text-orange-300 border border-orange-500/30",
                            vuln.severity === "medium" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                            vuln.severity === "low" && "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          )}
                        >
                          {vuln.severity}
                        </span>
                        <span className="text-xs font-medium text-white truncate">
                          {vuln.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 line-clamp-1">
                        {vuln.description}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-zinc-500 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Live Event Stream Ticker & Quick Controls */}
        <div className="space-y-6">
          {/* Live Activity Ticker */}
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Live Activity Feed</h3>
              </div>
              <button
                type="button"
                onClick={() => onSelectView("events")}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 font-medium"
              >
                <span>Live Feed</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {recentEvents.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-500">
                  Awaiting operational events...
                </div>
              ) : (
                recentEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-white/5 bg-zinc-900/50 p-2.5 text-xs font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between text-zinc-400">
                      <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-zinc-300">
                        {ev.type}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-200 truncate">
                      {ev.type === "tool"
                        ? String((ev.data as Record<string, unknown>)?.tool_name || "tool_call")
                        : String((ev.data as Record<string, unknown>)?.content || "chat_message")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Hub Navigation Cards */}
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
              Control Center Hub
            </h3>

            <div className="grid grid-cols-2 gap-2 text-xs font-medium">
              <button
                type="button"
                onClick={() => onSelectView("sessions")}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 p-2.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <Clock className="h-4 w-4 text-blue-400" />
                <span>Sessions</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView("scans")}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 p-2.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <Compass className="h-4 w-4 text-emerald-400" />
                <span>Scans</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView("tools")}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 p-2.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <Wrench className="h-4 w-4 text-purple-400" />
                <span>Tools</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectView("logs")}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-zinc-900/80 p-2.5 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <Terminal className="h-4 w-4 text-amber-400" />
                <span>Logs</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
