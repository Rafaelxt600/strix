import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUpDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Filter,
  Layers,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  Users,
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
  onViewQueuedEvents?: () => void;
}

export function EventsView({
  run,
  telemetry,
  isPaused: externalIsPaused,
  bufferedCountWhilePaused = 0,
  onPause,
  onResume,
  onViewQueuedEvents,
}: EventsViewProps) {
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [groupByAgent, setGroupByAgent] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "chronological">("chronological");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [localIsPaused, setLocalIsPaused] = useState<boolean>(false);
  const [clearedBeforeTimestamp, setClearedBeforeTimestamp] = useState<number | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);

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

  const handleCopyJson = (id: string, obj: unknown, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const events = run?.transcript.events || [];
  const agents = run?.transcript.agents || [];
  const sessionId = run?.summary.runId || "active-session";

  // Derive distinct sources available
  const availableSources = useMemo(() => {
    const s = new Set<string>();
    events.forEach((e) => {
      const data = (e.data as Record<string, unknown>) || {};
      const src = String(data.source || (e.agent_id ? "agent" : "coordinator"));
      s.add(src);
    });
    return Array.from(s);
  }, [events]);

  // Identify new events timestamp threshold (events in the last 10 seconds)
  const now = Date.now();

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    const list = events.filter((ev) => {
      // Clear view filter (non-destructive)
      if (clearedBeforeTimestamp && new Date(ev.timestamp).getTime() <= clearedBeforeTimestamp) {
        return false;
      }

      // Type filter
      if (filterType !== "all") {
        if (filterType === "tool" && ev.type !== "tool") return false;
        if (filterType === "chat" && ev.type !== "chat") return false;
        if (filterType === "error") {
          const d = (ev.data as Record<string, unknown>) || {};
          const isErr = d.error != null || d.is_error === true || d.status === "failed";
          if (!isErr) return false;
        }
      }

      // Source filter
      if (filterSource !== "all") {
        const d = (ev.data as Record<string, unknown>) || {};
        const src = String(d.source || (ev.agent_id ? "agent" : "coordinator"));
        if (src !== filterSource) return false;
      }

      // Severity filter
      if (filterSeverity !== "all") {
        const d = (ev.data as Record<string, unknown>) || {};
        const sev = String(d.severity || d.level || "").toLowerCase();
        if (sev !== filterSeverity) return false;
      }

      // Agent filter
      if (selectedAgentId !== "all" && ev.agent_id !== selectedAgentId) return false;

      // Search filter
      if (search.trim() !== "") {
        const query = search.toLowerCase();
        const dataStr = JSON.stringify(ev.data).toLowerCase();
        const idMatches = ev.id.toLowerCase().includes(query);
        const agentMatches = ev.agent_id.toLowerCase().includes(query);
        return idMatches || agentMatches || dataStr.includes(query);
      }

      return true;
    });

    // Apply sorting
    if (sortOrder === "newest") {
      return [...list].reverse();
    }
    return list;
  }, [
    events,
    clearedBeforeTimestamp,
    filterType,
    filterSource,
    filterSeverity,
    selectedAgentId,
    search,
    sortOrder,
  ]);

  // Grouped events if groupByAgent is active
  const groupedEvents = useMemo(() => {
    if (!groupByAgent) return null;
    const groups = new Map<string, TranscriptEvent[]>();
    filteredEvents.forEach((ev) => {
      const key = ev.agent_id || "coordinator";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ev);
    });
    return groups;
  }, [filteredEvents, groupByAgent]);

  // Auto-scroll effect when new events arrive
  useEffect(() => {
    if (autoScroll && !isPaused && containerRef.current && sortOrder === "chronological") {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredEvents, autoScroll, isPaused, sortOrder]);

  const handleClearView = () => {
    setClearedBeforeTimestamp(Date.now());
  };

  const handleResetClear = () => {
    setClearedBeforeTimestamp(null);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strix-events-timeline-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem-1.75rem)] flex-col space-y-3 p-6 overflow-hidden">
      {/* Header and Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
              <Activity className="h-5 w-5 text-amber-400" />
              <span>Event Investigation & Timeline</span>
            </h1>

            {/* LIVE / PAUSED Status Indicator */}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-mono font-bold uppercase",
                !isPaused
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  !isPaused ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                )}
              />
              <span>{!isPaused ? "LIVE ●" : "PAUSED"}</span>
            </span>
          </div>

          <p className="text-xs text-zinc-400 mt-0.5">
            Operational trace stream matching canonical contract:{" "}
            <code className="text-cyan-400 font-mono">
              {"{ id, type, source, timestamp, session_id, agent_id, payload, version }"}
            </code>
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          {telemetry && (
            <div className="hidden sm:flex items-center gap-2 text-zinc-400 mr-1">
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
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Restore</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClearView}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Clear view buffer locally without deleting stored session records"
          >
            <Trash2 className="h-3 w-3 text-zinc-400" />
            <span>Clear View</span>
          </button>

          {/* Pause / Resume Button */}
          <button
            type="button"
            onClick={togglePause}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition-colors",
              isPaused
                ? "border-amber-500/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                : "border-white/10 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            )}
          >
            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{isPaused ? "Resume Live" : "Pause Stream"}</span>
          </button>

          {/* Export JSON */}
          <button
            type="button"
            onClick={handleExportJson}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800"
            title="Export filtered timeline to JSON"
          >
            {copiedAll ? <Check className="h-3 w-3 text-emerald-400" /> : <Download className="h-3 w-3" />}
            <span>{copiedAll ? "Exported!" : "Export JSON"}</span>
          </button>
        </div>
      </div>

      {/* EVENT INVESTIGATION BANNER (Active when Paused) */}
      {isPaused && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-zinc-950 to-amber-950/20 p-3.5 text-xs text-amber-200 shrink-0 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
              <Pause className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-white flex items-center gap-2">
                <span>Display Paused for Inspection</span>
                {bufferedCountWhilePaused > 0 && (
                  <span className="rounded bg-amber-500/30 px-2 py-0.2 text-[10px] font-mono text-amber-200">
                    {bufferedCountWhilePaused} new events waiting
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-300/80">
                New incoming events are continuously received and verified in the background buffer.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 font-mono">
            {bufferedCountWhilePaused > 0 && onViewQueuedEvents && (
              <button
                type="button"
                onClick={onViewQueuedEvents}
                className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 font-medium text-amber-200 hover:bg-amber-500/30 transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>View Queued Events ({bufferedCountWhilePaused})</span>
              </button>
            )}

            <button
              type="button"
              onClick={togglePause}
              className="flex items-center gap-1 rounded-lg bg-amber-400 px-3 py-1.5 font-bold text-black hover:bg-amber-300 transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>Resume Live Feed</span>
            </button>
          </div>
        </div>
      )}

      {/* Toolbar: Filters, Grouping & Sort */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-zinc-950 p-2.5 text-xs shrink-0 font-mono">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter */}
          <div className="flex rounded-md border border-white/10 bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className={cn(
                "rounded px-2 py-1 transition-colors",
                filterType === "all" ? "bg-white/15 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              All ({events.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType("tool")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 transition-colors",
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
                "flex items-center gap-1 rounded px-2 py-1 transition-colors",
                filterType === "chat" ? "bg-white/15 text-white font-medium" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <MessageSquare className="h-3 w-3 text-cyan-400" />
              <span>Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterType("error")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 transition-colors",
                filterType === "error" ? "bg-rose-500/20 text-rose-300 font-bold" : "text-zinc-400 hover:text-rose-300"
              )}
            >
              <ShieldAlert className="h-3 w-3 text-rose-400" />
              <span>Errors</span>
            </button>
          </div>

          {/* Source Filter */}
          {availableSources.length > 1 && (
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="h-7 rounded-md border border-white/10 bg-zinc-900 px-2 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">Source: All</option>
              {availableSources.map((src) => (
                <option key={src} value={src}>
                  Source: {src}
                </option>
              ))}
            </select>
          )}

          {/* Agent Filter */}
          {agents.length > 0 && (
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="h-7 rounded-md border border-white/10 bg-zinc-900 px-2 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">Agent: All ({agents.length})</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.id.slice(0, 8)})
                </option>
              ))}
            </select>
          )}

          {/* Group by Agent Toggle */}
          <button
            type="button"
            onClick={() => setGroupByAgent((g) => !g)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 transition-colors",
              groupByAgent
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 font-semibold"
                : "border-white/10 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            )}
            title="Group timeline view by agent"
          >
            <Users className="h-3 w-3" />
            <span>Group by Agent</span>
          </button>

          {/* Temporal Sort Order Toggle */}
          <button
            type="button"
            onClick={() => setSortOrder((s) => (s === "chronological" ? "newest" : "chronological"))}
            className="flex items-center gap-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="Toggle chronological vs newest first"
          >
            <ArrowUpDown className="h-3 w-3 text-cyan-400" />
            <span>{sortOrder === "chronological" ? "Oldest First" : "Newest First"}</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative min-w-[200px]">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search payload & event IDs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-full rounded-md border border-white/10 bg-zinc-900 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {/* Terminal Event Stream Body */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black p-4 font-mono text-xs text-zinc-300 scrollbar-thin space-y-2 select-text shadow-inner"
      >
        {filteredEvents.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-zinc-500 text-center font-mono">
            <Terminal className="h-8 w-8 mb-2 text-zinc-600" />
            <p className="font-semibold text-zinc-400">No events found matching current criteria.</p>
            <p className="text-[11px] text-zinc-600 mt-1">Adjust search or clear filter to display timeline stream.</p>
          </div>
        ) : groupByAgent && groupedEvents ? (
          /* Render grouped by Agent */
          Array.from(groupedEvents.entries()).map(([agentId, agEvents]) => {
            const agentName = agents.find((a) => a.id === agentId)?.name || agentId;
            return (
              <div key={agentId} className="space-y-2 rounded-lg border border-white/5 bg-zinc-950/40 p-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-white/5 text-[11px] font-semibold text-cyan-300">
                  <span className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5" />
                    <span>Agent: {agentName}</span>
                    <span className="text-zinc-500 text-[10px]">({agentId})</span>
                  </span>
                  <span className="text-zinc-500">{agEvents.length} events</span>
                </div>
                <div className="space-y-1.5 pl-2">
                  {agEvents.map((ev) => renderEventCard(ev))}
                </div>
              </div>
            );
          })
        ) : (
          /* Render flat timeline */
          filteredEvents.map((ev) => renderEventCard(ev))
        )}
      </div>
    </div>
  );

  function renderEventCard(ev: TranscriptEvent) {
    const isExpanded = expandedEventId === ev.id;
    const data = (ev.data as Record<string, unknown>) || {};
    const isTool = ev.type === "tool";
    const agentName = agents.find((a) => a.id === ev.agent_id)?.name || ev.agent_id?.slice(0, 8) || "coordinator";

    const isError =
      data.error != null ||
      data.is_error === true ||
      data.status === "failed" ||
      data.event_type === "error";

    // Determine if event is new (under 15s)
    const eventTime = new Date(ev.timestamp).getTime();
    const isNew = !isNaN(eventTime) && now - eventTime < 15000;

    return (
      <div
        key={ev.id}
        className={cn(
          "rounded-lg border p-2.5 transition-colors",
          isError
            ? "border-rose-500/30 bg-rose-950/15 hover:border-rose-500/50"
            : isTool
            ? "border-emerald-500/15 bg-emerald-950/10 hover:border-emerald-500/30"
            : "border-cyan-500/15 bg-cyan-950/10 hover:border-cyan-500/30"
        )}
      >
        <div
          onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
          className="flex cursor-pointer items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Timestamp */}
            <span className="text-zinc-500 shrink-0 text-[11px]">
              {new Date(ev.timestamp).toLocaleTimeString()}
            </span>

            {/* NEW Badge */}
            {isNew && (
              <span className="rounded bg-cyan-500/20 px-1 py-0.2 text-[9px] font-bold text-cyan-300 border border-cyan-500/40 animate-pulse">
                NEW
              </span>
            )}

            {/* Type Badge */}
            <span
              className={cn(
                "rounded px-1.5 py-0.2 text-[10px] font-bold uppercase shrink-0",
                isError
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  : isTool
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
              )}
            >
              {isError ? "error" : ev.type}
            </span>

            {/* Agent Badge */}
            <span className="rounded bg-white/5 px-1.5 py-0.2 text-[10px] text-zinc-400 shrink-0 truncate max-w-[120px]">
              agent:{agentName}
            </span>

            {/* Content summary */}
            <span className="text-zinc-200 truncate font-semibold">
              {isTool
                ? String(data.tool_name || "tool_call")
                : String(data.content || "message")}
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-500 shrink-0">
            <span className="text-[10px] font-mono">v{ev.version ?? 1}</span>
            <span className="text-[10px]">PAYLOAD</span>
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </div>
        </div>

        {/* Expanded Payload Inspector matching Canonical Contract */}
        {isExpanded && (
          <div className="mt-2.5 rounded bg-zinc-950 p-3.5 text-[11px] border border-white/10 text-zinc-300 space-y-3">
            {/* Header info */}
            <div className="flex items-center justify-between pb-2 border-b border-white/5 text-[10px] text-zinc-400">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  <strong>ID:</strong> {ev.id}
                </span>
                <span>
                  <strong>Session:</strong> {sessionId}
                </span>
                <span>
                  <strong>Agent:</strong> {ev.agent_id || "coordinator"}
                </span>
                <span>
                  <strong>Version:</strong> {ev.version ?? 1}
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => handleCopyJson(ev.id, ev, e)}
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

            {/* Formatted Payload */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider">
                PAYLOAD DATA
              </span>
              <pre className="whitespace-pre-wrap break-all overflow-x-auto max-h-96 rounded bg-black/60 p-2.5 border border-white/5 text-zinc-200">
                {JSON.stringify(
                  {
                    id: ev.id,
                    type: ev.type,
                    source: data.source || (ev.agent_id ? "agent" : "coordinator"),
                    timestamp: ev.timestamp,
                    session_id: sessionId,
                    agent_id: ev.agent_id,
                    version: ev.version ?? 1,
                    payload: ev.data,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  }
}
