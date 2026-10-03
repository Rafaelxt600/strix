import React from "react";
import {
  Activity,
  Bot,
  Cpu,
  Layers,
  Radio,
  Server,
  Shield,
  ShieldAlert,
} from "lucide-react";
import type { LoadedRun, McpConnectionStatus } from "@/data/serverSource";
import { severityCounts } from "@/lib/local-run-parser";

interface StatusBarProps {
  run: LoadedRun | null;
  mcpConnections: McpConnectionStatus[];
  pollingMs: number;
}

export function StatusBar({ run, mcpConnections, pollingMs }: StatusBarProps) {
  const isFinished = run?.finished ?? false;
  const agentCount = run?.transcript.agents.length ?? 0;
  const eventCount = run?.transcript.events.length ?? 0;
  const counts = run ? severityCounts(run.vulnerabilities) : { critical: 0, high: 0, medium: 0, low: 0 };
  const mcpAlive = mcpConnections.filter((m) => !m.dead).length;

  return (
    <footer className="sticky bottom-0 z-30 flex h-7 w-full items-center justify-between border-t border-white/10 bg-black/95 px-3 text-[11px] font-mono text-zinc-400 backdrop-blur-md">
      {/* Left: Operational status and Counts */}
      <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`h-2 w-2 rounded-full ${
              !run ? "bg-zinc-600" : isFinished ? "bg-emerald-500" : "bg-cyan-400 animate-pulse"
            }`}
          />
          <span className="text-zinc-300 font-medium">
            {!run ? "STANDBY" : isFinished ? "STATUS: FINISHED" : "STATUS: SCANNING"}
          </span>
        </div>

        <span className="text-zinc-600 hidden sm:inline">•</span>

        <div className="flex items-center gap-1.5 shrink-0">
          <Bot className="h-3 w-3 text-cyan-400" />
          <span>Agents:</span>
          <span className="text-zinc-200 font-semibold">{agentCount}</span>
        </div>

        <span className="text-zinc-600 hidden sm:inline">•</span>

        <div className="flex items-center gap-1.5 shrink-0">
          <Activity className="h-3 w-3 text-amber-400" />
          <span>Events:</span>
          <span className="text-zinc-200 font-semibold">{eventCount}</span>
        </div>

        <span className="text-zinc-600 hidden md:inline">•</span>

        {/* Severity pill in status bar */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <ShieldAlert className="h-3 w-3 text-zinc-400" />
          <span>Findings:</span>
          <span className="text-rose-400 font-semibold">{counts.critical}C</span>
          <span className="text-orange-400 font-semibold">{counts.high}H</span>
          <span className="text-amber-400 font-semibold">{counts.medium}M</span>
          <span className="text-blue-400 font-semibold">{counts.low}L</span>
        </div>
      </div>

      {/* Right: Runtime environment & Telemetry notice */}
      <div className="hidden lg:flex items-center gap-4 shrink-0 text-zinc-500">
        <div className="flex items-center gap-1.5">
          <Server className="h-3 w-3 text-emerald-400/80" />
          <span>MCP: {mcpAlive > 0 ? `${mcpAlive} Online` : "Disabled"}</span>
        </div>

        <span className="text-zinc-700">•</span>

        <div className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-zinc-400" />
          <span>Engine: Python 3.12 (Local)</span>
        </div>

        <span className="text-zinc-700">•</span>

        <div className="flex items-center gap-1.5">
          <Shield className="h-3 w-3 text-emerald-400" />
          <span className="text-zinc-400">100% Private (No Cloud Leak)</span>
        </div>
      </div>
    </footer>
  );
}
