import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Filter,
  Globe,
  Layers,
  Network,
  Radio,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Target,
  Terminal,
  Wrench,
  Clock,
} from "lucide-react";
import type { Vulnerability, VulnerabilitySeverity, VulnerabilityStatus } from "@/types/issues";
import type { TranscriptAgent, TranscriptEvent } from "@/data/serverSource";
import type {
  ControlCenterView,
  EvidenceCategory,
  EvidenceItem,
  FindingTimelineEvent,
  OfficialFindingStatus,
} from "@/types/control-center";
import { IssueSeveritySummary } from "@/components/IssueSeveritySummary";
import { cn } from "@/lib/utils";
import { maskSecrets } from "@/lib/security";
import {
  correlateAgent,
  correlateTool,
  extractEvidenceList,
  buildFindingTimeline,
  findRelatedEvents,
} from "@/lib/correlation";

interface FindingsViewProps {
  vulnerabilities: Vulnerability[];
  selectedFindingId?: string | null;
  onSelect?: (findingId: string) => void;
  onSelectFinding?: (findingId: string | null) => void;
  finished?: boolean;
  events?: TranscriptEvent[];
  agents?: TranscriptAgent[];
  onSelectAgent?: (id: string) => void;
  onSelectTarget?: (target: string) => void;
  onSelectTool?: (tool: string) => void;
  onSelectView?: (view: ControlCenterView) => void;
}

type FindingTab = "overview" | "evidence" | "timeline" | "events" | "correlations" | "raw";

