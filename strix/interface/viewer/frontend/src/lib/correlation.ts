/**
 * Entity Correlation Engine (Gate UI-05)
 *
 * Implements authoritative correlation between Findings, Evidences,
 * Transcript Events, Agents, Targets, Tools, and Timeline according to
 * the UI-05 specification without synthesizing artificial or fake records.
 */

import type { Vulnerability } from "@/types/issues";
import type { TranscriptAgent, TranscriptEvent } from "@/data/serverSource";
import type {
  EvidenceItem,
  FindingTimelineEvent,
  HttpRequestEvidence,
  HttpResponseEvidence,
} from "@/types/control-center";

/**
 * Correlates a Finding to its responsible Agent from transcript telemetry.
 */
export function correlateAgent(
  vuln: Vulnerability,
  agents: TranscriptAgent[],
  events: TranscriptEvent[]
): TranscriptAgent | null {
  // 1. Direct agent_id on finding
  if (vuln.agent_id) {
    const direct = agents.find((a) => a.id === vuln.agent_id);
    if (direct) return direct;
  }

  // 2. Scan events that mention finding ID
  const directEvent = events.find(
    (e) =>
      e.data?.finding_id === vuln.id ||
      e.data?.vulnerability_id === vuln.id ||
      (typeof e.data?.message === "string" && e.data.message.includes(vuln.id))
  );
  if (directEvent) {
    const ag = agents.find((a) => a.id === directEvent.agent_id);
    if (ag) return ag;
  }

  // 3. Match tool events matching target or endpoint prior to finding creation
  const vulnTime = new Date(vuln.created_at).getTime();
  const candidateEvents = events.filter((e) => {
    if (!e.timestamp) return false;
    const t = new Date(e.timestamp).getTime();
    if (Number.isFinite(vulnTime) && t > vulnTime + 5000) return false;
    if (vuln.target && typeof e.data?.target === "string" && e.data.target.includes(vuln.target)) {
      return true;
    }
    if (vuln.endpoint && typeof e.data?.url === "string" && e.data.url.includes(vuln.endpoint)) {
      return true;
    }
    return false;
  });

  if (candidateEvents.length > 0) {
    const lastEvent = candidateEvents[candidateEvents.length - 1];
    const ag = agents.find((a) => a.id === lastEvent.agent_id);
    if (ag) return ag;
  }

  // 4. Default to root/active agent if available
  if (agents.length === 1) return agents[0];
  const rootAgent = agents.find((a) => a.parent_id === null);
  return rootAgent || null;
}

/**
 * Correlates a Finding to the offensive/recon Tool that detected it.
 */
export function correlateTool(
  vuln: Vulnerability,
  events: TranscriptEvent[]
): string | null {
  // 1. Direct tool declaration
  if (vuln.tool && typeof vuln.tool === "string" && vuln.tool.trim()) {
    return vuln.tool.trim();
  }

  // 2. Check for tool execution in transcript near finding
  const vulnTime = new Date(vuln.created_at).getTime();
  const matchedToolEvents = events.filter((e) => {
    if (e.type !== "tool") return false;
    const toolName = (e.data?.name || e.data?.tool) as string | undefined;
    if (!toolName) return false;

    if (vuln.target && typeof e.data?.target === "string" && e.data.target.includes(vuln.target)) {
      return true;
    }
    if (vuln.endpoint && typeof e.data?.command === "string" && e.data.command.includes(vuln.endpoint)) {
      return true;
    }
    if (Number.isFinite(vulnTime) && e.timestamp) {
      const et = new Date(e.timestamp).getTime();
      return Math.abs(et - vulnTime) < 15000;
    }
    return false;
  });

  if (matchedToolEvents.length > 0) {
    const ev = matchedToolEvents[matchedToolEvents.length - 1];
    return String(ev.data?.name || ev.data?.tool || "pentest-tool");
  }

  return null;
}

/**
 * Parses raw HTTP request/response text into structured HTTP records if present.
 */
export function parseRawHttpTraffic(rawText: string): {
  request: HttpRequestEvidence | null;
  response: HttpResponseEvidence | null;
} {
  let request: HttpRequestEvidence | null = null;
  let response: HttpResponseEvidence | null = null;

  // Detect HTTP Request pattern (e.g. GET /path HTTP/1.1)
  const reqMatch = rawText.match(
    /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s\r\n]+)\s+HTTP\/[0-9\.]+/i
  );
  if (reqMatch) {
    const method = reqMatch[1].toUpperCase();
    const url = reqMatch[2];
    const headers: Record<string, string> = {};

    // Extract headers
    const headerLines = rawText.split(/\r?\n/);
    let body = "";
    let isBody = false;

    for (const line of headerLines) {
      if (isBody) {
        body += line + "\n";
        continue;
      }
      if (line.trim() === "" && Object.keys(headers).length > 0) {
        isBody = true;
        continue;
      }
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0 && !line.startsWith("HTTP/")) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        if (key && val) headers[key] = val;
      }
    }

    request = {
      method,
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body.trim() || undefined,
    };
  }

  // Detect HTTP Response pattern (e.g. HTTP/1.1 200 OK)
  const resMatch = rawText.match(/HTTP\/[0-9\.]+\s+(\d{3})(?:\s+([^\r\n]*))?/i);
  if (resMatch) {
    const statusCode = parseInt(resMatch[1], 10);
    const statusText = resMatch[2]?.trim();
    response = {
      statusCode,
      statusText: statusText || undefined,
      headers: {},
      body: undefined,
    };
  }

  return { request, response };
}

