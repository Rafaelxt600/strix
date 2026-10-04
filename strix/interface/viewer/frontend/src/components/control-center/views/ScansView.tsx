import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Layers,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  StopCircle,
  Target,
  Terminal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { LoadedRun } from "@/data/serverSource";
import { executeRunControl, steerAgent } from "@/data/serverSource";
import type {
  AuditCommandEntry,
  ControlCenterView,
  DestructiveConfirmationConfig,
  OfficialSessionStatus,
  OperationalTimelineCategory,
  OperationalTimelineItem,
  RealtimeTelemetry,
  RunControlCommand,
} from "@/types/control-center";
import { cn } from "@/lib/utils";

/** Sanitizes sensitive tokens, API keys, passwords, and JWTs from operational logs. */
export function maskSecrets(input: string): string {
  if (!input) return "";
  let sanitized = input;
  // Bearer authentication headers
  sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]");
  // JWT tokens
  sanitized = sanitized.replace(
    /ey[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g,
    "[REDACTED_JWT]"
  );
  // LLM / Service API keys
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_\-]{15,}/gi, "[REDACTED_KEY]");
  // Key-value pairs for passwords, tokens, secrets
  sanitized = sanitized.replace(
    /(password|token|secret|api_key|access_token)=([^&\s]+)/gi,
    "$1=[REDACTED]"
  );
  sanitized = sanitized.replace(
    /("(?:password|token|secret|api_key|access_token)"\s*:\s*)"([^"]+)"/gi,
    '$1"[REDACTED]"'
  );
  return sanitized;
}

