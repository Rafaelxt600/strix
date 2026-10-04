import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Search,
  Copy,
  Check,
  Download,
  Eye,
  RefreshCw,
  Layers,
  ShieldAlert,
  AlertTriangle,
  Info,
  Calendar,
  HardDrive,
  FileCode,
  Table,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { maskSecrets } from "@/lib/security";
import { fetchReports, fetchReportContent, type LoadedRun } from "@/data/serverSource";
import type { ReportMetadata, ReportFileDetail, SarifSummary } from "@/types/control-center";

interface ReportsViewProps {
  run: LoadedRun;
  activeRunName: string | null;
  onSelectFinding?: (id: string) => void;
}

type FormatFilter = "ALL" | "MARKDOWN" | "SARIF" | "JSON" | "CSV";

export function ReportsView({ run, activeRunName, onSelectFinding }: ReportsViewProps) {
  const [reports, setReports] = useState<ReportMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedReportPath, setSelectedReportPath] = useState<string | null>(null);
  const [reportDetail, setReportDetail] = useState<ReportFileDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [maskActive, setMaskActive] = useState(true);
  const [activeTab, setActiveTab] = useState<"preview" | "raw">("preview");

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchReports(activeRunName);
      setReports(data);
      if (data.length > 0 && !selectedReportPath) {
        setSelectedReportPath(data[0].path);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeRunName, selectedReportPath]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  // Load detailed content when selected report changes
  useEffect(() => {
    if (!selectedReportPath) {
      setReportDetail(null);
      return;
    }
    let isCancelled = false;
    setIsLoadingDetail(true);

    fetchReportContent(selectedReportPath, activeRunName)
      .then((detail) => {
        if (!isCancelled) {
          setReportDetail(detail);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setReportDetail(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedReportPath, activeRunName]);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const matchesFormat =
        formatFilter === "ALL" || r.format.toUpperCase() === formatFilter;

      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === "" ||
        r.name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.format.toLowerCase().includes(q);

      return matchesFormat && matchesSearch;
    });
  }, [reports, formatFilter, search]);

  const selectedReportMeta = useMemo(() => {
    return reports.find((r) => r.path === selectedReportPath) || null;
  }, [reports, selectedReportPath]);

  const formatBadgeClass = (fmt: string) => {
    switch (fmt.toLowerCase()) {
      case "markdown":
        return "bg-sky-500/10 border-sky-500/30 text-sky-400";
      case "sarif":
        return "bg-purple-500/10 border-purple-500/30 text-purple-400";
      case "json":
        return "bg-amber-500/10 border-amber-500/30 text-amber-400";
      case "csv":
        return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
      default:
        return "bg-zinc-500/10 border-zinc-500/30 text-zinc-400";
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <FileText className="h-5 w-5 text-cyan-400" />
            <span>Report Center & Artifacts</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Canonical scan reports, SARIF 2.1.0 telemetry, vulnerability indexes, and verified artifacts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Secrets Masking Toggle */}
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
            onClick={() => void loadReports()}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Format tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["ALL", "MARKDOWN", "SARIF", "JSON", "CSV"] as FormatFilter[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setFormatFilter(fmt)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
                formatFilter === fmt
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                  : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              )}
            >
              {fmt}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search report name or format..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border border-white/10 bg-zinc-900/80 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-cyan-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Report Manifest List (5 cols) */}
        <div className="lg:col-span-4 space-y-2">
          <div className="text-xs font-mono uppercase text-zinc-400 flex items-center justify-between pb-1">
            <span>Discovered Reports ({filteredReports.length})</span>
            <span className="text-[11px] text-zinc-500 font-sans">Local Filesystem</span>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 text-center space-y-2">
              <RefreshCw className="h-5 w-5 animate-spin text-zinc-500 mx-auto" />
              <p className="text-xs text-zinc-400">Discovering report artifacts…</p>
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 p-8 text-center space-y-2">
              <FileCode className="h-6 w-6 text-zinc-600 mx-auto" />
              <p className="text-sm font-medium text-zinc-400">No matching reports</p>
              <p className="text-xs text-zinc-500">
                Reports are generated automatically when scans conclude or findings are recorded.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1 scrollbar-thin">
              {filteredReports.map((r) => {
                const isSelected = r.path === selectedReportPath;
                return (
                  <button
                    key={r.path}
                    type="button"
                    onClick={() => {
                      setSelectedReportPath(r.path);
                      setActiveTab("preview");
                    }}
                    className={cn(
                      "w-full text-left rounded-xl border p-3.5 transition-all flex flex-col gap-2",
                      isSelected
                        ? "border-cyan-500/50 bg-cyan-950/20 shadow-lg shadow-cyan-950/30"
                        : "border-white/5 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-white/10"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-zinc-200 truncate">
                        {r.title}
                      </span>
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase",
                          formatBadgeClass(r.format)
                        )}
                      >
                        {r.format}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                      <span className="truncate max-w-[180px]">{r.name}</span>
                      <span>{formatSize(r.size_bytes)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Detailed Report Previewer (8 cols) */}
        <div className="lg:col-span-8 rounded-xl border border-white/10 bg-zinc-950 p-6 space-y-5 shadow-2xl min-h-[500px]">
          {selectedReportMeta ? (
            <div className="space-y-5">
              {/* Report Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/10 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 text-xs font-mono font-bold uppercase",
                        formatBadgeClass(selectedReportMeta.format)
                      )}
                    >
                      {selectedReportMeta.format}
                    </span>
                    <h2 className="text-base font-bold text-white tracking-tight">
                      {selectedReportMeta.title}
                    </h2>
                  </div>
                  <p className="text-xs text-zinc-400 font-mono">
                    {selectedReportMeta.path} · {formatSize(selectedReportMeta.size_bytes)} · Updated{" "}
                    {new Date(selectedReportMeta.updated_at).toLocaleString()}
                  </p>
                </div>

                {/* Top Action Buttons */}
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-white/10 bg-zinc-900 p-0.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab("preview")}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-md transition-colors",
                        activeTab === "preview"
                          ? "bg-zinc-800 text-white font-medium"
                          : "text-zinc-400 hover:text-white"
                      )}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("raw")}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-md transition-colors",
                        activeTab === "raw"
                          ? "bg-zinc-800 text-white font-medium"
                          : "text-zinc-400 hover:text-white"
                      )}
                    >
                      Raw
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const text =
                        reportDetail?.content ||
                        reportDetail?.raw ||
                        JSON.stringify(reportDetail?.data, null, 2) ||
                        "";
                      handleCopy("report-content", maskActive ? maskSecrets(text) : text);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    {copiedKey === "report-content" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopy("report-path", selectedReportMeta.path)}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    {copiedKey === "report-path" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Path Copied!</span>
                      </>
                    ) : (
                      <>
                        <HardDrive className="h-3 w-3" />
                        <span>Path</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Preview Body */}
              {isLoadingDetail ? (
                <div className="py-16 text-center space-y-3">
                  <RefreshCw className="h-6 w-6 animate-spin text-cyan-400 mx-auto" />
                  <p className="text-xs text-zinc-400">Loading artifact content…</p>
                </div>
              ) : reportDetail ? (
                <div className="space-y-4">
                  {/* Format-Specific Previews */}
                  {selectedReportMeta.format === "sarif" && activeTab === "preview" && (
                    <SarifPreviewSection
                      summary={reportDetail.summary}
                      onSelectFinding={onSelectFinding}
                    />
                  )}

                  {selectedReportMeta.format === "markdown" && activeTab === "preview" && (
                    <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-5 text-sm text-zinc-300 leading-relaxed font-sans whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                      {maskActive
                        ? maskSecrets(reportDetail.content || "")
                        : reportDetail.content || "Empty report"}
                    </div>
                  )}

                  {selectedReportMeta.format === "json" && activeTab === "preview" && (
                    <div className="rounded-lg border border-white/5 bg-black/60 p-4 font-mono text-xs text-zinc-300 overflow-x-auto max-h-[600px] whitespace-pre-wrap">
                      {maskActive
                        ? maskSecrets(
                            reportDetail.raw || JSON.stringify(reportDetail.data, null, 2)
                          )
                        : reportDetail.raw || JSON.stringify(reportDetail.data, null, 2)}
                    </div>
                  )}

                  {selectedReportMeta.format === "csv" && activeTab === "preview" && (
                    <CsvPreviewTable
                      csvText={reportDetail.content || ""}
                      maskActive={maskActive}
                    />
                  )}

                  {/* Raw Tab for any format */}
                  {activeTab === "raw" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-zinc-500 font-mono">
                        <span>Verbatim Payload</span>
                        <span>{reportDetail.size_bytes} bytes</span>
                      </div>
                      <pre className="rounded-lg border border-white/5 bg-black/80 p-4 font-mono text-xs text-zinc-300 overflow-x-auto max-h-[600px] whitespace-pre-wrap">
                        {maskActive
                          ? maskSecrets(
                              reportDetail.content ||
                                reportDetail.raw ||
                                JSON.stringify(reportDetail.data, null, 2) ||
                                ""
                            )
                          : reportDetail.content ||
                            reportDetail.raw ||
                            JSON.stringify(reportDetail.data, null, 2) ||
                            ""}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-500 text-xs">
                  Unable to load content for {selectedReportMeta.path}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 text-center space-y-3">
              <FileText className="h-8 w-8 text-zinc-600" />
              <p className="text-sm font-medium text-zinc-400">Select a report to inspect</p>
              <p className="text-xs text-zinc-500 max-w-sm">
                Choose any artifact from the manifest on the left to view summaries, parsed SARIF results, or raw code.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * High-fidelity SARIF summary and rules breakdown inspector.
 */
function SarifPreviewSection({
  summary,
  onSelectFinding,
}: {
  summary?: SarifSummary;
  onSelectFinding?: (id: string) => void;
}) {
  if (!summary) {
    return <div className="text-xs text-zinc-500">No SARIF summary available.</div>;
  }

  return (
    <div className="space-y-4">
      {/* KPI Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
          <span className="text-[11px] text-zinc-500 font-mono">SARIF Version</span>
          <p className="text-sm font-bold text-zinc-200 mt-0.5">{summary.version}</p>
        </div>

        <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
          <span className="text-[11px] text-zinc-500 font-mono">Runs Logged</span>
          <p className="text-sm font-bold text-zinc-200 mt-0.5">{summary.runs_count}</p>
        </div>

        <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
          <span className="text-[11px] text-zinc-500 font-mono">Rules Defined</span>
          <p className="text-sm font-bold text-purple-400 mt-0.5">{summary.rules_count}</p>
        </div>

        <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
          <span className="text-[11px] text-zinc-500 font-mono">Results / Findings</span>
          <p className="text-sm font-bold text-rose-400 mt-0.5">{summary.results_count}</p>
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="rounded-lg border border-white/5 bg-zinc-900/40 p-4 space-y-2">
        <h3 className="text-xs font-mono font-semibold uppercase text-zinc-400 tracking-wider">
          SARIF Finding Severities
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
          <div className="flex items-center justify-between rounded bg-zinc-950/60 px-2.5 py-1.5 border border-rose-500/20">
            <span className="text-rose-400">High / Error</span>
            <span className="font-bold text-rose-300">
              {summary.severity_counts.high || 0}
            </span>
          </div>

          <div className="flex items-center justify-between rounded bg-zinc-950/60 px-2.5 py-1.5 border border-amber-500/20">
            <span className="text-amber-400">Medium / Warn</span>
            <span className="font-bold text-amber-300">
              {summary.severity_counts.medium || 0}
            </span>
          </div>

          <div className="flex items-center justify-between rounded bg-zinc-950/60 px-2.5 py-1.5 border border-blue-500/20">
            <span className="text-blue-400">Low / Note</span>
            <span className="font-bold text-blue-300">
              {summary.severity_counts.low || 0}
            </span>
          </div>

          <div className="flex items-center justify-between rounded bg-zinc-950/60 px-2.5 py-1.5 border border-zinc-700/30">
            <span className="text-zinc-400">Info / Other</span>
            <span className="font-bold text-zinc-300">
              {summary.severity_counts.info || 0}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tabular CSV viewer with secret masking.
 */
function CsvPreviewTable({
  csvText,
  maskActive,
}: {
  csvText: string;
  maskActive: boolean;
}) {
  const rows = useMemo(() => {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.map((l) => l.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim()));
  }, [csvText]);

  if (rows.length === 0) {
    return <div className="text-xs text-zinc-500 p-4">Empty CSV artifact</div>;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="rounded-lg border border-white/5 bg-zinc-950 overflow-x-auto max-h-[500px]">
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-zinc-900/80 border-b border-white/10 sticky top-0">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-zinc-400 font-semibold uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {dataRows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-zinc-900/40 transition-colors">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2 text-zinc-300 truncate max-w-xs">
                  {maskActive ? maskSecrets(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
