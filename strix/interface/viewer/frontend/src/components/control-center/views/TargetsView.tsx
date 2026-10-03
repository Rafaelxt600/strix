import React from "react";
import {
  ExternalLink,
  Globe,
  Layers,
  Lock,
  Network,
  Radio,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { LoadedRun } from "@/data/serverSource";
import { severityCounts } from "@/lib/local-run-parser";
import { runTitle } from "@/lib/target-utils";
import { cn } from "@/lib/utils";

interface TargetsViewProps {
  run: LoadedRun | null;
  onSelectFinding?: (findingId: string) => void;
  onSelectVulnerability?: (findingId: string) => void;
  onSelectView?: (view: any) => void;
}

export function TargetsView({ run, onSelectFinding, onSelectVulnerability, onSelectView }: TargetsViewProps) {
  if (!run) {
    return (
      <div className="flex h-96 flex-col items-center justify-center p-6 text-center">
        <Target className="h-8 w-8 text-zinc-600 animate-pulse mb-3" />
        <h3 className="text-sm font-semibold text-white">No Target Scope Loaded</h3>
        <p className="text-xs text-zinc-500 mt-1">Initialize or connect to a scan session to inspect targets.</p>
      </div>
    );
  }

  const { summary, raw, vulnerabilities } = run;
  const primaryTarget = summary.targets?.[0] ?? null;
  const targetLabel = runTitle(primaryTarget, summary.runName || summary.runId || "Target Scope");
  const counts = severityCounts(vulnerabilities);

  // Targets info parsed from raw run record if present
  const rawRecord = raw as Record<string, unknown> | null;
  const targetsInfo = (rawRecord?.targets_info as Array<Record<string, unknown>>) || [];
  const primaryTargetDisplay = primaryTarget || "Local Scope";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-white/10 pb-5">
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
          <Target className="h-5 w-5 text-cyan-400" />
          <span>Target Intelligence & Asset Scope</span>
        </h1>
        <p className="text-xs text-zinc-400">
          Inspection of assessed domains, endpoints, repositories, and discovered attack surfaces.
        </p>
      </div>

      {/* Primary Target Scope Card */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{targetLabel}</h2>
              <p className="text-xs font-mono text-zinc-400">Scope Type: Primary Target Resource</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-mono font-medium text-emerald-400 border border-emerald-500/20">
            IN SCOPE
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs font-mono">
          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Target URI</span>
            <div className="mt-1 text-sm font-semibold text-white break-all">{primaryTargetDisplay}</div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Scan Mode</span>
            <div className="mt-1 text-sm font-semibold text-cyan-400 uppercase">{summary.scanMode || "Standard"}</div>
          </div>

          <div className="rounded-lg bg-zinc-900/60 p-3 border border-white/5">
            <span className="text-zinc-500">Vulnerabilities</span>
            <div className="mt-1 text-sm font-semibold text-rose-400">{vulnerabilities.length} Found</div>
          </div>
        </div>

        {/* Safety Disclaimer */}
        <div className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="text-zinc-300 font-semibold">Strict Scope Enforcement:</span> Strix pentesting agents
            operate solely against authorized assets declared in the targets configuration. Out-of-scope endpoints
            are automatically rejected by the engine proxy.
          </div>
        </div>
      </div>

      {/* Associated Findings on this Target */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center justify-between">
          <span>Discovered Vulnerabilities on Target ({vulnerabilities.length})</span>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-rose-400">{counts.critical} Crit</span>
            <span className="text-orange-400">{counts.high} High</span>
            <span className="text-amber-400">{counts.medium} Med</span>
            <span className="text-blue-400">{counts.low} Low</span>
          </div>
        </h3>

        {vulnerabilities.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 font-mono">
            No vulnerabilities identified on this target asset.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {vulnerabilities.map((vuln) => (
              <div
                key={vuln.id}
                onClick={() => {
                  if (onSelectFinding) onSelectFinding(vuln.id);
                  if (onSelectVulnerability) onSelectVulnerability(vuln.id);
                  if (onSelectView) onSelectView("findings");
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
                    <span className="text-xs font-medium text-white truncate">{vuln.title}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 line-clamp-1">{vuln.description}</p>
                </div>
                <span className="text-xs text-cyan-400 hover:underline shrink-0">View Details</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
