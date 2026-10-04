export type ConnectionState =
  | "CONNECTED"
  | "CONNECTING"
  | "RECONNECTING"
  | "DISCONNECTED"
  | "ERROR";

export type TransportMode = "realtime" | "polling" | "offline";

export interface RealtimeTelemetry {
  connectionState: ConnectionState;
  transportMode: TransportMode;
  reconnectAttempts: number;
  lastHeartbeat: string | null;
  totalEventsReceived: number;
  deduplicatedCount: number;
  eventsPerSecond: number;
  bufferSize: number;
  isPaused: boolean;
  errorCount?: number;
}

/** Official Session Statuses according to Gate UI-03 specification */
export type OfficialSessionStatus =
  | "running"
  | "waiting"
  | "budget_paused"
  | "completed"
  | "stopped";

/** Semantic classification of a session state */
export type SessionStateClassification =
  | "active"
  | "paused"
  | "completed"
  | "stopped"
  | "error";

export interface SessionInspectionDetails {
  id: string;
  status: OfficialSessionStatus;
  classification: SessionStateClassification;
  startTime: string | null;
  lastActivity: string | null;
  duration: string;
  agentCount: number;
  eventCount: number;
  findingCount: number;
  errorCount: number;
  transportState: ConnectionState;
  reconnectCount: number;
  deduplicatedCount: number;
  scanMode?: string | null;
  target?: string | null;
}

/** Official Agent Statuses according to Gate UI-03 specification */
export type OfficialAgentStatus =
  | "RUNNING"
  | "WAITING"
  | "PAUSED"
  | "COMPLETED"
  | "STOPPED"
  | "ERROR";

export interface AgentInspectionDetails {
  id: string;
  name: string;
  status: OfficialAgentStatus;
  currentTask: string;
  lastEvent: string;
  lastActivity: string;
  tool: string;
  duration: string;
  eventCount: number;
  errorCount: number;
  parentId: string | null;
  childrenCount: number;
}

export interface OperationalMetrics {
  eventsPerSecond: number | string;
  totalEvents: number;
  activeAgents: number;
  totalAgents: number;
  findingsCount: number;
  errorsCount: number;
  reconnectsCount: number;
  sessionDuration: string;
  transportState: ConnectionState;
}

export interface EventTimelineItem {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  session_id: string;
  agent_id: string;
  version: number;
  payload: Record<string, unknown>;
  severity?: string | null;
  isNew?: boolean;
}

/** Operational Command types for Gate UI-04 */
export type RunControlCommand = "pause" | "resume" | "stop" | "cancel";

export interface AuditCommandEntry {
  id: string;
  timestamp: string;
  command: "PAUSE" | "RESUME" | "STOP" | "CANCEL" | "STEER";
  runId: string;
  runName: string;
  operatorContext: string;
  status: "pending" | "accepted" | "rejected" | "failed";
  previousState: OfficialSessionStatus;
  newState?: OfficialSessionStatus;
  details?: string;
  error?: string;
  statusCode?: number;
}

export type OperationalTimelineCategory =
  | "ALL"
  | "COMMANDS"
  | "STATE"
  | "EVENTS"
  | "ERRORS"
  | "FINDINGS";

export interface OperationalTimelineItem {
  id: string;
  timestamp: string;
  category: "COMMANDS" | "STATE" | "EVENTS" | "ERRORS" | "FINDINGS";
  title: string;
  description: string;
  badge?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}

