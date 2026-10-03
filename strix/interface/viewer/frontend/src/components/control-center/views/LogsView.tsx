import { useState, useMemo, useRef, useEffect } from "react";
import {
  FileText,
  Search,
  Pause,
  Play,
  Trash2,
  Download,
  AlertTriangle,
  Info,
  Bug,
  AlertOctagon,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import type { TranscriptEvent, TranscriptAgent } from "@/data/serverSource";
import type { LogLevel } from "@/types/control-center";

interface LogsViewProps {
  events: TranscriptEvent[];
  agents: TranscriptAgent[];
}

interface NormalizedLog {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  agentName?: string;
  message: string;
  details?: Record<string, unknown>;
  raw: TranscriptEvent;
}

// Regex to detect and mask sensitive tokens, credentials, API keys
const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|token|secret|password|bearer|auth)[=:\s'"]+)([a-zA-Z0-9_\-.~+/]{8,})/gi,
  /(sk-[a-zA-Z0-9]{20,})/gi,
  /(ghp_[a-zA-Z0-9]{20,})/gi,
  /(xox[baprs]-[a-zA-Z0-9]{10,})/gi,
  /(AIza[0-9A-Za-z-_]{35})/gi,
];

function maskSecrets(text: string): string {
  if (!text) return "";
  let masked = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, (match, prefix, secret) => {
      if (secret) {
        return `${prefix}[REDACTED_SECRET_${secret.slice(-4)}]`;
      }
      return "[REDACTED_SECRET]";
    });
  }
  return masked;
}

