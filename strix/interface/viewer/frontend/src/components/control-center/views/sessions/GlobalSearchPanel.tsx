import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ExternalLink,
  FileText,
  Filter,
  Layers,
  Loader2,
  Search,
  ShieldAlert,
  Target,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import { fetchRunsSearch } from "@/data/serverSource";
import type { ControlCenterView, GlobalSearchResult, SearchEntityType } from "@/types/control-center";
import { maskSecrets } from "@/lib/security";
import { cn } from "@/lib/utils";

interface GlobalSearchPanelProps {
  onSelectRun: (runName: string) => void;
  onSelectView?: (view: ControlCenterView) => void;
  activeRunName: string | null;
}

const ENTITY_CONFIG: Record<
  SearchEntityType,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  SESSION: {
    label: "Session",
    color: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    icon: Activity,
  },
  FINDING: {
    label: "Finding",
    color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    icon: ShieldAlert,
  },
  TARGET: {
    label: "Target",
    color: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    icon: Target,
  },
  AGENT: {
    label: "Agent",
    color: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    icon: Bot,
  },
  REPORT: {
    label: "Report",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    icon: FileText,
  },
  TOOL: {
    label: "Tool",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: Wrench,
  },
  EVENT: {
    label: "Event",
    color: "bg-zinc-700 text-zinc-300 border-zinc-600",
    icon: Zap,
  },
  EVIDENCE: {
    label: "Evidence",
    color: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    icon: Layers,
  },
};