export interface DestructiveConfirmationConfig {
  isOpen: boolean;
  operation: "STOP" | "CANCEL" | "TERMINATE";
  runId: string;
  runName: string;
  currentStatus: string;
  consequences: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export type ControlCenterView =
  | "dashboard"
  | "agents"
  | "sessions"
  | "targets"
  | "scans"
  | "tools"
  | "events"
  | "findings"
  | "reports"
  | "logs"
  | "settings"
  // Backward compatibility views
  | "overview"
  | "issues"
  | "history"
  | "email"
  | "feedback";

export interface StrixToolInfo {
  id: string;
  name: string;
  category: "recon" | "scanner" | "fuzzing" | "traffic" | "code_analysis" | "interface";
  description: string;
  binary: string;
  author: string;
  isGoTool: boolean;
  status: "ready" | "active" | "standby";
}

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export const STRIX_CATALOG_TOOLS: StrixToolInfo[] = [
  {
    id: "nuclei",
    name: "Nuclei",
    category: "scanner",
    description: "Fast and customizable vulnerability scanner based on simple YAML-based DSL templates.",
    binary: "nuclei",
    author: "ProjectDiscovery",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "katana",
    name: "Katana",
    category: "recon",
    description: "Next-generation crawling and spidering framework for web application security analysis.",
    binary: "katana",
    author: "ProjectDiscovery",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "httpx",
    name: "HTTPX",
    category: "recon",
    description: "Fast and multi-purpose HTTP toolkit for probing, banner grabbing, and status validation.",
    binary: "httpx",
    author: "ProjectDiscovery",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "naabu",
    name: "Naabu",
    category: "recon",
    description: "Fast port scanner written in Go with focused SYN/CONNECT network discovery.",
    binary: "naabu",
    author: "ProjectDiscovery",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "ffuf",
    name: "FFUF",
    category: "fuzzing",
    description: "Fast web fuzzer for directory discovery, virtual host routing, and parameter fuzzing.",
    binary: "ffuf",
    author: "ffuf",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "subfinder",
    name: "Subfinder",
    category: "recon",
    description: "Subdomain discovery tool that returns valid subdomains using passive online sources.",
    binary: "subfinder",
    author: "ProjectDiscovery",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "govulncheck",
    name: "Govulncheck",
    category: "code_analysis",
    description: "Official Go vulnerability scanner detecting known vulnerabilities in Go codebases.",
    binary: "govulncheck",
    author: "Go Security Team",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "interactsh-client",
    name: "Interactsh",
    category: "traffic",
    description: "OOB (Out-of-Band) interaction gathering client for blind SSRF, RCE, and XXE detection.",
    binary: "interactsh-client",
    author: "ProjectDiscovery",
    isGoTool: true,
    status: "ready",
  },
  {
    id: "strix-tui",
    name: "Strix TUI",
    category: "interface",
    description: "Terminal user interface sidecar binary with Bubble Tea and Lip Gloss ANSI rendering.",
    binary: "strix-tui",
    author: "Strix Core",
    isGoTool: true,
    status: "ready",
  },
];

/**
 * Gate UI-05 Types: Evidence Explorer, Findings Intelligence & Report Center
 */

export type OfficialFindingStatus =
  | "OPEN"
  | "CONFIRMED"
  | "DISMISSED"
  | "FIXED"
  | "UNKNOWN";

export type OfficialFindingSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFO";

export type EvidenceCategory =
  | "http_request"
  | "http_response"
  | "url"
  | "header"
  | "payload"
  | "screenshot"
  | "tool_output"
  | "console"
  | "agent_message"
  | "event"
  | "artifact"
  | "file";

export interface HttpRequestEvidence {
  method: string;
  url: string;
  headers?: Record<string, string>;
  parameters?: Record<string, string>;
  body?: string;
}

export interface HttpResponseEvidence {
  statusCode: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface EvidenceItem {
  id: string;
  type: EvidenceCategory;
  title: string;
  timestamp: string;
  source: string;
  agent?: string | null;
  tool?: string | null;
  target?: string | null;
  content: string;
  request?: HttpRequestEvidence | null;
  response?: HttpResponseEvidence | null;
  raw?: Record<string, unknown> | null;
}

export interface FindingTimelineEvent {
  id: string;
  timestamp: string;
  type:
    | "agent_started"
    | "target_discovered"
    | "tool_executed"
    | "response_received"
    | "finding_created"
    | "evidence_attached"
    | "state_changed";
  title: string;
  description: string;
  source: string;
  agentId?: string | null;
  toolName?: string | null;
  severity?: string | null;
}

export interface ReportMetadata {
  name: string;
  path: string;
  title: string;
  format: "markdown" | "sarif" | "json" | "csv" | "text";
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface SarifSummary {
  runs_count: number;
  results_count: number;
  rules_count: number;
  severity_counts: Record<string, number>;
  version: string;
}

export interface ReportFileDetail extends ReportMetadata {
  content?: string;
  data?: unknown;
  raw?: string;
  summary?: SarifSummary;
  error?: string;
  message?: string;
}

