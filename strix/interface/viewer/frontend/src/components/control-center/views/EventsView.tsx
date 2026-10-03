import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Filter,
  Layers,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import type { LoadedRun, TranscriptEvent } from "@/data/serverSource";
import type { RealtimeTelemetry } from "@/types/control-center";
import { cn } from "@/lib/utils";

interface EventsViewProps {
  run: LoadedRun | null;
  telemetry?: RealtimeTelemetry;
  isPaused?: boolean;
  bufferedCountWhilePaused?: number;
  onPause?: () => void;
  onResume?: () => void;
}

export function EventsView({
  run,
  telemetry,
  isPaused: externalIsPaused,
  bufferedCountWhilePaused = 0,
  onPause,
  onResume,
}: EventsViewProps) {
  const [filterType, setFilterType] = useState<"all" | "tool" | "chat">("all");
  const [search, setSearch] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [localIsPaused, setLocalIsPaused] = useState<boolean>(false);
  const [clearedBeforeTimestamp, setClearedBeforeTimestamp] = useState<number | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isPaused = externalIsPaused ?? localIsPaused;
  const togglePause = () => {
    if (isPaused) {
      if (onResume) onResume();
      else setLocalIsPaused(false);
    } else {
      if (onPause) onPause();
      else setLocalIsPaused(true);
    }
  };

  const handleCopyJson = (id: string, obj: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const events = run?.transcript.events || [];
  const agents = run?.transcript.agents || [];

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Clear view filter (non-destructive)
      if (clearedBeforeTimestamp && new Date(ev.timestamp).getTime() <= clearedBeforeTimestamp) {
        return false;
      }

      // Type filter
      if (filterType !== "all" && ev.type !== filterType) return false;

      // Agent filter
      if (selectedAgentId !== "all" && ev.agent_id !== selectedAgentId) return false;

      // Search filter
      if (search.trim() !== "") {
        const query = search.toLowerCase();
        const dataStr = JSON.stringify(ev.data).toLowerCase();
        const idMatches = ev.id.toLowerCase().includes(query);
        return idMatches || dataStr.includes(query);
      }

      return true;
    });
  }, [events, filterType, selectedAgentId, search, clearedBeforeTimestamp]);

  // Auto-scroll effect when new events arrive
  useEffect(() => {
    if (autoScroll && !isPaused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredEvents, autoScroll, isPaused]);

  const handleClearView = () => {
    setClearedBeforeTimestamp(Date.now());
  };

  const handleResetClear = () => {
    setClearedBeforeTimestamp(null);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem-1.75rem)] flex-col space-y-4 p-6 overflow-hidden">
      {/* Header and Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <Activity className="h-5 w-5 text-amber-400" />
            <span>Realtime Operation Event Stream</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Low-level trace stream of agent decisions, tool execution payloads, and coordinator broadcasts.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {telemetry && (
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-zinc-400 mr-2">
              <span className="flex items-center gap-1 rounded bg-zinc-900 border border-white/10 px-2 py-1 text-emerald-400">
                <Zap className="h-3 w-3" />
                <span>{telemetry.eventsPerSecond} ev/s</span>
              </span>
              {telemetry.deduplicatedCount > 0 && (
                <span className="rounded bg-zinc-900 border border-white/10 px-2 py-1 text-zinc-400">
                  {telemetry.deduplicatedCount} deduped
                </span>
              )}
            </div>
          )}

          {clearedBeforeTimestamp && (
            <button
              type="button"
              onClick={handleResetClear}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Restore View</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClearView}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            title="Clear view buffer without modifying stored session"
          >
            <Trash2 className="h-3 w-3 text-zinc-400" />
            <span>Clear View</span>
          </button>

          <button
            type="button"
            onClick={togglePause}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              isPaused
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            )}
          >
            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            <span>{isPaused ? "Resume Feed" : "Pause Feed"}</span>
          </button>

          <button
            type="button"
            onClick={() => setAutoScroll((a) => !a)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              autoScroll
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            )}
          >
            <ArrowDown className="h-3 w-3" />
            <span>Auto-Scroll: {autoScroll ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* Pause Notification Banner */}
      {isPaused && (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300 shrink-0">
          <div className="flex items-center gap-2">
            <Pause className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Stream display paused for inspection.</strong> Ingestion continues in background
              {bufferedCountWhilePaused > 0 && ` (${bufferedCountWhilePaused} new events buffered)`}.
            </span>
          </div>
          <button
            type="button"
            onClick={togglePause}
            className="rounded bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            Resume Live Feed
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950 p-2 text-xs shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type Pill */}
          <div className="flex rounded-md border border-white/10 bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                filterType === "all" ? "bg-white/15 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              All Events ({events.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("tool")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 transition-colors",
                filterType === "tool" ? "bg-white/15 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Wrench className="h-3 w-3 text-emerald-400" />
              <span>Tools</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterType("chat")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 transition-colors",
                filterType === "chat" ? "bg-white/15 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <MessageSquare className="h-3 w-3 text-cyan-400" />
              <span>Chat & Comms</span>
            </button>
          </div>

          {/* Agent Filter Dropdown */}
          {agents.length > 0 && (
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="h-7 rounded-md border border-white/10 bg-zinc-900 px-2 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">All Agents ({agents.length})</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.id.slice(0, 8)})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search payload content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 rounded-md border border-white/10 bg-zinc-900 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {/* Terminal Event Stream Body */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black p-4 font-mono text-xs text-zinc-300 scrollbar-thin space-y-2 select-text"
      >
        {filteredEvents.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-zinc-500 text-center">
            <Terminal className="h-6 w-6 mb-2 text-zinc-600" />
            <p>No events in stream matching selected filter.</p>
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const isExpanded = expandedEventId === ev.id;
            const data = (ev.data as Record<string, unknown>) || {};
            const isTool = ev.type === "tool";
            const agentName = agents.find((a) => a.id === ev.agent_id)?.name || ev.agent_id.slice(0, 8);

            return (
              <div
                key={ev.id}
                className={cn(
                  "rounded-lg border p-2.5 transition-colors",
                  isTool
                    ? "border-emerald-500/15 bg-emerald-950/10 hover:border-emerald-500/30"
                    : "border-cyan-500/15 bg-cyan-950/10 hover:border-cyan-500/30"
                )}
              >
                <div
                  onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
                  className="flex cursor-pointer items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-500 shrink-0">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>

                    <span
                      className={cn(
                        "rounded px-1.5 py-0.2 text-[10px] font-bold uppercase shrink-0",
                        isTool
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      )}
                    >
                      {ev.type}
                    </span>

                    <span className="rounded bg-white/5 px-1.5 py-0.2 text-[10px] text-zinc-400 shrink-0">
                      agent:{agentName}
                    </span>

                    <span className="text-zinc-200 truncate font-semibold">
                      {isTool
                        ? String(data.tool_name || "tool_call")
                        : String(data.content || "message")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-zinc-500 shrink-0">
                    <span className="text-[10px]">JSON</span>
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </div>
                </div>

                {/* Expanded Payload Viewer */}
                {isExpanded && (
                  <div className="mt-2.5 rounded bg-zinc-950 p-3 text-[11px] border border-white/10 text-zinc-300 relative group">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5 text-[10px] text-zinc-500">
                      <span>Event ID: {ev.id}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyJson(ev.id, ev);
                        }}
                        className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded px-2 py-0.5"
                      >
                        {copiedId === ev.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy JSON</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-all overflow-x-auto max-h-96">
                      {JSON.stringify(ev, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