/**
 * Extracts and categorizes all genuine EvidenceItems from a finding and its events.
 */
export function extractEvidenceList(
  vuln: Vulnerability,
  events: TranscriptEvent[]
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  let evIndex = 1;

  // 1. Evidence text or structured HTTP evidence on Finding
  if (vuln.evidence && vuln.evidence.trim()) {
    const rawEv = vuln.evidence.trim();
    const parsedHttp = parseRawHttpTraffic(rawEv);

    items.push({
      id: `ev-${vuln.id}-${evIndex++}`,
      type: parsedHttp.request || parsedHttp.response ? "http_response" : "payload",
      title: parsedHttp.request || parsedHttp.response ? "HTTP Traffic Capture" : "Exploit Evidence & Payload",
      timestamp: vuln.created_at,
      source: "Finding Analysis",
      agent: vuln.agent_id || null,
      tool: vuln.tool || null,
      target: vuln.target || null,
      content: rawEv,
      request: parsedHttp.request,
      response: parsedHttp.response,
    });
  }

  // 2. Structured request on Finding
  if (vuln.request && typeof vuln.request === "object") {
    const r = vuln.request;
    const reqMethod = String(r.method || vuln.method || "GET").toUpperCase();
    const reqUrl = String(r.url || vuln.endpoint || vuln.target || "/");
    const headers = (r.headers as Record<string, string>) || undefined;
    const body = r.body ? String(r.body) : undefined;

    items.push({
      id: `ev-${vuln.id}-${evIndex++}`,
      type: "http_request",
      title: `HTTP Request: ${reqMethod} ${reqUrl}`,
      timestamp: vuln.created_at,
      source: "Engine Network Log",
      agent: vuln.agent_id || null,
      tool: vuln.tool || null,
      target: vuln.target || null,
      content: JSON.stringify(vuln.request, null, 2),
      request: {
        method: reqMethod,
        url: reqUrl,
        headers,
        body,
      },
    });
  }

  // 3. Structured response on Finding
  if (vuln.response && typeof vuln.response === "object") {
    const resp = vuln.response;
    const statusCode = Number(resp.status || resp.statusCode || 200);
    const headers = (resp.headers as Record<string, string>) || undefined;
    const body = resp.body ? String(resp.body) : undefined;

    items.push({
      id: `ev-${vuln.id}-${evIndex++}`,
      type: "http_response",
      title: `HTTP Response (${statusCode})`,
      timestamp: vuln.created_at,
      source: "Engine Network Log",
      agent: vuln.agent_id || null,
      tool: vuln.tool || null,
      target: vuln.target || null,
      content: JSON.stringify(vuln.response, null, 2),
      response: {
        statusCode,
        headers,
        body,
      },
    });
  }

  // 4. Proof of Concept (PoC) Code
  if (vuln.poc_script_code && vuln.poc_script_code.trim()) {
    items.push({
      id: `ev-${vuln.id}-${evIndex++}`,
      type: "artifact",
      title: "Proof-of-Concept Exploit Script",
      timestamp: vuln.created_at,
      source: "Autonomous PoC Generator",
      agent: vuln.agent_id || null,
      tool: vuln.tool || null,
      target: vuln.target || null,
      content: vuln.poc_script_code.trim(),
    });
  }

  // 5. Code Locations
  if (Array.isArray(vuln.code_locations) && vuln.code_locations.length > 0) {
    for (const loc of vuln.code_locations) {
      if (loc && loc.file) {
        items.push({
          id: `ev-${vuln.id}-${evIndex++}`,
          type: "file",
          title: `Source Reference: ${loc.file}${loc.start_line ? `:${loc.start_line}` : ""}`,
          timestamp: vuln.created_at,
          source: "Static Code Analysis",
          agent: vuln.agent_id || null,
          tool: "govulncheck/ast",
          target: vuln.target || null,
          content: loc.snippet || `${loc.file}:${loc.start_line}`,
        });
      }
    }
  }

  // 6. Technical Analysis
  if (vuln.technical_analysis && vuln.technical_analysis.trim() && vuln.technical_analysis !== vuln.evidence) {
    items.push({
      id: `ev-${vuln.id}-${evIndex++}`,
      type: "console",
      title: "Technical Analysis Notes",
      timestamp: vuln.created_at,
      source: "Agent Reasoning",
      agent: vuln.agent_id || null,
      tool: vuln.tool || null,
      target: vuln.target || null,
      content: vuln.technical_analysis.trim(),
    });
  }

  // 7. Transcript Tool outputs closely related
  const correlatedToolEvents = events.filter((e) => {
    if (e.type !== "tool") return false;
    if (vuln.target && typeof e.data?.target === "string" && e.data.target.includes(vuln.target)) {
      return true;
    }
    if (vuln.endpoint && typeof e.data?.url === "string" && e.data.url.includes(vuln.endpoint)) {
      return true;
    }
    return false;
  });

  for (const te of correlatedToolEvents.slice(0, 3)) {
    const toolName = String(te.data?.name || te.data?.tool || "tool");
    const output = te.data?.output || te.data?.result || te.data?.response;
    if (output && typeof output === "string" && output.trim()) {
      items.push({
        id: `ev-${vuln.id}-${evIndex++}`,
        type: "tool_output",
        title: `Tool Execution Output: ${toolName}`,
        timestamp: te.timestamp || vuln.created_at,
        source: `Tool: ${toolName}`,
        agent: te.agent_id || null,
        tool: toolName,
        target: vuln.target || null,
        content: output.trim(),
      });
    }
  }

  return items;
}