export function FindingsView({
  vulnerabilities,
  selectedFindingId = null,
  onSelect,
  onSelectFinding,
  finished,
  events = [],
  agents = [],
  onSelectAgent,
  onSelectTarget,
  onSelectTool,
  onSelectView,
}: FindingsViewProps) {
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [targetFilter, setTargetFilter] = useState<string>("ALL");
  const [agentFilter, setAgentFilter] = useState<string>("ALL");
  const [toolFilter, setToolFilter] = useState<string>("ALL");
  const [search, setSearch] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [maskActive, setMaskActive] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<FindingTab>("overview");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [evidenceFilter, setEvidenceFilter] = useState<string>("ALL");
  const [relatedEventCategory, setRelatedEventCategory] = useState<string>("ALL");
  const [rawSearch, setRawSearch] = useState<string>("");

  const handleSelect = useCallback(
    (id: string | null) => {
      if (onSelect && id) onSelect(id);
      if (onSelectFinding) onSelectFinding(id);
    },
    [onSelect, onSelectFinding]
  );

  // Keyboard shortcut: Escape returns to list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedFindingId) {
        handleSelect(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFindingId, handleSelect]);

  const selectedFinding = useMemo(() => {
    if (!selectedFindingId) return null;
    return vulnerabilities.find((v) => v.id === selectedFindingId) || null;
  }, [vulnerabilities, selectedFindingId]);

  // Distinct targets across all vulnerabilities
  const availableTargets = useMemo(() => {
    const set = new Set<string>();
    for (const v of vulnerabilities) {
      if (v.target && v.target.trim()) set.add(v.target.trim());
    }
    return Array.from(set).sort();
  }, [vulnerabilities]);

  // Distinct agents across vulnerabilities or correlation
  const availableAgents = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vulnerabilities) {
      const ag = correlateAgent(v, agents, events);
      if (ag) map.set(ag.id, ag.name);
    }
    return Array.from(map.entries());
  }, [vulnerabilities, agents, events]);

  // Distinct tools across vulnerabilities or correlation
  const availableTools = useMemo(() => {
    const set = new Set<string>();
    for (const v of vulnerabilities) {
      const tool = correlateTool(v, events);
      if (tool) set.add(tool);
    }
    return Array.from(set).sort();
  }, [vulnerabilities, events]);

  // Filtered vulnerabilities list
  const filteredVulnerabilities = useMemo(() => {
    return vulnerabilities.filter((v) => {
      const vSev = (v.severity || "low").toUpperCase();
      const matchesSeverity =
        severityFilter === "ALL" || vSev === severityFilter.toUpperCase();

      const vStatus = (v.status || "open").toUpperCase();
      const matchesStatus =
        statusFilter === "ALL" || vStatus === statusFilter.toUpperCase();

      const matchesTarget =
        targetFilter === "ALL" || (v.target && v.target.trim() === targetFilter);

      const correlatedAg = correlateAgent(v, agents, events);
      const matchesAgent =
        agentFilter === "ALL" || (correlatedAg && correlatedAg.id === agentFilter);

      const correlatedTl = correlateTool(v, events);
      const matchesTool =
        toolFilter === "ALL" || (correlatedTl && correlatedTl === toolFilter);

      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === "" ||
        v.id.toLowerCase().includes(q) ||
        v.title.toLowerCase().includes(q) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        (v.target && v.target.toLowerCase().includes(q)) ||
        (v.cve && v.cve.toLowerCase().includes(q)) ||
        (correlatedAg && correlatedAg.name.toLowerCase().includes(q)) ||
        (correlatedTl && correlatedTl.toLowerCase().includes(q));

      return (
        matchesSeverity &&
        matchesStatus &&
        matchesTarget &&
        matchesAgent &&
        matchesTool &&
        matchesSearch
      );
    });
  }, [
    vulnerabilities,
    severityFilter,
    statusFilter,
    targetFilter,
    agentFilter,
    toolFilter,
    search,
    agents,
    events,
  ]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // --------------------------------------------------------------------------
  // FINDING DETAIL INSPECTOR
  // --------------------------------------------------------------------------
  if (selectedFinding) {
    const f = selectedFinding;
    const safeDesc = maskActive ? maskSecrets(f.description) : f.description || "N/A";
    const safeEvidence = maskActive ? maskSecrets(f.evidence) : f.evidence;
    const safePoc = maskActive ? maskSecrets(f.poc_script_code) : f.poc_script_code;
    const safeRemediation = maskActive ? maskSecrets(f.remediation_steps) : f.remediation_steps;
    const safeAnalysis = maskActive ? maskSecrets(f.technical_analysis) : f.technical_analysis;

    const correlatedAg = correlateAgent(f, agents, events);
    const correlatedTl = correlateTool(f, events);
    const evidenceList = extractEvidenceList(f, events);
    const timeline = buildFindingTimeline(f, events, agents);
    const relatedEvents = findRelatedEvents(f, events);

    const filteredEvidences = evidenceList.filter((item) => {
      if (evidenceFilter === "ALL") return true;
      if (evidenceFilter === "HTTP")
        return item.type === "http_request" || item.type === "http_response";
      if (evidenceFilter === "PAYLOAD") return item.type === "payload";
      if (evidenceFilter === "TOOL") return item.type === "tool_output";
      if (evidenceFilter === "CODE") return item.type === "artifact" || item.type === "file";
      return true;
    });

    const activeEvidence =
      evidenceList.find((e) => e.id === selectedEvidenceId) ||
      (filteredEvidences.length > 0 ? filteredEvidences[0] : null);

    const filteredRelatedEvents = relatedEvents.filter((e) => {
      if (relatedEventCategory === "ALL") return true;
      if (relatedEventCategory === "TOOL") return e.type === "tool";
      if (relatedEventCategory === "AGENT") return e.type === "chat";
      if (relatedEventCategory === "ERROR")
        return Boolean(e.data?.error || e.data?.status === "error");
      return true;
    });

    const rawFindingJson = JSON.stringify(f, null, 2);
    const maskedRawJson = maskActive ? maskSecrets(rawFindingJson) : rawFindingJson;

    return (
      <div className="space-y-6 p-6">
        {/* Top Controls Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-4">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors w-fit"
            aria-label="Back to All Findings"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to All Findings (Esc)</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMaskActive(!maskActive)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-mono border transition-colors",
                maskActive
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-amber-500/10 border-amber-500/30 text-amber-400"
              )}
            >
              {maskActive ? "Secrets Masked" : "Unmasked"}
            </button>

            <button
              type="button"
              onClick={() => handleCopy("finding-id", f.id)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {copiedId === "finding-id" ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400 font-mono">ID Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span className="font-mono">Copy ID: {f.id}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleCopy("finding-json", rawFindingJson)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {copiedId === "finding-json" ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied JSON!</span>
                </>
              ) : (
                <>
                  <Code2 className="h-3 w-3" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Finding Overview Header Card */}
        <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 space-y-5 shadow-2xl">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded px-2.5 py-0.5 text-xs font-mono font-bold uppercase border",
                  f.severity === "critical" && "bg-rose-500/20 text-rose-300 border-rose-500/40",
                  f.severity === "high" && "bg-orange-500/20 text-orange-300 border-orange-500/40",
                  f.severity === "medium" && "bg-amber-500/20 text-amber-300 border-amber-500/40",
                  f.severity === "low" && "bg-blue-500/20 text-blue-300 border-blue-500/40",
                  f.severity === "info" && "bg-zinc-500/20 text-zinc-300 border-zinc-500/40"
                )}
              >
                {f.severity}
              </span>

              <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs font-mono text-emerald-400 font-semibold uppercase">
                {f.status || "CONFIRMED"}
              </span>

              {f.cve && (
                <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-mono text-zinc-300">
                  {f.cve}
                </span>
              )}

              {f.cvss !== null && f.cvss !== undefined && (
                <span className="rounded bg-rose-950/40 border border-rose-500/30 px-2 py-0.5 text-xs font-mono text-rose-300 font-bold">
                  CVSS {f.cvss}
                </span>
              )}

              {f.confidence && (
                <span className="rounded bg-zinc-900 border border-white/10 px-2 py-0.5 text-xs font-mono text-zinc-400">
                  Confidence: {f.confidence}
                </span>
              )}

              <span className="rounded bg-purple-500/10 border border-purple-500/30 px-2 py-0.5 text-xs font-mono text-purple-300">
                {evidenceList.length} {evidenceList.length === 1 ? "Evidence" : "Evidences"}
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {f.title}
            </h1>
          </div>

          {/* Canonical Inspection Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs rounded-lg border border-white/5 bg-zinc-900/60 p-4">
            <div>
              <span className="text-zinc-500 flex items-center gap-1">
                <Target className="h-3 w-3" /> Target
              </span>
              <p
                onClick={() => f.target && onSelectTarget && onSelectTarget(f.target)}
                className={cn(
                  "mt-1 font-medium truncate",
                  f.target ? "text-cyan-300 cursor-pointer hover:underline" : "text-zinc-400"
                )}
                title={f.target || "N/A"}
              >
                {f.target || "N/A"}
              </p>
            </div>

            <div>
              <span className="text-zinc-500 flex items-center gap-1">
                <Bot className="h-3 w-3" /> Responsible Agent
              </span>
              <p
                onClick={() =>
                  correlatedAg && onSelectAgent && onSelectAgent(correlatedAg.id)
                }
                className={cn(
                  "mt-1 font-medium truncate",
                  correlatedAg
                    ? "text-purple-300 cursor-pointer hover:underline"
                    : "text-zinc-400"
                )}
              >
                {correlatedAg ? correlatedAg.name : "Autonomous Agent"}
              </p>
            </div>

            <div>
              <span className="text-zinc-500 flex items-center gap-1">
                <Wrench className="h-3 w-3" /> Detection Tool
              </span>
              <p
                onClick={() =>
                  correlatedTl && onSelectTool && onSelectTool(correlatedTl)
                }
                className={cn(
                  "mt-1 font-medium truncate",
                  correlatedTl ? "text-amber-300 cursor-pointer hover:underline" : "text-zinc-400"
                )}
              >
                {correlatedTl || "N/A"}
              </p>
            </div>

            <div>
              <span className="text-zinc-500 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Discovered
              </span>
              <p className="mt-1 text-zinc-300">
                {f.created_at ? new Date(f.created_at).toLocaleString() : "N/A"}
              </p>
            </div>
          </div>

          {/* Section Navigation Tabs */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pt-2">
            {[
              { id: "overview", label: "Overview & Analysis" },
              { id: "evidence", label: `Evidence Explorer (${evidenceList.length})` },
              { id: "timeline", label: `Timeline (${timeline.length})` },
              { id: "events", label: `Related Events (${relatedEvents.length})` },
              { id: "correlations", label: "Entity Correlations" },
              { id: "raw", label: "Raw Data (JSON)" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as FindingTab)}
                className={cn(
                  "px-3 py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors",
                  activeTab === tab.id
                    ? "border-cyan-400 text-cyan-300"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 1: Overview */}
          {activeTab === "overview" && (
            <div className="space-y-6 pt-2">
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider">
                  Description & Vulnerability Analysis
                </h3>
                <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-4 text-sm text-zinc-300 leading-relaxed font-sans whitespace-pre-wrap">
                  {safeDesc}
                </div>
              </div>

              {f.impact && (
                <div className="space-y-2">
                  <h3 className="text-xs font-mono font-semibold uppercase text-rose-400 tracking-wider">
                    Potential Impact & Exploitation Consequences
                  </h3>
                  <div className="rounded-lg border border-rose-500/20 bg-rose-950/10 p-4 text-sm text-zinc-300 leading-relaxed font-sans whitespace-pre-wrap">
                    {maskActive ? maskSecrets(f.impact) : f.impact}
                  </div>
                </div>
              )}

              {safeRemediation && (
                <div className="space-y-2">
                  <h3 className="text-xs font-mono font-semibold uppercase text-emerald-400 tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Recommended Fix & Remediation</span>
                  </h3>
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-4 text-sm text-zinc-200 leading-relaxed font-sans whitespace-pre-wrap">
                    {safeRemediation}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Evidence Explorer */}
          {activeTab === "evidence" && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {["ALL", "HTTP", "PAYLOAD", "TOOL", "CODE"].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setEvidenceFilter(cat)}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium border transition-colors",
                        evidenceFilter === cat
                          ? "border-purple-500/50 bg-purple-500/10 text-purple-300"
                          : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <span className="text-xs text-zinc-500 font-mono">
                  {filteredEvidences.length} items recorded
                </span>
              </div>

              {filteredEvidences.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/20 p-8 text-center space-y-2">
                  <FileCode className="h-6 w-6 text-zinc-600 mx-auto" />
                  <p className="text-sm text-zinc-400 font-medium">No matching evidence</p>
                  <p className="text-xs text-zinc-500">
                    No technical evidence artifacts recorded under this category.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  {/* Evidence List on Left */}
                  <div className="lg:col-span-4 space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
                    {filteredEvidences.map((ev) => {
                      const isSelected = activeEvidence?.id === ev.id;
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => setSelectedEvidenceId(ev.id)}
                          className={cn(
                            "w-full text-left rounded-lg border p-3 transition-colors flex flex-col gap-1.5",
                            isSelected
                              ? "border-purple-500/50 bg-purple-950/20 text-white"
                              : "border-white/5 bg-zinc-900/40 text-zinc-300 hover:bg-zinc-800/60"
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-xs truncate">
                              {ev.title}
                            </span>
                            <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-mono text-zinc-400 uppercase">
                              {ev.type}
                            </span>
                          </div>
                          <span className="text-[11px] text-zinc-500 font-mono truncate">
                            {ev.source}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Evidence Viewer on Right */}
                  <div className="lg:col-span-8 rounded-lg border border-white/10 bg-black/80 p-4 space-y-4">
                    {activeEvidence ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                          <div>
                            <h4 className="text-sm font-bold text-zinc-200">
                              {activeEvidence.title}
                            </h4>
                            <p className="text-xs text-zinc-500 font-mono mt-0.5">
                              {activeEvidence.id} · Source: {activeEvidence.source}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(
                                "ev-content",
                                maskActive
                                  ? maskSecrets(activeEvidence.content)
                                  : activeEvidence.content
                              )
                            }
                            className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-white/10 hover:bg-zinc-800 transition-colors"
                          >
                            {copiedId === "ev-content" ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy Evidence</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* HTTP Inspector if Request or Response exists */}
                        {(activeEvidence.request || activeEvidence.response) && (
                          <div className="space-y-3 font-mono text-xs">
                            {activeEvidence.request && (
                              <div className="rounded border border-cyan-500/20 bg-cyan-950/10 p-3 space-y-2">
                                <span className="text-cyan-400 font-bold uppercase text-[11px]">
                                  HTTP Request: {activeEvidence.request.method}{" "}
                                  {activeEvidence.request.url}
                                </span>
                                {activeEvidence.request.headers && (
                                  <div className="rounded bg-black/60 p-2.5 border border-white/5 space-y-1 text-zinc-400 text-[11px]">
                                    {Object.entries(activeEvidence.request.headers).map(
                                      ([k, v]) => (
                                        <div key={k} className="truncate">
                                          <span className="text-zinc-500">{k}:</span>{" "}
                                          <span className="text-zinc-300">
                                            {maskActive ? maskSecrets(v) : v}
                                          </span>
                                        </div>
                                      )
                                    )}
                                  </div>
                                )}
                                {activeEvidence.request.body && (
                                  <pre className="rounded bg-black/90 p-2.5 text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-48 text-[11px]">
                                    {maskActive
                                      ? maskSecrets(activeEvidence.request.body)
                                      : activeEvidence.request.body}
                                  </pre>
                                )}
                              </div>
                            )}

                            {activeEvidence.response && (
                              <div className="rounded border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-2">
                                <span className="text-emerald-400 font-bold uppercase text-[11px]">
                                  HTTP Response: Status {activeEvidence.response.statusCode}{" "}
                                  {activeEvidence.response.statusText || ""}
                                </span>
                                {activeEvidence.response.body && (
                                  <pre className="rounded bg-black/90 p-2.5 text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-48 text-[11px]">
                                    {maskActive
                                      ? maskSecrets(activeEvidence.response.body)
                                      : activeEvidence.response.body}
                                  </pre>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* General Evidence Raw Content Block */}
                        <div className="space-y-1">
                          <span className="text-[11px] font-mono uppercase text-zinc-500">
                            Captured Content Payload
                          </span>
                          <pre className="rounded-lg border border-white/5 bg-black/90 p-3 font-mono text-xs text-zinc-300 overflow-x-auto max-h-72 whitespace-pre-wrap">
                            {maskActive
                              ? maskSecrets(activeEvidence.content)
                              : activeEvidence.content}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500 p-8 text-center">
                        Select an evidence artifact from the list to inspect.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Finding Timeline */}
          {activeTab === "timeline" && (
            <div className="space-y-4 pt-2">
              <div className="text-xs font-mono text-zinc-400 flex items-center justify-between pb-1">
                <span>Deterministic Timeline ({timeline.length} Milestones)</span>
                <span className="text-zinc-500">Chronological execution order</span>
              </div>

              {timeline.length === 0 ? (
                <div className="text-xs text-zinc-500 p-6 text-center">
                  No chronological events recorded for this finding.
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:bottom-0 before:left-2.5 before:top-2 before:w-0.5 before:bg-white/10">
                  {timeline.map((item, idx) => (
                    <div key={item.id} className="relative flex flex-col gap-1">
                      <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-zinc-950 bg-cyan-400" />
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-zinc-500">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="font-semibold text-zinc-200">{item.title}</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        {maskActive ? maskSecrets(item.description) : item.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Related Events */}
          {activeTab === "events" && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {["ALL", "TOOL", "AGENT", "ERROR"].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setRelatedEventCategory(cat)}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium border transition-colors",
                        relatedEventCategory === cat
                          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                          : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <span className="text-xs text-zinc-500 font-mono">
                  {filteredRelatedEvents.length} events
                </span>
              </div>

              {filteredRelatedEvents.length === 0 ? (
                <div className="text-xs text-zinc-500 p-8 text-center">
                  No related transcript events correlated to this finding.
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
                  {filteredRelatedEvents.map((ev) => {
                    const msg =
                      typeof ev.data?.message === "string"
                        ? ev.data.message
                        : typeof ev.data?.command === "string"
                          ? ev.data.command
                          : JSON.stringify(ev.data);
                    return (
                      <div
                        key={ev.id}
                        className="rounded-lg border border-white/5 bg-zinc-900/40 p-3 font-mono text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] text-zinc-500">
                          <span>
                            {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : "N/A"}{" "}
                            · Agent: {ev.agent_id}
                          </span>
                          <span className="rounded bg-white/5 px-1.5 py-0.2 uppercase text-[10px]">
                            {ev.type}
                          </span>
                        </div>
                        <p className="text-zinc-300 whitespace-pre-wrap break-all">
                          {maskActive ? maskSecrets(msg) : msg}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Entity Correlations */}
          {activeTab === "correlations" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {/* Target Card */}
              <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-zinc-400 flex items-center gap-1.5">
                    <Target className="h-4 w-4 text-cyan-400" />
                    <span>Target Host</span>
                  </span>
                  {f.target && onSelectTarget && (
                    <button
                      type="button"
                      onClick={() => onSelectTarget(f.target!)}
                      className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      <span>Jump to Target</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-sm font-mono text-white font-medium">
                  {f.target || "Unavailable"}
                </p>
                <p className="text-xs text-zinc-400">
                  Target system where endpoint {f.endpoint || "root"} was identified.
                </p>
              </div>

              {/* Agent Card */}
              <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-zinc-400 flex items-center gap-1.5">
                    <Bot className="h-4 w-4 text-purple-400" />
                    <span>Responsible Agent</span>
                  </span>
                  {correlatedAg && onSelectAgent && (
                    <button
                      type="button"
                      onClick={() => onSelectAgent(correlatedAg.id)}
                      className="text-[11px] text-purple-400 hover:underline flex items-center gap-1"
                    >
                      <span>Jump to Agent</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-sm font-mono text-white font-medium">
                  {correlatedAg ? correlatedAg.name : "Autonomous Engine"}
                </p>
                <p className="text-xs text-zinc-400">
                  Agent instance responsible for dispatching scans and reporting this vulnerability.
                </p>
              </div>

              {/* Tool Card */}
              <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-zinc-400 flex items-center gap-1.5">
                    <Wrench className="h-4 w-4 text-amber-400" />
                    <span>Exploitation Tool</span>
                  </span>
                  {correlatedTl && onSelectTool && (
                    <button
                      type="button"
                      onClick={() => onSelectTool(correlatedTl)}
                      className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
                    >
                      <span>Jump to Tools</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-sm font-mono text-white font-medium">
                  {correlatedTl || "Autonomous Dynamic Probe"}
                </p>
                <p className="text-xs text-zinc-400">
                  Tool execution telemetry recorded during target assessment.
                </p>
              </div>

              {/* Report Center Card */}
              <div className="rounded-lg border border-white/10 bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-zinc-400 flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-emerald-400" />
                    <span>Report Center</span>
                  </span>
                  {onSelectView && (
                    <button
                      type="button"
                      onClick={() => onSelectView("reports")}
                      className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <span>Open Reports</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-sm font-mono text-white font-medium">
                  Executive Report & SARIF
                </p>
                <p className="text-xs text-zinc-400">
                  Inspect the comprehensive penetration test report, SARIF output, and artifacts.
                </p>
              </div>
            </div>
          )}

          {/* Tab 6: Raw Data JSON */}
          {activeTab === "raw" && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="relative min-w-[200px]">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search inside raw JSON..."
                    value={rawSearch}
                    onChange={(e) => setRawSearch(e.target.value)}
                    className="h-7 w-full rounded border border-white/10 bg-zinc-900 pl-7 pr-2 text-xs text-zinc-200"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy("raw-json-copy", maskedRawJson)}
                  className="flex items-center gap-1 rounded bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 border border-white/10 hover:bg-zinc-800 transition-colors"
                >
                  {copiedId === "raw-json-copy" ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Raw JSON</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="rounded-lg border border-white/5 bg-black/90 p-4 font-mono text-xs text-zinc-300 overflow-x-auto max-h-96 whitespace-pre-wrap">
                {maskedRawJson}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // FINDINGS LIST & INTELLIGENCE DASHBOARD
  // --------------------------------------------------------------------------
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-400" />
            <span>Findings Intelligence & Evidence Explorer</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Confirmed vulnerabilities, proof-of-concept exploits, CVSS scores, and secret-masked triage.
          </p>
        </div>

        {/* Global Search within Findings */}
        <div className="relative min-w-[260px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search ID, title, target, tool, or CVE..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border border-white/10 bg-zinc-900/80 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-rose-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Severity KPI Breakdown */}
      {vulnerabilities.length > 0 && (
        <IssueSeveritySummary
          findings={{
            total: vulnerabilities.length,
            critical: vulnerabilities.filter((v) => (v.severity || "low").toLowerCase() === "critical").length,
            high: vulnerabilities.filter((v) => (v.severity || "low").toLowerCase() === "high").length,
            medium: vulnerabilities.filter((v) => (v.severity || "low").toLowerCase() === "medium").length,
            low: vulnerabilities.filter((v) => {
              const s = (v.severity || "low").toLowerCase();
              return s !== "critical" && s !== "high" && s !== "medium";
            }).length,
          }}
        />
      )}

      {/* Combined Filter Controls Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-zinc-900/40 p-3 text-xs">
        <span className="font-mono text-zinc-400 flex items-center gap-1 font-semibold uppercase mr-1">
          <Filter className="h-3.5 w-3.5" /> Filters:
        </span>

        {/* Severity Filter */}
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Severity:</span>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded border border-white/10 bg-zinc-950 px-2 py-1 text-zinc-200 focus:outline-none"
          >
            {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-white/10 bg-zinc-950 px-2 py-1 text-zinc-200 focus:outline-none"
          >
            {["ALL", "OPEN", "CONFIRMED", "DISMISSED", "FIXED", "UNKNOWN"].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        {/* Target Filter */}
        {availableTargets.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Target:</span>
            <select
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
              className="rounded border border-white/10 bg-zinc-950 px-2 py-1 text-zinc-200 focus:outline-none max-w-[140px] truncate"
            >
              <option value="ALL">ALL Targets</option>
              {availableTargets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Agent Filter */}
        {availableAgents.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Agent:</span>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded border border-white/10 bg-zinc-950 px-2 py-1 text-zinc-200 focus:outline-none max-w-[140px] truncate"
            >
              <option value="ALL">ALL Agents</option>
              {availableAgents.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tool Filter */}
        {availableTools.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-zinc-500">Tool:</span>
            <select
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="rounded border border-white/10 bg-zinc-950 px-2 py-1 text-zinc-200 focus:outline-none max-w-[120px] truncate"
            >
              <option value="ALL">ALL Tools</option>
              {availableTools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Clear Filters Reset */}
        {(severityFilter !== "ALL" ||
          statusFilter !== "ALL" ||
          targetFilter !== "ALL" ||
          agentFilter !== "ALL" ||
          toolFilter !== "ALL" ||
          search !== "") && (
          <button
            type="button"
            onClick={() => {
              setSeverityFilter("ALL");
              setStatusFilter("ALL");
              setTargetFilter("ALL");
              setAgentFilter("ALL");
              setToolFilter("ALL");
              setSearch("");
            }}
            className="text-xs text-rose-400 hover:underline ml-auto"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Findings Results List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-mono text-zinc-400 uppercase pb-1">
          <span>
            Verified Findings ({filteredVulnerabilities.length} of {vulnerabilities.length})
          </span>
          <span className="text-zinc-500">Click row to inspect evidence & correlations</span>
        </div>

        {filteredVulnerabilities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 p-12 text-center space-y-3">
            <ShieldCheck className="h-8 w-8 text-zinc-600 mx-auto" />
            <p className="text-base font-semibold text-zinc-300">No findings match current criteria</p>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              No vulnerabilities were found matching the applied filters and search terms.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredVulnerabilities.map((vuln) => {
              const correlatedAg = correlateAgent(vuln, agents, events);
              const correlatedTl = correlateTool(vuln, events);
              const evidenceCount =
                typeof vuln.evidence_count === "number"
                  ? vuln.evidence_count
                  : vuln.evidence
                    ? 1
                    : 0;

              return (
                <div
                  key={vuln.id}
                  onClick={() => handleSelect(vuln.id)}
                  className="group cursor-pointer rounded-xl border border-white/5 bg-zinc-950 p-4 transition-all hover:border-white/20 hover:bg-zinc-900/50 space-y-3 shadow-lg"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded border px-2 py-0.5 text-xs font-mono font-bold uppercase",
                          vuln.severity === "critical" &&
                            "bg-rose-500/20 text-rose-300 border-rose-500/40",
                          vuln.severity === "high" &&
                            "bg-orange-500/20 text-orange-300 border-orange-500/40",
                          vuln.severity === "medium" &&
                            "bg-amber-500/20 text-amber-300 border-amber-500/40",
                          vuln.severity === "low" &&
                            "bg-blue-500/20 text-blue-300 border-blue-500/40",
                          vuln.severity === "info" &&
                            "bg-zinc-500/20 text-zinc-300 border-zinc-500/40"
                        )}
                      >
                        {vuln.severity}
                      </span>

                      <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-mono text-emerald-400 font-semibold uppercase">
                        {vuln.status || "CONFIRMED"}
                      </span>

                      <span className="font-mono text-xs text-zinc-400 font-bold">
                        {vuln.id}
                      </span>

                      {vuln.cvss !== null && vuln.cvss !== undefined && (
                        <span className="rounded bg-rose-950/40 border border-rose-500/30 px-1.5 py-0.5 text-[11px] font-mono text-rose-300 font-semibold">
                          CVSS {vuln.cvss}
                        </span>
                      )}

                      {evidenceCount > 0 && (
                        <span className="rounded bg-purple-500/10 border border-purple-500/30 px-1.5 py-0.5 text-[11px] font-mono text-purple-300">
                          {evidenceCount} {evidenceCount === 1 ? "Evidence" : "Evidences"}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                      <span>{new Date(vuln.created_at).toLocaleDateString()}</span>
                      <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-white transition-colors" />
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors">
                    {vuln.title}
                  </h3>

                  <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                    {maskSecrets(vuln.description)}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-white/5 text-[11px] font-mono text-zinc-500">
                    {vuln.target && (
                      <span className="flex items-center gap-1">
                        <Target className="h-3 w-3 text-cyan-400" />
                        <span className="text-zinc-300 truncate max-w-xs">{vuln.target}</span>
                      </span>
                    )}

                    {correlatedAg && (
                      <span className="flex items-center gap-1">
                        <Bot className="h-3 w-3 text-purple-400" />
                        <span className="text-zinc-300">{correlatedAg.name}</span>
                      </span>
                    )}

                    {correlatedTl && (
                      <span className="flex items-center gap-1">
                        <Wrench className="h-3 w-3 text-amber-400" />
                        <span className="text-zinc-300">{correlatedTl}</span>
                      </span>
                    )}
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
