import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Filter,
  Layers,
  Search,
  Shield,
  ShieldAlert,
} from "lucide-react";
import type { Vulnerability, VulnerabilitySeverity } from "@/types/issues";
import { IssueSeveritySummary } from "@/components/IssueSeveritySummary";
import { severityCounts } from "@/lib/local-run-parser";
import VulnerabilityDetail from "@/components/vulnerability/VulnerabilityDetail";
import { cn } from "@/lib/utils";

interface FindingsViewProps {
  vulnerabilities: Vulnerability[];
  selectedFindingId?: string | null;
  onSelect?: (findingId: string) => void;
  onSelectFinding?: (findingId: string | null) => void;
  finished?: boolean;
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

  const selectedFinding = useMemo(() => {
    if (!selectedFindingId) return null;
    return vulnerabilities.find((v) => v.id === selectedFindingId) || null;
  }, [vulnerabilities, selectedFindingId]);

  const filteredVulnerabilities = useMemo(() => {
    return vulnerabilities.filter((v) => {
      const matchesSeverity = severityFilter === "all" || v.severity === severityFilter;
      const matchesSearch =
        search.trim() === "" ||
        v.title.toLowerCase().includes(search.toLowerCase()) ||
        v.description.toLowerCase().includes(search.toLowerCase()) ||
        (v.target && v.target.toLowerCase().includes(search.toLowerCase()));

      return matchesSeverity && matchesSearch;
    });
  }, [vulnerabilities, severityFilter, search]);

  // If a finding is actively selected, show detail view with back button
  if (selectedFinding) {
    return (
      <div className="space-y-4 p-6">
        <button
          type="button"
          onClick={() => handleSelect(null)}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to All Findings</span>
        </button>

        <div className="rounded-xl border border-white/10 bg-zinc-950 p-6">
          <VulnerabilityDetail vulnerability={selectedFinding} />
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
            <span>Vulnerability Management & Triage</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Confirmed security weaknesses, autonomous proof-of-concepts, and remediation workflows.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search findings or targets..."
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
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <span className="text-sm font-semibold text-white font-mono">
            Reported Findings ({filteredVulnerabilities.length})
          </span>

          {severityFilter !== "all" && (
            <button
              type="button"
              onClick={() => setSeverityFilter("all")}
              className="text-xs text-zinc-400 hover:text-white font-mono"
            >
              Clear filter ({severityFilter})
            </button>
          )}
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
                    {vuln.description}
                  </p>

                  {vuln.target && (
                    <div className="text-[11px] text-zinc-500 font-mono truncate">
                      target: <span className="text-zinc-300">{vuln.target}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-zinc-500 shrink-0">
                  <span className="text-xs font-mono text-cyan-400">View PoC</span>
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
