import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  FileCode,
  Filter,
  Layers,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Target,
  Terminal,
} from "lucide-react";
import type { Vulnerability, VulnerabilitySeverity } from "@/types/issues";
import { IssueSeveritySummary } from "@/components/IssueSeveritySummary";
import { severityCounts } from "@/lib/local-run-parser";
import { cn } from "@/lib/utils";

interface FindingsViewProps {
  vulnerabilities: Vulnerability[];
  selectedFindingId?: string | null;
  onSelect?: (findingId: string) => void;
  onSelectFinding?: (findingId: string | null) => void;
  finished?: boolean;
}

// Regex to detect and mask sensitive tokens, credentials, API keys
const SENSITIVE_PATTERNS = [
  /((?:api[_-]?key|token|secret|password|bearer|auth)[=:\s'"]+)([a-zA-Z0-9_\-.~+/]{8,})/gi,
  /(sk-[a-zA-Z0-9]{20,})/gi,
  /(ghp_[a-zA-Z0-9]{20,})/gi,
  /(xox[baprs]-[a-zA-Z0-9]{10,})/gi,
  /(AIza[0-9A-Za-z-_]{35})/gi,
];

function maskSecrets(text?: string | null): string {
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

export function FindingsView({
  vulnerabilities,
  selectedFindingId = null,
  onSelect,
  onSelectFinding,
  finished,
}: FindingsViewProps) {
  const handleSelect = (id: string | null) => {
    if (onSelect && id) onSelect(id);
    if (onSelectFinding) onSelectFinding(id);
  };

  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [maskActive, setMaskActive] = useState<boolean>(true);

  const selectedFinding = useMemo(() => {
    if (!selectedFindingId) return null;
    return vulnerabilities.find((v) => v.id === selectedFindingId) || null;
  }, [vulnerabilities, selectedFindingId]);

  const filteredVulnerabilities = useMemo(() => {
    return vulnerabilities.filter((v) => {
      const vSev = (v.severity || "low").toLowerCase();
      const matchesSeverity =
        severityFilter === "all" ||
        vSev === severityFilter.toLowerCase();

      const matchesSearch =
        search.trim() === "" ||
        v.title.toLowerCase().includes(search.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(search.toLowerCase())) ||
        (v.target && v.target.toLowerCase().includes(search.toLowerCase())) ||
        (v.cve && v.cve.toLowerCase().includes(search.toLowerCase()));

      return matchesSeverity && matchesSearch;
    });
  }, [vulnerabilities, severityFilter, search]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // If a finding is actively selected, show comprehensive detail view
  if (selectedFinding) {
    const f = selectedFinding;
    const safeDesc = maskActive ? maskSecrets(f.description) : f.description || "N/A";
    const safeEvidence = maskActive ? maskSecrets(f.evidence) : f.evidence;
    const safePoc = maskActive ? maskSecrets(f.poc_script_code) : f.poc_script_code;
    const safeRemediation = maskActive ? maskSecrets(f.remediation_steps) : f.remediation_steps;
    const safeAnalysis = maskActive ? maskSecrets(f.technical_analysis) : f.technical_analysis;

    return (
      <div className="space-y-5 p-6">
        {/* Top Controls */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to All Findings</span>
          </button>

          <div className="flex items-center gap-2">
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
              onClick={() => handleCopy("finding-json", JSON.stringify(f, null, 2))}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {copiedId === "finding-json" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied JSON!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Finding Detail Card */}
        <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 space-y-6 shadow-2xl">
          {/* Header */}
          <div className="pb-4 border-b border-white/10 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded px-2.5 py-0.5 text-xs font-mono font-bold uppercase",
                  f.severity === "critical" && "bg-rose-500/20 text-rose-300 border border-rose-500/40",
                  f.severity === "high" && "bg-orange-500/20 text-orange-300 border border-orange-500/40",
                  f.severity === "medium" && "bg-amber-500/20 text-amber-300 border border-amber-500/40",
                  f.severity === "low" && "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                )}
              >
                {f.severity}
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
            </div>

            <h1 className="text-xl font-bold text-white tracking-tight">{f.title}</h1>
          </div>

          {/* Canonical Inspection Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs rounded-lg border border-white/5 bg-zinc-900/60 p-4">
            <div>
              <span className="text-zinc-500">Target</span>
              <p className="mt-1 text-zinc-200 font-medium truncate">{f.target || "N/A"}</p>
            </div>
            <div>
              <span className="text-zinc-500">Source / Reporter</span>
              <p className="mt-1 text-cyan-300 font-medium">Autonomous Pentest Agent</p>
            </div>
            <div>
              <span className="text-zinc-500">Endpoint</span>
              <p className="mt-1 text-zinc-200 font-medium truncate">
                {f.endpoint ? `${f.method || "GET"} ${f.endpoint}` : "N/A"}
              </p>
            </div>
            <div>
              <span className="text-zinc-500">Identified At</span>
              <p className="mt-1 text-zinc-200">
                {f.created_at ? new Date(f.created_at).toLocaleDateString() : "N/A"}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <h3 className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider">
              Description & Vulnerability Analysis
            </h3>
            <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-4 text-sm text-zinc-300 leading-relaxed font-sans whitespace-pre-wrap">
              {safeDesc}
            </div>
          </div>

          {/* Technical Analysis / Evidence */}
          {(safeAnalysis || safeEvidence) && (
            <div className="space-y-2">
              <h3 className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider">
                Technical Evidence & Payload
              </h3>
              <div className="rounded-lg border border-white/5 bg-black/60 p-4 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-72">
                {safeAnalysis || safeEvidence}
              </div>
            </div>
          )}

          {/* Proof of Concept (PoC) Script */}
          {safePoc && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Autonomous Proof-of-Concept (PoC)</span>
                </h3>

                <button
                  type="button"
                  onClick={() => handleCopy("poc-script", safePoc)}
                  className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-white"
                >
                  {copiedId === "poc-script" ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied PoC!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Script</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="rounded-lg border border-cyan-500/20 bg-black/90 p-4 font-mono text-xs text-cyan-300 overflow-x-auto max-h-96 whitespace-pre-wrap">
                {safePoc}
              </pre>
            </div>
          )}

          {/* Remediation Steps */}
          {safeRemediation && (
            <div className="space-y-2">
              <h3 className="text-xs font-mono font-semibold uppercase text-emerald-400 tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Remediation & Recommended Fix</span>
              </h3>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-4 text-sm text-zinc-200 leading-relaxed font-sans whitespace-pre-wrap">
                {safeRemediation}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-400" />
            <span>Vulnerability Management & Findings Inspector</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Confirmed vulnerabilities, proof-of-concept exploits, CVSS scores, and secret-masked triage.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search title, target, CVE, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 rounded-lg border border-white/10 bg-zinc-900/80 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-rose-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Severity KPI Breakdown */}
      <IssueSeveritySummary
        findings={{
          total: vulnerabilities.length,
          ...severityCounts(vulnerabilities),
        }}
      />

      {/* Findings List */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white font-mono">
              Reported Findings ({filteredVulnerabilities.length})
            </span>
          </div>

          {/* Quick Severity Filter Tabs: ALL, CRITICAL, HIGH, MEDIUM, LOW, INFO */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
            {(["all", "critical", "high", "medium", "low", "info"] as const).map((sev) => {
              const count =
                sev === "all"
                  ? vulnerabilities.length
                  : vulnerabilities.filter((v) => (v.severity || "low").toLowerCase() === sev).length;
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors uppercase",
                    severityFilter === sev
                      ? sev === "critical"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold"
                        : sev === "high"
                        ? "bg-orange-500/20 text-orange-300 border border-orange-500/40 font-bold"
                        : sev === "medium"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
                        : sev === "low"
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold"
                        : sev === "info"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold"
                        : "bg-white/15 text-white font-bold"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
                  )}
                >
                  <span>{sev}</span>
                  <span className="text-[10px] opacity-70">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {filteredVulnerabilities.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500 font-mono">
            {vulnerabilities.length === 0
              ? "No vulnerabilities identified in this session."
              : "No findings match your filter."}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredVulnerabilities.map((vuln) => (
              <div
                key={vuln.id}
                onClick={() => handleSelect(vuln.id)}
                className="flex cursor-pointer items-center justify-between py-3.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <div className="space-y-1.5 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase",
                        vuln.severity === "critical" && "bg-rose-500/20 text-rose-300 border border-rose-500/30",
                        vuln.severity === "high" && "bg-orange-500/20 text-orange-300 border border-orange-500/30",
                        vuln.severity === "medium" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                        vuln.severity === "low" && "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      )}
                    >
                      {vuln.severity}
                    </span>
                    <span className="text-sm font-semibold text-white truncate">{vuln.title}</span>
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                    {maskSecrets(vuln.description)}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono">
                    {vuln.target && (
                      <span className="truncate">
                        target: <span className="text-zinc-300">{vuln.target}</span>
                      </span>
                    )}
                    {vuln.cve && (
                      <span className="text-zinc-400">CVE: {vuln.cve}</span>
                    )}
                    {vuln.cvss && (
                      <span className="text-rose-400 font-bold">CVSS {vuln.cvss}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-zinc-500 shrink-0">
                  <span className="text-xs font-mono text-cyan-400">Inspect</span>
                  <ChevronRight className="h-4 w-4" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
