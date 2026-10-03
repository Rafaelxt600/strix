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
