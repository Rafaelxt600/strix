import React from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock,
  Layers,
  Radio,
  Shield,
  ShieldAlert,
  Target,
} from "lucide-react";
import type { ControlCenterView } from "@/types/control-center";
import type { LoadedRun } from "@/data/serverSource";
import { runTitle } from "@/lib/target-utils";
import { cn } from "@/lib/utils";

interface TopBarProps {
  activeView: ControlCenterView;
  onSelectView: (view: ControlCenterView) => void;
  run: LoadedRun | null;
  activeRunName: string | null;
  polling: boolean;
}

export function TopBar({
  activeView,
  onSelectView,
  run,
  activeRunName,
  polling,
}: TopBarProps) {
  const isFinished = run?.finished ?? false;
  const primaryTarget = run?.summary.targets?.[0] ?? null;
  const targetLabel = run ? runTitle(primaryTarget, run.summary.runName || run.summary.runId || "Current run") : "No active scan";
  const agentCount = run?.transcript.agents.length ?? 0;
  const issuesCount = run?.vulnerabilities.length ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full flex-row items-center justify-between border-b border-white/10 bg-black/90 px-4 backdrop-blur-md">
      {/* Left: Branding & Session Pill */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-600 shadow-md shadow-emerald-500/10">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-white">STRIX</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono font-medium tracking-wider text-emerald-400 uppercase">
            Control Center
          </span>
        </div>

        <div className="hidden h-4 w-px bg-white/10 sm:block" />

        {/* Active Session & Target status */}
        <div className="hidden items-center gap-2 sm:flex min-w-0">
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono transition-colors",
              isFinished
                ? "bg-zinc-800/80 text-zinc-300 border border-zinc-700/60"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isFinished ? "bg-zinc-500" : "bg-emerald-400 animate-pulse"
              )}
            />
            <span className="font-medium">
              {isFinished ? "FINISHED" : "LIVE SCAN"}
            </span>
            {activeRunName && (
              <span className="text-zinc-500 truncate max-w-[120px]">
                {activeRunName}
              </span>
            )}
          </div>

          {primaryTarget && (
            <div className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 border border-white/5 truncate max-w-[240px]">
              <Target className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">{targetLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* Center/Right: Quick Navigation Tabs */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => onSelectView("dashboard")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
            activeView === "dashboard" || activeView === "overview"
              ? "bg-white/10 text-white shadow-sm"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectView("agents")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
            activeView === "agents"
              ? "bg-white/10 text-white shadow-sm"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          )}
        >
          <Bot className="h-3.5 w-3.5 text-cyan-400" />
          <span className="hidden md:inline">Agents</span>
          {agentCount > 0 && (
            <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.2 text-[10px] text-cyan-300 font-mono">
              {agentCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectView("findings")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
            activeView === "findings" || activeView === "issues"
              ? "bg-white/10 text-white shadow-sm"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          )}
        >
          <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
          <span className="hidden md:inline">Findings</span>
          {issuesCount > 0 && (
            <span className="rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[10px] text-rose-300 font-mono">
              {issuesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectView("events")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
            activeView === "events"
              ? "bg-white/10 text-white shadow-sm"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          )}
        >
          <Activity className="h-3.5 w-3.5 text-amber-400" />
          <span className="hidden md:inline">Events</span>
        </button>

        {/* Polling / Connection Indicator */}
        <div className="ml-2 flex items-center gap-1.5 rounded-md border border-white/10 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-400 font-mono">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              polling ? "bg-cyan-400 animate-ping" : isFinished ? "bg-zinc-500" : "bg-emerald-400"
            )}
          />
          <span className="hidden lg:inline">
            {isFinished ? "LOCAL DATA" : polling ? "SYNCING" : "CONNECTED"}
          </span>
        </div>
      </div>
    </header>
  );
}
