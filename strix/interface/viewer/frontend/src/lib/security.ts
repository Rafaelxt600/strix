/**
 * Centralized Security & Secret Masking Module (Gate UI-05)
 *
 * Implements rigorous redaction of sensitive credentials, tokens, cookies,
 * and authentication payloads across findings, evidence, HTTP traffic,
 * agent logs, reports, and tool outputs.
 */

// Specific well-known API token signatures
const SENSITIVE_TOKEN_PATTERNS: RegExp[] = [
  // OpenAI, Anthropic, OpenRouter standard API keys
  /sk-[a-zA-Z0-9_\-]{15,}/gi,
  // GitHub Personal Access Tokens
  /gh[pousr]_[a-zA-Z0-9]{20,}/gi,
  // Slack Bot / User Tokens
  /xox[baprs]-[a-zA-Z0-9\-]{10,}/gi,
  // Google API Keys
  /AIza[0-9A-Za-z\-_]{35}/gi,
  // AWS Access Key ID
  /AKIA[0-9A-Z]{16}/g,
];

// RFC 7519 JSON Web Tokens (ey...)
const JWT_PATTERN = /ey[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+/g;

// Bearer authentication headers / tokens
const BEARER_PATTERN = /bearer\s+([a-zA-Z0-9_\-\.]+)/gi;

// Basic auth headers
const BASIC_AUTH_PATTERN = /authorization:\s*basic\s+[a-zA-Z0-9+/=]+/gi;

// HTTP Cookies
const COOKIE_PATTERN = /(?:Cookie|cookie|Set-Cookie):\s*([^\r\n;]+)/gi;

// URL embedded credentials: http(s)://user:password@host
const URL_CREDS_PATTERN = /(https?:\/\/)([^:/\s]+):([^@/\s]+)@/gi;

// Key-value credentials in JSON, YAML, key=value or config format
const KEY_VALUE_CRED_PATTERN =
  /(["']?(?:api[_\-]?key|access[_\-]?token|auth[_\-]?token|refresh[_\-]?token|secret|token|password|client[_\-]?secret|passwd|pwd)["']?\s*[:=]\s*["']?)([^"',\s\r\n}]+)(["']?)/gi;

// PEM Private Keys
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----/gi;

/**
 * Rigorously mask credentials, API keys, tokens, passwords and secrets
 * from any text payload (JSON, HTTP, logs, findings, evidence).
 */
export function maskSecrets(input?: string | null): string {
  if (!input) return "";

  let masked = String(input);

  // 1. Private Keys
  masked = masked.replace(PRIVATE_KEY_PATTERN, "[REDACTED_PRIVATE_KEY]");

  // 2. JWT Tokens
  masked = masked.replace(JWT_PATTERN, "[REDACTED_JWT]");

  // 3. Bearer Tokens
  masked = masked.replace(BEARER_PATTERN, "Bearer [REDACTED_BEARER]");

  // 4. Basic Auth
  masked = masked.replace(BASIC_AUTH_PATTERN, "Authorization: Basic [REDACTED_AUTH]");

  // 5. Cookies
  masked = masked.replace(COOKIE_PATTERN, (match) => {
    const isSet = match.toLowerCase().startsWith("set-cookie");
    return `${isSet ? "Set-Cookie" : "Cookie"}: [REDACTED_COOKIE]`;
  });

  // 6. Embedded URL credentials
  masked = masked.replace(URL_CREDS_PATTERN, "$1$2:[REDACTED_PASSWORD]@");

  // 7. Known Token Patterns (sk-, ghp_, xox-, AIza)
  for (const pattern of SENSITIVE_TOKEN_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const tail = match.slice(-4);
      return `[REDACTED_KEY_${tail}]`;
    });
  }

  // 8. Key-Value credential declarations
  masked = masked.replace(KEY_VALUE_CRED_PATTERN, (match, prefix, secret, suffix) => {
    // Avoid double-masking already redacted tokens
    if (secret.includes("[REDACTED")) {
      return match;
    }
    return `${prefix}[REDACTED_CREDENTIAL]${suffix}`;
  });

  return masked;
}

/**
 * Escapes HTML characters to prevent XSS injection in raw contexts.
 */
export function escapeHtml(text?: string | null): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