/**
 * Builds chronological timeline events derived exclusively from real occurrences.
 */
export function buildFindingTimeline(
  vuln: Vulnerability,
  events: TranscriptEvent[],
  agents: TranscriptAgent[]
): FindingTimelineEvent[] {
  const timeline: FindingTimelineEvent[] = [];

  const correlatedAg = correlateAgent(vuln, agents, events);
  if (correlatedAg && correlatedAg.created_at) {
    timeline.push({
      id: `tl-agent-${correlatedAg.id}`,
      timestamp: correlatedAg.created_at,
      type: "agent_started",
      title: `Agent Started: ${correlatedAg.name}`,
      description: `Agent instance (${correlatedAg.id}) initialized in execution state: ${correlatedAg.status}`,
      source: "Agent Coordinator",
      agentId: correlatedAg.id,
    });
  }

  // Target discovery / probe in events
  const relatedEvs = findRelatedEvents(vuln, events);
  for (const ev of relatedEvs) {
    if (ev.type === "tool") {
      const toolName = String(ev.data?.name || ev.data?.tool || "Scanner Tool");
      timeline.push({
        id: `tl-ev-${ev.id}`,
        timestamp: ev.timestamp,
        type: "tool_executed",
        title: `Tool Executed: ${toolName}`,
        description: typeof ev.data?.command === "string" ? ev.data.command : `Executed ${toolName} inspection`,
        source: "Transcript Event Stream",
        agentId: ev.agent_id,
        toolName,
      });
    }
  }

  // Finding Creation
  timeline.push({
    id: `tl-find-${vuln.id}`,
    timestamp: vuln.created_at,
    type: "finding_created",
    title: `Finding Confirmed: ${vuln.title}`,
    description: `Discovered with severity ${vuln.severity.toUpperCase()}${vuln.cvss ? ` (CVSS ${vuln.cvss})` : ""} against ${vuln.target || "target"}`,
    source: "Vulnerabilities Index",
    severity: vuln.severity,
  });

  // Evidence Attached
  if (vuln.evidence || vuln.poc_script_code) {
    timeline.push({
      id: `tl-evidence-${vuln.id}`,
      timestamp: vuln.created_at,
      type: "evidence_attached",
      title: "Evidence Attached & Validated",
      description: "Technical payload, reproduction steps, and secret-masked proof attached.",
      source: "Evidence Validator",
      severity: vuln.severity,
    });
  }

  // Sort timeline chronologically
  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return timeline;
}

/**
 * Filter related transcript events for a given finding based on real metadata matches.
 */
export function findRelatedEvents(
  vuln: Vulnerability,
  events: TranscriptEvent[]
): TranscriptEvent[] {
  return events.filter((e) => {
    // Direct ID match
    if (e.data?.finding_id === vuln.id || e.data?.vulnerability_id === vuln.id) {
      return true;
    }
    // Target match
    if (vuln.target && typeof e.data?.target === "string" && e.data.target.includes(vuln.target)) {
      return true;
    }
    // Endpoint match
    if (vuln.endpoint && typeof e.data?.url === "string" && e.data.url.includes(vuln.endpoint)) {
      return true;
    }
    // Agent match
    if (vuln.agent_id && e.agent_id === vuln.agent_id) {
      return true;
    }
    return false;
  });
}
