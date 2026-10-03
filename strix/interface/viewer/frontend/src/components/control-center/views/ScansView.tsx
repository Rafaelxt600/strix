import React, { useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Compass,
  Layers,
  Play,
  RotateCcw,
  Send,
  Shield,
  Sparkles,
  Target,
  Terminal,
} from "lucide-react";
import type { LoadedRun } from "@/data/serverSource";
import { steerAgent } from "@/data/serverSource";
import { cn } from "@/lib/utils";

interface ScansViewProps {
  run: LoadedRun | null;
  canSteer: boolean;
  onSelectView?: (view: any) => void;
}

export function ScansView({ run, canSteer, onSelectView }: ScansViewProps) {
  const [steerMsg, setSteerMsg] = useState("");
  const [steerStatus, setSteerStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  if (!run) {
    return (
      <div className="flex h-96 flex-col items-center justify-center p-6 text-center">
        <Compass className="h-8 w-8 text-zinc-600 animate-pulse mb-3" />
        <h3 className="text-sm font-semibold text-white">No Scan Active</h3>
        <p className="text-xs text-zinc-500 mt-1">Start a scan via CLI to track execution progress.</p>
      </div>
    );
  }

  const { summary, finished, transcript } = run;
  const isRunning = !finished;

  const handleSteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerMsg.trim() || isSending) return;

    const coordinator = transcript.agents.find((a) => !a.parent_id) || transcript.agents[0];
    if (!coordinator) {
      setSteerStatus("No running coordinator agent to steer.");
      return;
    }

    setIsSending(true);
    setSteerStatus("Transmitting steering directive...");
    try {
      const res = await steerAgent(coordinator.id, steerMsg.trim());
      if (res.ok) {
        setSteerStatus("Instruction dispatched to coordinator successfully.");
        setSteerMsg("");
      } else {
        setSteerStatus(`Steering error: ${res.error}`);
      }
    } catch (err) {
      setSteerStatus("Failed to communicate steering directive.");
    } finally {
      setIsSending(false);
    }
  };

  // Phases of an autonomous penetration test
  const phases = [
    {
      name: "1. Scope & Reconnaissance",
      description: "Asset resolution, open port discovery, technology fingerprinting.",
      status: "completed",
    },
    {
      name: "2. Attack Surface Enumeration",
      description: "Crawler spidering, API endpoint parsing, directory fuzzing.",
      status: "completed",
    },
    {
      name: "3. Vulnerability Analysis",
      description: "OWASP Top 10 assessment, authentication flaw validation, injection probing.",
      status: isRunning ? "active" : "completed",
    },
    {
      name: "4. Proof-of-Concept & Exploitation",
      description: "Autonomous verification of suspected vulnerabilities with safe payloads.",
      status: isRunning ? "active" : "completed",
    },
    {
      name: "5. Comprehensive Reporting",
      description: "SARIF 2.1.0 output generation, executive summary, and markdown report compiling.",
      status: finished ? "completed" : "pending",
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-white/10 pb-5">
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
          <Compass className="h-5 w-5 text-emerald-400" />
          <span>Scan Lifecycle & Execution Phases</span>
        </h1>
        <p className="text-xs text-zinc-400">
          Realtime visibility into autonomous pentest phases, execution state, and live steering controls.
        </p>
      </div>

      {/* Scan Profile Card */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-3 w-3 rounded-full",
                isRunning ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              )}
            />
            <span className="text-sm font-mono font-bold uppercase text-white">
              {isRunning ? "EXECUTION IN PROGRESS" : "SCAN COMPLETED"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <span>Mode: <strong className="text-cyan-400 uppercase">{summary.scanMode || "Quick"}</strong></span>
            <span>•</span>
            <span>Target: <strong className="text-zinc-200">{(summary.targets && summary.targets[0]) || "Local Scope"}</strong></span>
          </div>
        </div>

        {/* Phase Timeline */}
        <div className="pt-2">
          <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-3">
            Execution Phase Progression
          </h3>

          <div className="space-y-3">
            {phases.map((phase, idx) => (
              <div
                key={phase.name}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3.5 text-xs transition-colors",
                  phase.status === "completed" && "border-emerald-500/20 bg-emerald-500/5 text-zinc-300",
                  phase.status === "active" && "border-cyan-500/40 bg-cyan-500/10 text-white shadow-sm",
                  phase.status === "pending" && "border-white/5 bg-zinc-900/40 text-zinc-500"
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {phase.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  {phase.status === "active" && <Activity className="h-4 w-4 text-cyan-400 animate-pulse" />}
                  {phase.status === "pending" && <Clock className="h-4 w-4 text-zinc-600" />}
                </div>

                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{phase.name}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.2 text-[10px] font-mono uppercase",
                        phase.status === "completed" && "bg-emerald-500/20 text-emerald-300",
                        phase.status === "active" && "bg-cyan-500/30 text-cyan-200 font-bold",
                        phase.status === "pending" && "bg-zinc-800 text-zinc-500"
                      )}
                    >
                      {phase.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">{phase.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Steering Control Panel (when live in TUI or standalone) */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Autonomous Agent Steering</h3>
          </div>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-mono uppercase",
              canSteer ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-500"
            )}
          >
            {canSteer ? "STEERING ACTIVE" : "READ-ONLY VIEWER"}
          </span>
        </div>

        {canSteer ? (
          <form onSubmit={handleSteer} className="space-y-3">
            <p className="text-xs text-zinc-400">
              Inject priority instructions directly into the active scan's coordinator agent loop without terminating the session:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={steerMsg}
                onChange={(e) => setSteerMsg(e.target.value)}
                placeholder="e.g., Prioritize authentication bypass testing on /api/v1/auth..."
                className="flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:border-cyan-500/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSending || !steerMsg.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Steer</span>
              </button>
            </div>
            {steerStatus && (
              <div className="text-xs font-mono text-cyan-300 bg-cyan-500/10 p-2 rounded border border-cyan-500/20">
                {steerStatus}
              </div>
            )}
          </form>
        ) : (
          <div className="rounded-lg bg-zinc-900/50 p-4 text-xs text-zinc-400 border border-white/5 space-y-1">
            <p className="text-zinc-300 font-medium">Viewer Mode Active:</p>
            <p>
              Direct agent steering is bound to live terminal runs launched with the interactive TUI.
              Completed or historical session records are read-only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
