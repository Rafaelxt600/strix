import React, { useMemo, useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Layers,
  Network,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Table as TableIcon,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import type { LoadedRun, TranscriptAgent, TranscriptEvent } from "@/data/serverSource";
import type {
  AgentInspectionDetails,
  OfficialAgentStatus,
} from "@/types/control-center";
import AgentGraph from "@/components/live/AgentGraph";
import { buildGraphAgents } from "@/components/live/AgentTranscript";
import AgentDetailModal from "@/components/live/AgentDetailModal";
import { ScanPromptComposer } from "@/components/live/ScanPromptComposer";
import { cn } from "@/lib/utils";

interface AgentsViewProps {
  run: LoadedRun | null;
  canSteer?: boolean;
}

function formatDuration(startStr?: string | null, endStr?: string | null): string {
  if (!startStr) return "N/A";
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return "N/A";
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  if (isNaN(end) || end < start) return "N/A";
  const totalSeconds = Math.floor((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 1) return `${minutes}m ${seconds}s`;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTimeAgo(timestamp?: string | null): string {
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

function resolveOfficialAgentStatus(
  rawStatus: string,
  events: TranscriptEvent[],
  isRunFinished: boolean
): OfficialAgentStatus {
  const norm = (rawStatus || "").toLowerCase();
  const hasErrors = events.some((e) => {
    const d = (e.data as Record<string, unknown>) || {};
    return d.error != null || d.is_error === true || d.status === "failed";
  });

  if (norm === "failed" || norm === "crashed" || norm === "error" || hasErrors) {
    return "ERROR";
  }
  if (norm === "running" || norm === "active") {
    return isRunFinished ? "COMPLETED" : "RUNNING";
  }
  if (norm === "waiting" || norm === "standby") {
    return isRunFinished ? "COMPLETED" : "WAITING";
  }
  if (norm === "paused") {
    return "PAUSED";
  }
  if (norm === "stopped" || norm === "cancelled") {
    return "STOPPED";
  }
  if (norm === "completed" || norm === "finished" || isRunFinished) {
    return "COMPLETED";
  }
  return "RUNNING";
}

export function AgentsView({ run, canSteer = false }: AgentsViewProps) {
  const [activeTab, setActiveTab] = useState<"inspector" | "graph">("inspector");
  const [statusFilter, setStatusFilter] = useState<OfficialAgentStatus | "ALL">("ALL");
  const [search, setSearch] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const agents = run?.transcript.agents || [];
  const events = run?.transcript.events || [];
  const isRunFinished = run?.finished ?? false;

  const graphAgents = useMemo(() => buildGraphAgents(agents, events), [agents, events]);

  // Derive deep inspection details for all agents
  const inspectedAgents = useMemo<AgentInspectionDetails[]>(() => {
    return agents.map((agent) => {
      const agentEvents = events.filter((e) => e.agent_id === agent.id);
      const toolEvents = agentEvents.filter((e) => e.type === "tool");
      const errorEvents = agentEvents.filter((e) => {
        const d = (e.data as Record<string, unknown>) || {};
        return d.error != null || d.is_error === true || d.status === "failed";
      });

      const lastEvent = agentEvents.length > 0 ? agentEvents[agentEvents.length - 1] : null;
      const lastToolEvent = toolEvents.length > 0 ? toolEvents[toolEvents.length - 1] : null;

      // Extract current task from chat or recent thought/tool
      let currentTask = "N/A";
      const recentChat = agentEvents
        .slice()
        .reverse()
        .find((e) => e.type === "chat" && typeof (e.data as Record<string, unknown>)?.content === "string");
      if (recentChat) {
        const rawContent = String((recentChat.data as Record<string, unknown>).content);
        currentTask = rawContent.slice(0, 140) + (rawContent.length > 140 ? "..." : "");
      } else if (lastToolEvent) {
        const tname = (lastToolEvent.data as Record<string, unknown>)?.tool_name;
        if (tname) currentTask = `Executing ${String(tname)}`;
      }

      const activeTool = lastToolEvent
        ? String((lastToolEvent.data as Record<string, unknown>)?.tool_name || "N/A")
        : "N/A";

      const status = resolveOfficialAgentStatus(agent.status, agentEvents, isRunFinished);

      return {
        id: agent.id,
        name: agent.name || "agent-worker",
        status,
        currentTask,
        lastEvent: lastEvent ? `${lastEvent.type} (${new Date(lastEvent.timestamp).toLocaleTimeString()})` : "N/A",
        lastActivity: lastEvent ? formatTimeAgo(lastEvent.timestamp) : "N/A",
        tool: activeTool,
        duration: formatDuration(agent.created_at, lastEvent?.timestamp || agent.updated_at),
        eventCount: agentEvents.length,
        errorCount: errorEvents.length,
        parentId: agent.parent_id,
        childrenCount: agents.filter((a) => a.parent_id === agent.id).length,
      };
    });
  }, [agents, events, isRunFinished]);

  // Filtered agents list
  const filteredAgents = useMemo(() => {
    return inspectedAgents.filter((a) => {
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesId = a.id.toLowerCase().includes(q);
        const matchesTask = a.currentTask.toLowerCase().includes(q);
        const matchesTool = a.tool.toLowerCase().includes(q);
        return matchesName || matchesId || matchesTask || matchesTool;
      }
      return true;
    });
  }, [inspectedAgents, statusFilter, search]);

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const statusCounts = useMemo(() => {
    const counts: Record<OfficialAgentStatus, number> = {
      RUNNING: 0,
      WAITING: 0,
      PAUSED: 0,
      COMPLETED: 0,
      STOPPED: 0,
      ERROR: 0,
    };
    inspectedAgents.forEach((a) => {
      counts[a.status] = (counts[a.status] || 0) + 1;
    });
    return counts;
  }, [inspectedAgents]);

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId) ?? null
    : null;

  const steerable = canSteer && !isRunFinished;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-400" />
            <span>Agent Operations & Inspection</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Realtime orchestration telemetry, agent task inspection, duration breakdown, and topology visualization.
          </p>
        </div>

        {/* View Switcher (Inspector vs Graph) */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-zinc-900/80 p-0.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab("inspector")}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors",
                activeTab === "inspector"
                  ? "bg-white/10 text-white font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>Inspector Table</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("graph")}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors",
                activeTab === "graph"
                  ? "bg-white/10 text-white font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Network className="h-3.5 w-3.5" />
              <span>Topology Graph</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards: Agent Status Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 font-mono text-xs">
        <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-3">
          <div className="text-zinc-400">Total Agents</div>
          <div className="mt-1 text-2xl font-bold text-white">{agents.length}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">Registered nodes</div>
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-3">
          <div className="text-blue-400 font-medium">RUNNING</div>
          <div className="mt-1 text-2xl font-bold text-blue-300">{statusCounts.RUNNING}</div>
          <div className="mt-0.5 text-[10px] text-blue-400/70">Actively executing</div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3">
          <div className="text-amber-400 font-medium">WAITING</div>
          <div className="mt-1 text-2xl font-bold text-amber-300">{statusCounts.WAITING}</div>
          <div className="mt-0.5 text-[10px] text-amber-400/70">Awaiting coordination</div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3">
          <div className="text-emerald-400 font-medium">COMPLETED</div>
          <div className="mt-1 text-2xl font-bold text-emerald-300">{statusCounts.COMPLETED}</div>
          <div className="mt-0.5 text-[10px] text-emerald-400/70">Finished execution</div>
        </div>

        <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/40 p-3">
          <div className="text-zinc-400 font-medium">STOPPED</div>
          <div className="mt-1 text-2xl font-bold text-zinc-300">{statusCounts.STOPPED}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">Terminated early</div>
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3">
          <div className="text-rose-400 font-medium">ERRORS</div>
          <div className="mt-1 text-2xl font-bold text-rose-400">{statusCounts.ERROR}</div>
          <div className="mt-0.5 text-[10px] text-rose-400/70">Faults detected</div>
        </div>
      </div>

      {activeTab === "inspector" ? (
        <div className="space-y-4">
          {/* Controls: Search and Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-950 p-3 text-xs">
            {/* Status Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1 font-mono">
              {(["ALL", "RUNNING", "WAITING", "PAUSED", "COMPLETED", "STOPPED", "ERROR"] as const).map(
                (st) => {
                  const count = st === "ALL" ? agents.length : statusCounts[st as OfficialAgentStatus] || 0;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={cn(
                        "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                        statusFilter === st
                          ? "bg-white/15 text-white font-semibold"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                      )}
                    >
                      {st} ({count})
                    </button>
                  );
                }
              )}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[220px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Search agent name, task, tool..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-md border border-white/10 bg-zinc-900 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>

          {/* Agents Inspector Table */}
          <div className="rounded-xl border border-white/10 bg-zinc-950 overflow-hidden shadow-xl">
            {filteredAgents.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500 font-mono">
                {search ? "No agents match the filter criteria." : "No agents recorded in this session."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-zinc-900/50 text-[11px] text-zinc-400">
                      <th className="py-3 px-4">Agent ID & Name</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Current Task</th>
                      <th className="py-3 px-4">Active Tool</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Last Activity</th>
                      <th className="py-3 px-4 text-right">Events</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredAgents.map((ag) => {
                      const isSelected = selectedAgentId === ag.id;
                      return (
                        <tr
                          key={ag.id}
                          onClick={() => setSelectedAgentId(ag.id)}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-white/[0.04]",
                            isSelected && "bg-white/[0.07] border-l-2 border-l-cyan-400"
                          )}
                        >
                          {/* ID & Name */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white font-sans">{ag.name}</span>
                              <button
                                type="button"
                                onClick={(e) => handleCopyId(ag.id, e)}
                                title="Copy Agent ID"
                                className="text-zinc-500 hover:text-white"
                              >
                                {copiedId === ag.id ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            <div className="text-[10px] text-zinc-500 truncate max-w-[140px]">{ag.id}</div>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-4">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase",
                                ag.status === "RUNNING" && "bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse",
                                ag.status === "WAITING" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                                ag.status === "PAUSED" && "bg-purple-500/20 text-purple-300 border border-purple-500/30",
                                ag.status === "COMPLETED" && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                                ag.status === "STOPPED" && "bg-zinc-800 text-zinc-400 border border-zinc-700",
                                ag.status === "ERROR" && "bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold"
                              )}
                            >
                              {ag.status === "RUNNING" && <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />}
                              {ag.status === "ERROR" && <AlertOctagon className="h-3 w-3" />}
                              <span>{ag.status}</span>
                            </span>
                          </td>

                          {/* Task */}
                          <td className="py-3 px-4 max-w-[240px]">
                            <span className="text-zinc-300 truncate block font-sans" title={ag.currentTask}>
                              {ag.currentTask}
                            </span>
                          </td>

                          {/* Tool */}
                          <td className="py-3 px-4">
                            {ag.tool !== "N/A" ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-mono">
                                <Wrench className="h-3 w-3" />
                                <span>{ag.tool}</span>
                              </span>
                            ) : (
                              <span className="text-zinc-600">N/A</span>
                            )}
                          </td>

                          {/* Duration */}
                          <td className="py-3 px-4 text-zinc-400 font-mono">{ag.duration}</td>

                          {/* Last Activity */}
                          <td className="py-3 px-4 text-zinc-400">{ag.lastActivity}</td>

                          {/* Events */}
                          <td className="py-3 px-4 text-right">
                            <span className="text-zinc-200 font-semibold">{ag.eventCount}</span>
                            {ag.errorCount > 0 && (
                              <span className="ml-1.5 text-rose-400">({ag.errorCount} err)</span>
                            )}
                          </td>

                          {/* Action */}
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedAgentId(ag.id)}
                              className="rounded bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] text-cyan-400 transition-colors"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Topological Graph Tab */
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">Agent Topology Graph</h3>
                <span className="text-xs text-zinc-500 font-mono">({agents.length} nodes)</span>
              </div>
              <p className="text-xs text-zinc-400">Click any node to inspect agent transcript and timeline.</p>
            </div>

            <div className="mt-4 h-[540px] rounded-lg border border-white/5 overflow-hidden bg-black">
              <AgentGraph
                agents={graphAgents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={(id) => setSelectedAgentId(id)}
                eventsLoaded
                eventsEmpty={graphAgents.size === 0}
                scanCompleted={isRunFinished}
              />
            </div>
          </div>
        </div>
      )}

      {/* Live Steering if active in-TUI */}
      {steerable && (
        <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
          <ScanPromptComposer agents={agents} />
        </div>
      )}

      {/* Agent Detail Modal */}
      <AgentDetailModal
        open={selectedAgent !== null}
        agent={selectedAgent}
        events={events}
        steerable={steerable}
        onClose={() => setSelectedAgentId(null)}
      />
    </div>
  );
}