export function LogsView({ events, agents }: LogsViewProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevel | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [isPaused, setIsPaused] = useState(false);
  const [clearedBeforeIndex, setClearedBeforeIndex] = useState<number>(-1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [maskActive, setMaskActive] = useState<boolean>(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [agents]);

  // Transform events into normalized log entries
  const allLogs = useMemo<NormalizedLog[]>(() => {
    return events.map((ev, index) => {
      const agentName = ev.agent_id ? agentNameMap.get(ev.agent_id) || ev.agent_id : undefined;

      const dataEventType = (typeof ev.data?.event_type === "string" ? ev.data.event_type : ev.type) || "info";
      let level: LogLevel = "INFO";
      if (dataEventType === "error" || (ev.data && (ev.data.error || ev.data.is_error || ev.data.status === "failed"))) {
        level = "ERROR";
      } else if (dataEventType === "warning") {
        level = "WARNING";
      } else if (dataEventType === "thought" || ev.type === "tool") {
        level = "DEBUG";
      } else {
        level = "INFO";
      }

      let message = "";
      if (typeof ev.data?.message === "string") {
        message = ev.data.message;
      } else if (typeof ev.data?.output === "string") {
        message = ev.data.output;
      } else if (typeof ev.data?.thought === "string") {
        message = `[THOUGHT] ${ev.data.thought}`;
      } else if (typeof ev.data?.tool_name === "string") {
        message = `Executing tool: ${ev.data.tool_name}`;
      } else {
        message = `${ev.type}: ${JSON.stringify(ev.data || {})}`;
      }

      return {
        id: `log-${index}-${ev.timestamp}`,
        timestamp: ev.timestamp || new Date().toISOString(),
        level,
        source: ev.agent_id ? "agent" : "system",
        agentName,
        message,
        details: ev.data,
        raw: ev,
      };
    });
  }, [events, agentNameMap]);

  const visibleLogs = useMemo(() => {
    return allLogs
      .filter((_, idx) => idx > clearedBeforeIndex)
      .filter((log) => {
        if (levelFilter !== "ALL" && log.level !== levelFilter) return false;
        if (sourceFilter !== "ALL" && log.source !== sourceFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchMsg = log.message.toLowerCase().includes(q);
          const matchAgent = log.agentName?.toLowerCase().includes(q) ?? false;
          if (!matchMsg && !matchAgent) return false;
        }
        return true;
      });
  }, [allLogs, clearedBeforeIndex, levelFilter, sourceFilter, searchQuery]);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLogs.length, isPaused]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleClearView = () => {
    setClearedBeforeIndex(allLogs.length - 1);
  };

  const handleDownload = () => {
    const lines = visibleLogs.map(
      (l) => `[${l.timestamp}] [${l.level.padEnd(7)}] [${l.source}] ${maskActive ? maskSecrets(l.message) : l.message}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strix-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const levelBadge = (level: LogLevel) => {
    switch (level) {
      case "ERROR":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertOctagon className="w-2.5 h-2.5" /> ERROR
          </span>
        );
      case "WARNING":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-2.5 h-2.5" /> WARN
          </span>
        );
      case "DEBUG":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
            <Bug className="w-2.5 h-2.5" /> DEBUG
          </span>
        );
      case "INFO":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Info className="w-2.5 h-2.5" /> INFO
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Header Controls */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-semibold tracking-tight text-zinc-100">System & Runtime Logs</h2>
          <span className="text-xs font-mono text-zinc-400 ml-2 px-2 py-0.5 bg-zinc-800 rounded">
            {visibleLogs.length} entries {clearedBeforeIndex >= 0 && "(view filtered)"}
          </span>
        </div>

        {/* Controls Toolbar */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Secret Masking Toggle */}
          <button
            onClick={() => setMaskActive(!maskActive)}
            title={maskActive ? "Secret masking enabled (safe)" : "Secret masking disabled (sensitive)"}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              maskActive
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400"
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            {maskActive ? "Secrets Masked" : "Unmasked"}
          </button>

          {/* Pause / Resume */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              isPaused
                ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {isPaused ? "Resume" : "Pause"}
          </button>

          {/* Clear / Restore View (non-destructive) */}
          {clearedBeforeIndex >= 0 && (
            <button
              onClick={() => setClearedBeforeIndex(-1)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
              title="Restore full log stream"
            >
              Restore View
            </button>
          )}
          <button
            onClick={handleClearView}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Clear current view (does not delete server logs)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear View
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            disabled={visibleLogs.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {/* Filter Row */}
      <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/30 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search log messages, agents, errors..."
            className="w-full pl-8 pr-3 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        {/* Level Filters */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 mr-1 text-[11px] font-mono">LEVEL:</span>
          {(["ALL", "DEBUG", "INFO", "WARNING", "ERROR"] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`px-2 py-0.5 rounded font-mono text-[11px] transition-colors ${
                levelFilter === lvl
                  ? "bg-indigo-600 text-white font-semibold"
                  : "bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        {/* Source Filter */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-zinc-500 mr-1 text-[11px] font-mono">SRC:</span>
          {(["ALL", "agent", "system"] as const).map((src) => (
            <button
              key={src}
              onClick={() => setSourceFilter(src)}
              className={`px-2 py-0.5 rounded font-mono text-[11px] transition-colors ${
                sourceFilter === src
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {src.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Log Output Stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1 select-text bg-zinc-950/90"
      >
        {visibleLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 py-16">
            <FileText className="w-10 h-10 mb-2 stroke-[1.2]" />
            <p className="text-sm font-sans font-medium text-zinc-400">No logs found matching filters</p>
            <p className="text-xs text-zinc-500 mt-1">
              {clearedBeforeIndex >= 0 ? "Logs cleared from view. New logs will appear here." : "Waiting for log events..."}
            </p>
          </div>
        ) : (
          visibleLogs.map((log) => {
            const displayMsg = maskActive ? maskSecrets(log.message) : log.message;
            return (
              <div
                key={log.id}
                className="group flex items-start gap-2.5 py-1 px-2 rounded hover:bg-zinc-900/80 border border-transparent hover:border-zinc-800 transition-colors"
              >
                {/* Timestamp */}
                <span className="text-zinc-500 text-[10px] shrink-0 font-mono select-none pt-0.5">
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--:--:--"}
                </span>

                {/* Level */}
                <div className="shrink-0">{levelBadge(log.level)}</div>

                {/* Source / Agent */}
                <span className="text-zinc-400 text-[11px] shrink-0 max-w-[120px] truncate font-sans font-medium bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800/80">
                  {log.agentName || log.source}
                </span>

                {/* Message Body */}
                <div className="flex-1 break-words text-zinc-300 leading-relaxed font-mono">
                  {displayMsg}
                </div>

                {/* Action Button: Copy */}
                <button
                  onClick={() => handleCopy(log.id, displayMsg)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 p-1 rounded transition-opacity"
                  title="Copy log entry"
                >
                  {copiedId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <div className="flex items-center gap-3">
          <span>STREAM: {isPaused ? "PAUSED" : "ACTIVE"}</span>
          <span>FILTER: {levelFilter}</span>
          <span>SECRETS: {maskActive ? "PROTECTED" : "EXPOSED"}</span>
        </div>
        <div>STRIX LOG ENGINE v1.0</div>
      </div>
    </div>
  );
}