export function GlobalSearchPanel({
  onSelectRun,
  onSelectView,
  activeRunName,
}: GlobalSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<SearchEntityType | "ALL">("ALL");
  const [error, setError] = useState<string | null>(null);

  // Debounce query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  // Execute search against backend
  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchRunsSearch(debouncedQuery, 80)
      .then((data) => {
        if (isMounted) {
          setResults(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Global search error:", err);
          setError(err instanceof Error ? err.message : "Failed to execute global search");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [debouncedQuery]);

  // Filtered by selected entity chip
  const filteredResults = useMemo(() => {
    if (selectedEntity === "ALL") return results;
    return results.filter((r) => r.type === selectedEntity);
  }, [results, selectedEntity]);

  // Counts by entity type
  const entityCounts = useMemo(() => {
    const counts: Partial<Record<SearchEntityType, number>> = {};
    results.forEach((r) => {
      counts[r.type] = (counts[r.type] || 0) + 1;
    });
    return counts;
  }, [results]);

  const handleResultClick = (res: GlobalSearchResult) => {
    onSelectRun(res.session);
    if (onSelectView) {
      if (res.type === "FINDING") {
        onSelectView("findings");
      } else if (res.type === "REPORT") {
        onSelectView("reports");
      } else if (res.type === "AGENT") {
        onSelectView("agents");
      } else if (res.type === "TARGET") {
        onSelectView("targets");
      } else if (res.type === "TOOL") {
        onSelectView("tools");
      } else if (res.type === "EVENT") {
        onSelectView("events");
      } else {
        onSelectView("sessions");
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Search Header Bar */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4 shadow-xl">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Search className="h-4 w-4 text-cyan-400" />
            <span>Unified Cross-Run Intelligence Search</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Search across all historical sessions, targets, discovered vulnerabilities, agents, tools, reports, and events.
          </p>
        </div>

        {/* Search Input Box */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by vulnerability title, CVE, target URL, agent name, report title, or session ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="h-11 w-full rounded-lg border border-white/15 bg-zinc-900/90 pl-10 pr-24 text-sm text-white placeholder-zinc-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
          />
          <div className="absolute right-3 top-3 flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:text-white bg-white/5"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Entity Filter Chips */}
        {results.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
            <span className="text-zinc-500 text-[11px] flex items-center gap-1">
              <Filter className="h-3 w-3" /> Filter:
            </span>
            <button
              type="button"
              onClick={() => setSelectedEntity("ALL")}
              className={cn(
                "rounded-lg px-2.5 py-1 transition-colors border",
                selectedEntity === "ALL"
                  ? "bg-white/20 text-white border-white/30 font-semibold"
                  : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-zinc-200"
              )}
            >
              All ({results.length})
            </button>

            {(Object.keys(ENTITY_CONFIG) as SearchEntityType[]).map((ent) => {
              const count = entityCounts[ent] || 0;
              if (count === 0) return null;
              const cfg = ENTITY_CONFIG[ent];
              const Icon = cfg.icon;
              return (
                <button
                  key={ent}
                  type="button"
                  onClick={() => setSelectedEntity(ent)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors border",
                    selectedEntity === ent
                      ? `${cfg.color} font-semibold`
                      : "bg-zinc-900 text-zinc-400 border-white/5 hover:text-zinc-200"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span>
                    {cfg.label} ({count})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Results List */}
      <div className="space-y-3">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Search error: {error}</span>
          </div>
        )}

        {!query.trim() && (
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-12 text-center text-zinc-500 font-mono text-xs space-y-3">
            <Search className="h-8 w-8 mx-auto text-zinc-600 mb-2" />
            <p className="text-zinc-400 font-medium text-sm">
              Enter any search keyword to query all sessions and artifacts.
            </p>
            <p className="text-zinc-600 max-w-md mx-auto text-[11px]">
              Supports vulnerability titles, target URLs or domains, CVE tags, report names, agent names, and run identifiers.
            </p>
          </div>
        )}

        {query.trim() && !loading && filteredResults.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-zinc-950 p-12 text-center text-zinc-500 font-mono text-xs">
            <p className="text-zinc-400 font-medium text-sm">
              No matching results found for "{query}".
            </p>
            <p className="text-zinc-600 mt-1">
              Try a different keyword, target substring, or CVE identifier.
            </p>
          </div>
        )}

        {filteredResults.map((res, index) => {
          const cfg = ENTITY_CONFIG[res.type] || {
            label: res.type,
            color: "bg-zinc-800 text-zinc-300 border-zinc-700",
            icon: Search,
          };
          const Icon = cfg.icon;
          const isCurrentRun = activeRunName === res.session;
          const itemKey = `${res.session}-${res.type}-${res.entity}-${index}`;

          return (
            <div
              key={itemKey}
              onClick={() => handleResultClick(res)}
              className={cn(
                "group rounded-xl border border-white/10 bg-zinc-950 p-4 transition-all hover:border-cyan-500/40 hover:bg-zinc-900/60 cursor-pointer shadow-lg",
                isCurrentRun && "border-l-4 border-l-cyan-400"
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-mono font-semibold uppercase border",
                      cfg.color
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{cfg.label}</span>
                  </span>

                  <span className="font-mono text-xs text-zinc-400">
                    Session:{" "}
                    <strong className="text-white group-hover:text-cyan-300 font-semibold">
                      {res.session}
                    </strong>
                  </span>

                  {isCurrentRun && (
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.2 text-[10px] font-mono text-cyan-300">
                      CURRENT
                    </span>
                  )}

                  {res.severity && (
                    <span className="rounded bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.2 text-[10px] font-mono text-rose-300 uppercase font-semibold">
                      {res.severity}
                    </span>
                  )}
                </div>

                {res.target && (
                  <div className="flex items-center gap-1 text-xs font-mono text-zinc-400">
                    <Target className="h-3 w-3 text-cyan-400" />
                    <span className="text-zinc-300 truncate max-w-xs">
                      {maskSecrets(res.target)}
                    </span>
                  </div>
                )}
              </div>

              {/* Title / Primary Identifier */}
              <div className="mt-2 text-sm font-semibold text-white group-hover:text-cyan-300">
                {res.title}
              </div>

              {/* Source or Entity info */}
              {res.source && (
                <div className="mt-2 rounded bg-black/60 p-2.5 font-mono text-xs text-zinc-400 line-clamp-2 border border-white/5">
                  Source: {maskSecrets(res.source)}
                </div>
              )}

              {/* Action Hint */}
              <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-2 border-t border-white/5">
                <span>Entity: {res.entity}</span>
                <span className="text-cyan-400 group-hover:underline flex items-center gap-1">
                  Navigate to session artifact <ExternalLink className="h-3 w-3" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
