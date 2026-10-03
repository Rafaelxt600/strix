import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  Code,
  ExternalLink,
  Flame,
  Globe,
  Radio,
  Search,
  Server,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import type { LoadedRun, McpConnectionStatus } from "@/data/serverSource";
import { STRIX_CATALOG_TOOLS, type StrixToolInfo } from "@/types/control-center";
import { cn } from "@/lib/utils";

interface ToolsViewProps {
  run: LoadedRun | null;
  mcpConnections: McpConnectionStatus[];
  mcpInUse?: Set<string>;
}

export function ToolsView({ run, mcpConnections, mcpInUse }: ToolsViewProps) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const toolEvents = run?.transcript.events.filter((e) => e.type === "tool") || [];

  const filteredTools = STRIX_CATALOG_TOOLS.filter((t) => {
    const matchesFilter = filter === "all" || t.category === filter;
    const matchesSearch =
      search.trim() === "" ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.binary.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <Wrench className="h-5 w-5 text-purple-400" />
            <span>Tools & MCP Connectors Hub</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Catalog of autonomous pentesting tools, Go binaries, and active Model Context Protocol (MCP) servers.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search tools or binaries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 rounded-lg border border-white/10 bg-zinc-900/80 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-purple-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* MCP Connection Roster (Live from /api/run) */}
      <div className="rounded-xl border border-purple-500/30 bg-gradient-to-r from-zinc-950 via-purple-950/10 to-zinc-950 p-5 shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Active MCP Connections ({mcpConnections.length})</h3>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">
            Model Context Protocol • Strix Engine
          </span>
        </div>

        {mcpConnections.length === 0 ? (
          <div className="py-4 text-xs text-zinc-400">
            No external MCP servers attached in this session. Default native and Go toolsets are active.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mcpConnections.map((mcp) => (
              <div
                key={mcp.name}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-900/60 p-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <span>{mcp.name}</span>
                    {mcp.provider && (
                      <span className="text-[10px] text-zinc-500 font-mono">({mcp.provider})</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    {mcp.toolCount} tool{mcp.toolCount !== 1 ? "s" : ""} registered
                  </div>
                </div>

                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-mono uppercase font-semibold",
                    mcp.dead
                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                      : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  )}
                >
                  {mcp.dead ? "DISCONNECTED" : "ONLINE"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Strix Core Tool Catalog */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Strix Core & Go Tools Catalog</h3>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1 text-[11px]">
            {["all", "scanner", "recon", "fuzzing", "traffic", "code_analysis", "interface"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={cn(
                  "rounded-md px-2 py-1 capitalize transition-colors font-mono",
                  filter === cat ? "bg-white/15 text-white font-medium" : "text-zinc-400 hover:bg-white/5"
                )}
              >
                {cat.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTools.map((tool) => (
            <div
              key={tool.id}
              className="flex flex-col justify-between rounded-xl border border-white/5 bg-zinc-900/40 p-4 transition-all hover:border-white/15 hover:bg-zinc-900/70"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{tool.name}</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.2 text-[10px] font-mono text-emerald-400 border border-emerald-500/20">
                      GO BINARY
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-zinc-500">{tool.category}</span>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed">{tool.description}</p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-[11px] font-mono text-zinc-500">
                <span>binary: <strong className="text-zinc-300 font-normal">{tool.binary}</strong></span>
                <span>by {tool.author}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Tool Execution Trace */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">
              Tool Activity Trace in this Session ({toolEvents.length})
            </h3>
          </div>
          <span className="text-xs font-mono text-zinc-500">From Transcript</span>
        </div>

        {toolEvents.length === 0 ? (
          <div className="py-6 text-center text-xs text-zinc-500 font-mono">
            No tool executions captured in active transcript.
          </div>
        ) : (
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto scrollbar-thin">
            {toolEvents.slice(-20).reverse().map((ev) => {
              const data = (ev.data as Record<string, unknown>) || {};
              const toolName = String(data.tool_name || "tool_call");
              const toolArgs = data.tool_args ? JSON.stringify(data.tool_args) : "{}";
              return (
                <div key={ev.id} className="py-2.5 px-2 hover:bg-white/[0.02] text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="text-cyan-400 font-bold">{toolName}</span>
                    <span className="text-[10px] text-zinc-500">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate max-w-full font-mono bg-black/40 p-1.5 rounded border border-white/5">
                    {toolArgs}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
