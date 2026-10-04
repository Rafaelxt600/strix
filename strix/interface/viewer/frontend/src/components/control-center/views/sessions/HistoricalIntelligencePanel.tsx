import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Globe,
  Layers,
  Search,
  Shield,
  ShieldAlert,
  Target,
  Terminal,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react";
import type { RunListEntry } from "@/data/serverSource";
import type { ControlCenterView } from "@/types/control-center";
import {
  computeGlobalMetrics,
  computeHistoricalTargets,
} from "@/lib/historical-intelligence";
import { maskSecrets } from "@/lib/security";
import { cn } from "@/lib/utils";

interface HistoricalIntelligencePanelProps {
  runs: RunListEntry[];
  onSelectRun: (runName: string) => void;
  onSelectView?: (view: ControlCenterView) => void;
}

export function HistoricalIntelligencePanel({
  runs,
  onSelectRun,
  onSelectView,
}: HistoricalIntelligencePanelProps) {
  const [targetSearch, setTargetSearch] = useState("");

  const metrics = useMemo(() => computeGlobalMetrics(runs), [runs]);
  const historicalTargets = useMemo(() => computeHistoricalTargets(runs), [runs]);

  const filteredTargets = useMemo(() => {
    if (!targetSearch.trim()) return historicalTargets;
    const q = targetSearch.toLowerCase();
    return historicalTargets.filter((t) => t.target.toLowerCase().includes(q));
  }, [historicalTargets, targetSearch]);

  // Aggregate agent history across runs
  const agentHistory = useMemo(() => {
    const map = new Map<string, { name: string; appearances: number }>();
    runs.forEach((r) => {
      (r.agent_names || []).forEach((agent) => {
        const item = map.get(agent) || { name: agent, appearances: 0 };
        item.appearances += 1;
        map.set(agent, item);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.appearances - a.appearances);
  }, [runs]);

  const completionRate =
    metrics.totalRuns > 0 ? ((metrics.completedRuns / metrics.totalRuns) * 100).toFixed(0) : "0";

  return (
    <div className="space-y-6">
      {/* Top Global Metrics Overview */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
        <div className="border-b border-white/10 pb-4 mb-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
            <span>Global Operations & Fleet Intelligence</span>
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Aggregated KPIs computed across all {runs.length} historical sessions on this machine.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono">
          {/* Total Runs */}
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-1">
            <div className="text-[10px] text-zinc-400 uppercase">Total Sessions</div>
            <div className="text-xl font-bold text-white">{metrics.totalRuns}</div>
            <div className="text-[10px] text-emerald-400">
              {metrics.completedRuns} completed ({completionRate}%)
            </div>
          </div>

          {/* Unique Targets */}
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-1">
            <div className="text-[10px] text-zinc-400 uppercase">Unique Targets</div>
            <div className="text-xl font-bold text-cyan-300">{metrics.uniqueTargets}</div>
            <div className="text-[10px] text-zinc-500">Asset footprint</div>
          </div>

          {/* Total Findings */}
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-1">
            <div className="text-[10px] text-zinc-400 uppercase">Total Findings</div>
            <div className="text-xl font-bold text-amber-400">{metrics.totalFindings}</div>
            <div className="text-[10px] text-zinc-500">Discovered vulnerabilities</div>
          </div>

          {/* Criticals Found */}
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-1">
            <div className="text-[10px] text-zinc-400 uppercase">Critical Severity</div>
            <div className="text-xl font-bold text-rose-400">
              {metrics.criticalFindings}
            </div>
            <div className="text-[10px] text-rose-300/80">Immediate attention</div>
          </div>

          {/* Unique Agents */}
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-1">
            <div className="text-[10px] text-zinc-400 uppercase">Agent Nodes</div>
            <div className="text-xl font-bold text-purple-400">{metrics.uniqueAgents}</div>
            <div className="text-[10px] text-purple-300/80">Autonomous units</div>
          </div>

          {/* Total Reports */}
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3 space-y-1">
            <div className="text-[10px] text-zinc-400 uppercase">Reports Generated</div>
            <div className="text-xl font-bold text-emerald-400">{metrics.totalReports}</div>
            <div className="text-[10px] text-zinc-500">Audit artifacts</div>
          </div>
        </div>
      </div>

      {/* Target Explorer Section */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 overflow-hidden shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 bg-zinc-900/60 p-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Globe className="h-4 w-4 text-cyan-400" />
              <span>Target Asset Explorer ({historicalTargets.length})</span>
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              Unique attack surfaces assessed, engagement frequencies, and cumulative findings.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search target domain/URL..."
              value={targetSearch}
              onChange={(e) => setTargetSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-white/10 bg-zinc-900 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900/80 text-[11px] uppercase text-zinc-400 border-b border-white/10">
              <tr>
                <th className="px-4 py-3">Target Asset</th>
                <th className="px-3 py-3">Sessions Run</th>
                <th className="px-3 py-3">First Assessed</th>
                <th className="px-3 py-3">Latest Assessment</th>
                <th className="px-3 py-3">Total Findings</th>
                <th className="px-3 py-3">Criticals</th>
                <th className="px-3 py-3">Severity Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-zinc-300">
              {filteredTargets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-xs text-zinc-500">
                    No target assets found matching search criteria.
                  </td>
                </tr>
              ) : (
                filteredTargets.map((t) => {
                  const crit = t.severityCounts?.critical || 0;
                  const high = t.severityCounts?.high || 0;
                  const med = t.severityCounts?.medium || 0;
                  const low = t.severityCounts?.low || 0;

                  return (
                    <tr key={t.target} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <Target className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                          <span className="truncate max-w-sm">{maskSecrets(t.target)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-cyan-400 font-bold">
                        {t.sessions.length} runs
                      </td>
                      <td className="px-3 py-3 text-zinc-400 text-[11px]">
                        {t.firstSeen ? new Date(t.firstSeen).toLocaleDateString() : "N/A"}
                      </td>
                      <td className="px-3 py-3 text-zinc-400 text-[11px]">
                        {t.lastSeen ? new Date(t.lastSeen).toLocaleDateString() : "N/A"}
                      </td>
                      <td className="px-3 py-3 font-bold text-white">{t.totalFindings}</td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "font-bold",
                            crit > 0 ? "text-rose-400" : "text-zinc-500"
                          )}
                        >
                          {crit}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {crit > 0 && <span className="text-rose-400 font-bold">{crit}C</span>}
                          {high > 0 && <span className="text-orange-400 font-bold">{high}H</span>}
                          {med > 0 && <span className="text-amber-400 font-bold">{med}M</span>}
                          {low > 0 && <span className="text-blue-400 font-bold">{low}L</span>}
                          {t.totalFindings === 0 && (
                            <span className="text-zinc-500">None detected</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Fleet Activity */}
      {agentHistory.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-xl font-mono">
          <div className="border-b border-white/10 pb-4 mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Bot className="h-4 w-4 text-purple-400" />
              <span>Agent Fleet Activity & Node Invocations</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Distribution of agent nodes deployed across historical pentesting workflows.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {agentHistory.map((agent) => (
              <div
                key={agent.name}
                className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 flex items-center justify-between"
              >
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">{agent.name}</div>
                  <div className="text-[10px] text-zinc-400">Autonomous Pentest Agent</div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-purple-300">{agent.appearances}</span>
                  <div className="text-[9px] text-zinc-500">runs active</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