function formatSessionDuration(startStr?: string | null, endStr?: string | null): string {
  if (!startStr) return "N/A";
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return "N/A";
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  if (isNaN(end) || end < start) return "N/A";
  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

interface ScansViewProps {
  run: LoadedRun | null;
  canSteer: boolean;
  canControl?: boolean;
  supportedCommands?: string[];
  triggerSync?: () => Promise<void>;
  telemetry?: RealtimeTelemetry;
  onSelectView?: (view: ControlCenterView) => void;
}

export function ScansView({
  run,
  canSteer,
  canControl = false,
  supportedCommands = ["pause", "resume", "stop", "cancel"],
  triggerSync,
  telemetry,
  onSelectView,
}: ScansViewProps) {
  // Operational steering state
  const [steerMsg, setSteerMsg] = useState("");
  const [steerStatus, setSteerStatus] = useState<string | null>(null);
  const [isSendingSteer, setIsSendingSteer] = useState(false);

  // Command Execution & Idempotency / Double-click state
  const [isPendingControl, setIsPendingControl] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [operationalFeedback, setOperationalFeedback] = useState<{
    type: "success" | "error" | "info" | "warning";
    message: string;
    statusCode?: number;
  } | null>(null);

  // Destructive Confirmation Modal
  const [destructiveModal, setDestructiveModal] = useState<{
    isOpen: boolean;
    operation: "STOP" | "CANCEL";
    runId: string;
    runName: string;
    consequences: string;
  } | null>(null);

  // Local Audit Trail (In-memory session history)
  const [auditLog, setAuditLog] = useState<AuditCommandEntry[]>([]);
  const [isClearedAuditView, setIsClearedAuditView] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditFilter, setAuditFilter] = useState<"ALL" | "accepted" | "rejected" | "failed">("ALL");
  const [copiedAuditId, setCopiedAuditId] = useState<string | null>(null);

  // Operational Timeline Filter
  const [timelineFilter, setTimelineFilter] = useState<OperationalTimelineCategory>("ALL");

  // Keyboard accessibility for modal (Escape closes)
  const modalCancelButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!destructiveModal?.isOpen) return;
    modalCancelButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDestructiveModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [destructiveModal?.isOpen]);

  if (!run) {
    return (
      <div className="flex h-96 flex-col items-center justify-center p-6 text-center">
        <Compass className="h-8 w-8 text-zinc-600 animate-pulse mb-3" />
        <h3 className="text-sm font-semibold text-white">No Active Run Selected</h3>
        <p className="text-xs text-zinc-500 mt-1 max-w-sm">
          No execution is currently loaded into the command center. Select a run from the session repository or launch a new scan via CLI.
        </p>
      </div>
    );
  }

  const { summary, raw, finished, vulnerabilities, transcript } = run;
  const events = transcript.events;
  const rawStatus = String(raw.status || summary.status || "").toLowerCase();

  // Resolve Authoritative Status
  let currentStatus: OfficialSessionStatus = "running";
  if (finished) {
    currentStatus = "completed";
  } else if (rawStatus.includes("budget") || rawStatus.includes("paused")) {
    currentStatus = "budget_paused";
  } else if (rawStatus.includes("wait")) {
    currentStatus = "waiting";
  } else if (rawStatus.includes("stop") || rawStatus.includes("cancel")) {
    currentStatus = "stopped";
  } else {
    currentStatus = "running";
  }

  const errorCount = events.filter((e) => {
    const d = (e.data as Record<string, unknown>) || {};
    return d.error != null || d.is_error === true || d.status === "failed";
  }).length;

  const runName = summary.runName || summary.runId || "active-run";
  const runId = summary.runId || runName;
  const duration = formatSessionDuration(summary.startTime, summary.endTime);

  // Status-based command availability
  const isTerminal = currentStatus === "completed" || currentStatus === "stopped";
  const canPause = canControl && currentStatus === "running" && !isTerminal && supportedCommands.includes("pause");
  const canResume = canControl && (currentStatus === "budget_paused") && !isTerminal && supportedCommands.includes("resume");
  const canStop = canControl && !isTerminal && supportedCommands.includes("stop");
  const canCancel = canControl && !isTerminal && supportedCommands.includes("cancel");

  // Record an action into the Local UI History audit trail
  const appendAuditEntry = (entry: Omit<AuditCommandEntry, "id" | "timestamp" | "operatorContext">) => {
    const newEntry: AuditCommandEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      operatorContext: "viewer-operator@local",
      ...entry,
      details: maskSecrets(entry.details || ""),
      error: maskSecrets(entry.error || ""),
    };
    setAuditLog((prev) => [newEntry, ...prev]);
  };

  // Dispatch Operational Control Command (Idempotent & Protected)
  const handleExecuteControl = async (cmd: RunControlCommand) => {
    if (isPendingControl) return; // Prevent double click
    if (!canControl) {
      setOperationalFeedback({
        type: "warning",
        message: "Operation rejected: Backend does not support live run control in current mode.",
      });
      return;
    }

    setIsPendingControl(true);
    setActiveCommand(cmd);
    setOperationalFeedback({
      type: "info",
      message: `Dispatching [${cmd.toUpperCase()}] command to backend controller...`,
    });

    try {
      const res = await executeRunControl(cmd, { run_id: runId });

      if (res.ok) {
        let nextState: OfficialSessionStatus = currentStatus;
        if (cmd === "pause") nextState = "budget_paused";
        else if (cmd === "resume") nextState = "running";
        else if (cmd === "stop" || cmd === "cancel") nextState = "stopped";

        setOperationalFeedback({
          type: "success",
          message: `Command [${cmd.toUpperCase()}] accepted: Authoritative state synchronized.`,
          statusCode: res.status,
        });

        appendAuditEntry({
          command: cmd.toUpperCase() as AuditCommandEntry["command"],
          runId,
          runName,
          status: "accepted",
          previousState: currentStatus,
          newState: nextState,
          details: `Command ${cmd} acknowledged by backend controller.`,
          statusCode: res.status,
        });

        // Authoritative reconciliation: pull latest state from disk
        if (triggerSync) {
          await triggerSync();
        }
      } else {
        // Detailed HTTP error interpretation
        let friendlyErr = res.error || "Execution failed";
        if (res.status === 401) {
          friendlyErr = "Authentication required (401): Session is missing or invalid.";
        } else if (res.status === 403) {
          friendlyErr = "Authorization denied (403): Standalone viewer cannot execute control commands.";
        } else if (res.status === 404) {
          friendlyErr = "Target not found (404): Active run is no longer present on backend.";
        } else if (res.status === 409) {
          friendlyErr = "State conflict (409): Run has already finished or reached a terminal state.";
        } else if (res.status === 422) {
          friendlyErr = "Invalid command parameter (422): Backend rejected payload.";
        } else if (res.status === 429) {
          friendlyErr = "Rate limit exceeded (429): Too many concurrent operational requests.";
        } else if (res.status >= 500) {
          friendlyErr = `Backend error (${res.status}): Controller encountered an unhandled fault.`;
        }

        setOperationalFeedback({
          type: "error",
          message: friendlyErr,
          statusCode: res.status,
        });

        appendAuditEntry({
          command: cmd.toUpperCase() as AuditCommandEntry["command"],
          runId,
          runName,
          status: res.status === 409 ? "rejected" : "failed",
          previousState: currentStatus,
          error: friendlyErr,
          statusCode: res.status,
        });
      }
    } catch (err: unknown) {
      const netErr = err instanceof Error ? err.message : "Network/connection failure";
      setOperationalFeedback({
        type: "error",
        message: `Connection failure: Unable to reach backend controller (${netErr}).`,
      });
      appendAuditEntry({
        command: cmd.toUpperCase() as AuditCommandEntry["command"],
        runId,
        runName,
        status: "failed",
        previousState: currentStatus,
        error: `Network failure: ${netErr}`,
      });
    } finally {
      setIsPendingControl(false);
      setActiveCommand(null);
    }
  };

  // Prompt Destructive Confirmation Modal
  const requestDestructiveOperation = (op: "STOP" | "CANCEL") => {
    setDestructiveModal({
      isOpen: true,
      operation: op,
      runId,
      runName,
      consequences:
        op === "STOP"
          ? "Aborts all active agent reasoning loops, terminates runtime sandbox containers, and marks the execution as STOPPED. All findings, SARIF outputs, and logs recorded up to this point will be safely preserved on disk."
          : "Cancels the active scan immediately. Ongoing network requests and probes will be interrupted. Partial telemetry is retained.",
    });
  };

  // Agent Steering Handler (Preserved from UI-03 with secret masking and audit logging)
  const handleSteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerMsg.trim() || isSendingSteer) return;

    const coordinator = transcript.agents.find((a) => !a.parent_id) || transcript.agents[0];
    if (!coordinator) {
      setSteerStatus("No running coordinator agent available to receive directives.");
      return;
    }

    setIsSendingSteer(true);
    setSteerStatus("Transmitting steering directive to coordinator...");
    const maskedDirective = maskSecrets(steerMsg.trim());

    try {
      const res = await steerAgent(coordinator.id, maskedDirective);
      if (res.ok) {
        setSteerStatus("Directive accepted by coordinator agent loop.");
        setSteerMsg("");
        appendAuditEntry({
          command: "STEER",
          runId,
          runName,
          status: "accepted",
          previousState: currentStatus,
          details: `Steering directive injected into coordinator [${coordinator.id}]`,
          statusCode: 200,
        });
      } else {
        const errText = res.error || "Directive rejected by coordinator";
        setSteerStatus(`Steering rejected: ${errText}`);
        appendAuditEntry({
          command: "STEER",
          runId,
          runName,
          status: "rejected",
          previousState: currentStatus,
          error: errText,
        });
      }
    } catch {
      setSteerStatus("Network timeout while communicating steering directive.");
      appendAuditEntry({
        command: "STEER",
        runId,
        runName,
        status: "failed",
        previousState: currentStatus,
        error: "Network failure transmitting steering directive",
      });
    } finally {
      setIsSendingSteer(false);
    }
  };

  // Filtered Audit Entries
  const filteredAuditEntries = useMemo(() => {
    if (isClearedAuditView) return [];
    return auditLog.filter((entry) => {
      const matchesSearch =
        auditSearch.trim() === "" ||
        entry.command.toLowerCase().includes(auditSearch.toLowerCase()) ||
        entry.runName.toLowerCase().includes(auditSearch.toLowerCase()) ||
        (entry.details && entry.details.toLowerCase().includes(auditSearch.toLowerCase())) ||
        (entry.error && entry.error.toLowerCase().includes(auditSearch.toLowerCase()));

      const matchesFilter =
        auditFilter === "ALL" || entry.status === auditFilter;

      return matchesSearch && matchesFilter;
    });
  }, [auditLog, isClearedAuditView, auditSearch, auditFilter]);

  // Operational Timeline: Correlates commands, state changes, agent lifecycle, findings, errors
  const timelineItems = useMemo<OperationalTimelineItem[]>(() => {
    const items: OperationalTimelineItem[] = [];

    // 1. Operator Commands from Audit Trail
    auditLog.forEach((cmd) => {
      items.push({
        id: cmd.id,
        timestamp: cmd.timestamp,
        category: "COMMANDS",
        title: `OPERATOR COMMAND: ${cmd.command}`,
        description: cmd.status === "accepted" ? (cmd.details || "Command accepted") : (cmd.error || "Command rejected/failed"),
        badge: cmd.status.toUpperCase(),
        severity: cmd.status === "accepted" ? "info" : "error",
      });
    });

    // 2. Lifecycle State Events
    if (summary.startTime) {
      items.push({
        id: "state-start",
        timestamp: new Date(summary.startTime).toLocaleTimeString(),
        category: "STATE",
        title: "EXECUTION INITIATED",
        description: `Target: ${summary.targets?.[0] || "Local Scope"} • Mode: ${summary.scanMode || "quick"}`,
        badge: "START",
      });
    }
    if (summary.endTime) {
      items.push({
        id: "state-end",
        timestamp: new Date(summary.endTime).toLocaleTimeString(),
        category: "STATE",
        title: `EXECUTION ${finished ? "COMPLETED" : "STOPPED"}`,
        description: `Duration: ${duration} • Total vulnerabilities: ${vulnerabilities.length}`,
        badge: finished ? "COMPLETED" : "TERMINATED",
        severity: finished ? "info" : "warning",
      });
    }

    // 3. Significant Events from Transcript
    events.slice(-40).forEach((ev, idx) => {
      const data = (ev.data as Record<string, unknown>) || {};
      const isErr = data.error != null || data.is_error === true || data.status === "failed";
      const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : `+${idx}s`;

      if (isErr) {
        items.push({
          id: `ev-err-${idx}`,
          timestamp: ts,
          category: "ERRORS",
          title: `ERROR IN AGENT [${ev.agent_id || "system"}]`,
          description: maskSecrets(String(data.error || data.message || "Runtime exception")),
          severity: "error",
        });
      } else if (ev.type.includes("tool") || ev.type.includes("finding") || ev.type.includes("state")) {
        items.push({
          id: `ev-act-${idx}`,
          timestamp: ts,
          category: "EVENTS",
          title: `AGENT EVENT: ${ev.type}`,
          description: maskSecrets(String(data.name || data.action || data.tool || "Agent action dispatched")),
        });
      }
    });

    // 4. Discovered Vulnerabilities
    vulnerabilities.forEach((vuln) => {
      items.push({
        id: `vuln-${vuln.id}`,
        timestamp: vuln.created_at ? new Date(vuln.created_at).toLocaleTimeString() : "Discovered",
        category: "FINDINGS",
        title: `FINDING DISCOVERED: ${vuln.title}`,
        description: `Severity: ${vuln.severity.toUpperCase()} • Target: ${vuln.target || "Local Scope"}`,
        badge: vuln.severity.toUpperCase(),
        severity: vuln.severity,
      });
    });

    // Sort descending by simulated order
    return items;
  }, [auditLog, summary, finished, duration, vulnerabilities, events]);

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === "ALL") return timelineItems;
    return timelineItems.filter((item) => item.category === timelineFilter);
  }, [timelineItems, timelineFilter]);

  const handleCopyAuditEntry = (entry: AuditCommandEntry) => {
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopiedAuditId(entry.id);
    setTimeout(() => setCopiedAuditId(null), 1500);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col gap-2 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl flex items-center gap-2">
            <Compass className="h-6 w-6 text-cyan-400" />
            <span>Operational Command Center</span>
            <span className="rounded bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[11px] font-mono font-semibold text-cyan-300">
              GATE UI-04
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Authoritative run control, operational safety guards, session steering, and local command audit trail.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono font-semibold uppercase",
              canControl
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>{canControl ? "CONTROLLER BOUND" : "VIEWER STANDALONE (READ-ONLY)"}</span>
          </span>
        </div>
      </div>

      {/* FEEDBACK ALERT */}
      {operationalFeedback && (
        <div
          role="alert"
          className={cn(
            "rounded-xl border p-4 text-xs font-mono flex items-start justify-between gap-3 shadow-lg transition-all",
            operationalFeedback.type === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
            operationalFeedback.type === "error" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
            operationalFeedback.type === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
            operationalFeedback.type === "info" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
          )}
        >
          <div className="flex items-start gap-2.5">
            {operationalFeedback.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />}
            {operationalFeedback.type === "error" && <AlertOctagon className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />}
            {operationalFeedback.type === "warning" && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />}
            {operationalFeedback.type === "info" && <Activity className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5 animate-pulse" />}
            <div>
              <p className="font-semibold">{operationalFeedback.message}</p>
              {operationalFeedback.statusCode && (
                <p className="text-[10px] text-zinc-400 mt-0.5">HTTP Status: {operationalFeedback.statusCode}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOperationalFeedback(null)}
            className="text-zinc-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 1. RUN CONTROL & HEALTH METRICS PANEL */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4 shadow-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-3 w-3 rounded-full",
                currentStatus === "running" && "bg-emerald-400 animate-pulse",
                currentStatus === "budget_paused" && "bg-purple-400",
                currentStatus === "waiting" && "bg-amber-400 animate-pulse",
                currentStatus === "completed" && "bg-blue-400",
                currentStatus === "stopped" && "bg-zinc-600"
              )}
            />
            <div>
              <h2 className="text-sm font-mono font-bold uppercase text-white flex items-center gap-2">
                <span>{runName}</span>
                <span className="text-zinc-500 font-normal">[{runId}]</span>
              </h2>
              <p className="text-xs text-zinc-400 font-mono">
                Target: <strong className="text-zinc-200">{summary.targets?.[0] || "Local Scope"}</strong> • Mode:{" "}
                <strong className="text-cyan-400 uppercase">{summary.scanMode || "Quick"}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-2.5 py-1 text-xs font-mono font-bold uppercase",
                currentStatus === "running" && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                currentStatus === "budget_paused" && "bg-purple-500/20 text-purple-300 border border-purple-500/30",
                currentStatus === "waiting" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                currentStatus === "completed" && "bg-blue-500/20 text-blue-300 border border-blue-500/30",
                currentStatus === "stopped" && "bg-zinc-800 text-zinc-400 border border-zinc-700"
              )}
            >
              STATUS: {currentStatus}
            </span>
          </div>
        </div>

        {/* Operational Metrics Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 text-xs font-mono">
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
            <span className="text-zinc-500 block text-[10px] uppercase">Duration</span>
            <span className="text-white font-bold text-sm mt-0.5 block">{duration}</span>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
            <span className="text-zinc-500 block text-[10px] uppercase">Active Agents</span>
            <span className="text-cyan-400 font-bold text-sm mt-0.5 block">{transcript.agents.length} nodes</span>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
            <span className="text-zinc-500 block text-[10px] uppercase">Events</span>
            <span className="text-zinc-200 font-bold text-sm mt-0.5 block">
              {events.length}
              {telemetry?.deduplicatedCount ? (
                <span className="text-zinc-500 text-[10px] ml-1">(-{telemetry.deduplicatedCount})</span>
              ) : null}
            </span>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
            <span className="text-zinc-500 block text-[10px] uppercase">Findings</span>
            <span className="text-rose-400 font-bold text-sm mt-0.5 block">{vulnerabilities.length} issues</span>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
            <span className="text-zinc-500 block text-[10px] uppercase">Errors</span>
            <span
              className={cn(
                "font-bold text-sm mt-0.5 block",
                errorCount > 0 ? "text-rose-400" : "text-emerald-400"
              )}
            >
              {errorCount} errors
            </span>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-900/60 p-3">
            <span className="text-zinc-500 block text-[10px] uppercase">Transport</span>
            <span
              className={cn(
                "font-bold text-xs mt-1 block uppercase",
                telemetry?.connectionState === "CONNECTED" ? "text-emerald-400" : "text-amber-400"
              )}
            >
              {telemetry?.connectionState || "CONNECTED"}
            </span>
          </div>
        </div>

        {/* 2. OPERATIONAL ACTION BAR */}
        <div className="pt-3 border-t border-white/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span className="text-xs font-mono font-bold text-white uppercase">Operational Controls:</span>
              {!canControl && (
                <span className="text-[11px] text-amber-400 font-mono">
                  (Unavailable: Standalone viewer / Not supported by backend)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* PAUSE */}
              <button
                type="button"
                disabled={!canPause || isPendingControl}
                onClick={() => handleExecuteControl("pause")}
                title={canPause ? "Pause scan execution" : "Pause unavailable for current state"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono font-semibold transition-all",
                  canPause && !isPendingControl
                    ? "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 active:scale-95"
                    : "border-white/5 bg-zinc-900 text-zinc-600 cursor-not-allowed"
                )}
              >
                <Pause className="h-3.5 w-3.5" />
                <span>PAUSE</span>
              </button>

              {/* RESUME */}
              <button
                type="button"
                disabled={!canResume || isPendingControl}
                onClick={() => handleExecuteControl("resume")}
                title={canResume ? "Resume paused scan" : "Resume unavailable for current state"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono font-semibold transition-all",
                  canResume && !isPendingControl
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 active:scale-95"
                    : "border-white/5 bg-zinc-900 text-zinc-600 cursor-not-allowed"
                )}
              >
                <Play className="h-3.5 w-3.5" />
                <span>RESUME</span>
              </button>

              {/* STOP (Destructive - requires confirmation) */}
              <button
                type="button"
                disabled={!canStop || isPendingControl}
                onClick={() => requestDestructiveOperation("STOP")}
                title={canStop ? "Stop scan execution (Requires confirmation)" : "Stop unavailable for terminal state"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono font-semibold transition-all",
                  canStop && !isPendingControl
                    ? "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 active:scale-95"
                    : "border-white/5 bg-zinc-900 text-zinc-600 cursor-not-allowed"
                )}
              >
                <StopCircle className="h-3.5 w-3.5" />
                <span>STOP</span>
              </button>

              {/* CANCEL (Destructive - requires confirmation) */}
              <button
                type="button"
                disabled={!canCancel || isPendingControl}
                onClick={() => requestDestructiveOperation("CANCEL")}
                title={canCancel ? "Cancel execution (Requires confirmation)" : "Cancel unavailable"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono font-semibold transition-all",
                  canCancel && !isPendingControl
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 active:scale-95"
                    : "border-white/5 bg-zinc-900 text-zinc-600 cursor-not-allowed"
                )}
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>CANCEL</span>
              </button>

              {isPendingControl && (
                <span className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 animate-pulse ml-2">
                  <Activity className="h-3.5 w-3.5 animate-spin" />
                  <span>Executing {activeCommand}...</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. AGENT STEERING DIRECTIVE PANEL */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Autonomous Agent Steering</h3>
          </div>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-mono uppercase",
              canSteer
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-zinc-800 text-zinc-500"
            )}
          >
            {canSteer ? "STEERING ACTIVE" : "READ-ONLY VIEWER"}
          </span>
        </div>

        {canSteer ? (
          <form onSubmit={handleSteer} className="space-y-3">
            <p className="text-xs text-zinc-400">
              Inject priority instructions directly into the active scan's coordinator agent loop without terminating the session:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={steerMsg}
                onChange={(e) => setSteerMsg(e.target.value)}
                placeholder="e.g., Prioritize authentication bypass testing on /api/v1/auth..."
                className="flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:border-cyan-500/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSendingSteer || !steerMsg.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-black hover:bg-cyan-400 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Steer</span>
              </button>
            </div>
            {steerStatus && (
              <div className="text-xs font-mono text-cyan-300 bg-cyan-500/10 p-2 rounded border border-cyan-500/20">
                {steerStatus}
              </div>
            )}
          </form>
        ) : (
          <div className="rounded-lg bg-zinc-900/50 p-4 text-xs text-zinc-400 border border-white/5 space-y-1">
            <p className="text-zinc-300 font-medium">Viewer Mode Active:</p>
            <p>
              Direct agent steering is bound to live terminal runs launched with the interactive TUI.
              Completed or historical session records are read-only.
            </p>
          </div>
        )}
      </div>

      {/* 4. AUDIT TRAIL & COMMAND CONSOLE (LOCAL UI HISTORY) */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Command Console & Audit Trail</h3>
              <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                LOCAL UI HISTORY
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              In-memory audit log of operator actions dispatched during this browser session. Secrets and tokens are redacted.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-zinc-500" />
              <input
                type="text"
                placeholder="Search audit..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="h-7 w-36 rounded-md border border-white/10 bg-zinc-900 pl-7 pr-2 text-xs text-white placeholder-zinc-500 focus:outline-none"
              />
            </div>

            {/* Filter buttons */}
            <div className="flex rounded-md border border-white/10 bg-zinc-900 p-0.5 text-[10px] font-mono">
              {(["ALL", "accepted", "rejected", "failed"] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setAuditFilter(filter)}
                  className={cn(
                    "rounded px-2 py-0.5 uppercase transition-colors",
                    auditFilter === filter ? "bg-white/10 text-white font-bold" : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Clear / Restore View (Non-destructive to backend) */}
            <button
              type="button"
              onClick={() => setIsClearedAuditView(!isClearedAuditView)}
              className="flex items-center gap-1 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 hover:text-white"
            >
              {isClearedAuditView ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              <span>{isClearedAuditView ? "Restore View" : "Clear View"}</span>
            </button>
          </div>
        </div>

        {/* Audit Table / List */}
        {filteredAuditEntries.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 font-mono">
            {isClearedAuditView
              ? "Audit view cleared by operator (Click 'Restore View' to unhide session history)."
              : "No operator commands recorded in this session yet."}
          </div>
        ) : (
          <div className="divide-y divide-white/5 max-h-60 overflow-y-auto font-mono text-xs">
            {filteredAuditEntries.map((entry) => (
              <div
                key={entry.id}
                className="py-2.5 px-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between hover:bg-white/[0.02] rounded"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-zinc-500 text-[11px]">{entry.timestamp}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                      entry.command === "STOP" && "bg-rose-500/20 text-rose-300 border border-rose-500/30",
                      entry.command === "CANCEL" && "bg-amber-500/20 text-amber-300 border border-amber-500/30",
                      entry.command === "PAUSE" && "bg-purple-500/20 text-purple-300 border border-purple-500/30",
                      entry.command === "RESUME" && "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
                      entry.command === "STEER" && "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    )}
                  >
                    {entry.command}
                  </span>
                  <span className="text-zinc-300 truncate max-w-xs">{entry.details || entry.error}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.2 text-[10px] uppercase font-semibold",
                      entry.status === "accepted" && "text-emerald-400 bg-emerald-500/10",
                      entry.status === "rejected" && "text-amber-400 bg-amber-500/10",
                      entry.status === "failed" && "text-rose-400 bg-rose-500/10"
                    )}
                  >
                    {entry.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyAuditEntry(entry)}
                    title="Copy audit record JSON"
                    className="text-zinc-500 hover:text-white"
                  >
                    {copiedAuditId === entry.id ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. OPERATIONAL TIMELINE & EVENT CORRELATION */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Operational Timeline & Correlation</h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Correlated stream of state transitions, operator commands, agent actions, findings, and errors.
            </p>
          </div>

          <div className="flex flex-wrap rounded-md border border-white/10 bg-zinc-900 p-0.5 text-[10px] font-mono">
            {(["ALL", "COMMANDS", "STATE", "EVENTS", "ERRORS", "FINDINGS"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setTimelineFilter(cat)}
                className={cn(
                  "rounded px-2 py-0.5 uppercase transition-colors",
                  timelineFilter === cat ? "bg-cyan-500/20 text-cyan-300 font-bold" : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline Items */}
        {filteredTimeline.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 font-mono">
            No events match the selected category.
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {filteredTimeline.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-2.5 text-xs font-mono transition-colors",
                  item.category === "COMMANDS" && "border-cyan-500/20 bg-cyan-500/5 text-cyan-200",
                  item.category === "STATE" && "border-white/10 bg-zinc-900/50 text-white",
                  item.category === "ERRORS" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
                  item.category === "FINDINGS" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                  item.category === "EVENTS" && "border-white/5 bg-zinc-900/30 text-zinc-400"
                )}
              >
                <div className="shrink-0 text-[10px] text-zinc-500 mt-0.5">{item.timestamp}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white truncate">{item.title}</span>
                    {item.badge && (
                      <span className="rounded bg-white/10 px-1.5 py-0.2 text-[9px] uppercase font-bold text-zinc-300">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. DESTRUCTIVE OPERATION CONFIRMATION MODAL */}
      {destructiveModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="destructive-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
        >
          <div className="relative w-full max-w-md rounded-xl border border-rose-500/40 bg-zinc-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/15 border border-rose-500/30">
                <AlertOctagon className="h-5 w-5" />
              </div>
              <div>
                <h3 id="destructive-modal-title" className="text-base font-bold text-white">
                  Confirm Destructive Operation
                </h3>
                <span className="text-xs font-mono text-rose-400 uppercase font-semibold">
                  {destructiveModal.operation} EXECUTION
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-zinc-900/80 p-3.5 border border-white/5 text-xs font-mono space-y-1.5">
              <div className="flex justify-between">
                <span className="text-zinc-500">Run Name:</span>
                <span className="text-white font-semibold">{destructiveModal.runName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Current Status:</span>
                <span className="text-amber-400 uppercase">{currentStatus}</span>
              </div>
            </div>

            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-300 space-y-1">
              <p className="font-semibold">Consequences:</p>
              <p className="text-[11px] leading-relaxed text-rose-200/80">{destructiveModal.consequences}</p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                ref={modalCancelButtonRef}
                type="button"
                onClick={() => setDestructiveModal(null)}
                className="rounded-lg border border-white/10 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/10"
              >
                Cancel (Esc)
              </button>

              <button
                type="button"
                disabled={isPendingControl}
                onClick={async () => {
                  const op = destructiveModal.operation === "STOP" ? "stop" : "cancel";
                  setDestructiveModal(null);
                  await handleExecuteControl(op);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                <StopCircle className="h-4 w-4" />
                <span>Confirm and {destructiveModal.operation}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
