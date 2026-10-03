"""Tool Manager and Go Tools management architecture for Strix.

Provides unified discovery, registration, resolution, version inspection,
and deterministic execution auditing for external security and auxiliary tools
(especially ProjectDiscovery / Go tools and the TUI sidecar).

Guarantees full compatibility with EmulatedSandbox (--dry-run), strictly avoids
shell=True or arbitrary command execution, and provides auditable ToolResult records.
"""

from __future__ import annotations

import functools
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from strix.config import load_settings


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ToolMetadata:
    """Metadata describing a tool's identity, requirements, and compatibility."""

    name: str
    binary: str
    category: str
    min_version: str | None = None
    description: str = ""
    is_go_tool: bool = True
    supported_os: tuple[str, ...] = ("linux", "darwin", "win32")

    def is_os_supported(self, platform_name: str | None = None) -> bool:
        current_os = (platform_name or os.name).lower()
        if current_os == "nt":
            current_os = "win32"
        return current_os in self.supported_os or "all" in self.supported_os


@dataclass
class ToolResult:
    """Standardized, auditable record of a tool's invocation."""

    tool_name: str
    tool_version: str | None = None
    execution_mode: str = "real"  # "real" or "emulated"
    runtime: str = "Host"  # "Host", "EmulatedSandbox", or "Docker"
    command: list[str] = field(default_factory=list)
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: float = 0.0
    timeout: bool = False
    success: bool = True
    failure_reason: str | None = None
    source: str = "system"  # "system" or "fixture"


@dataclass
class ToolDefinition:
    """Tool definition containing execution parameters, version probes, and fixtures."""

    metadata: ToolMetadata
    version_args: list[str] = field(default_factory=lambda: ["--version"])
    version_pattern: str | None = None
    simulated_output: str | None = None


class ToolResolver:
    """Resolves local tool binary paths safely across search paths and resources."""

    def __init__(self, extra_search_paths: list[Path] | None = None) -> None:
        self.extra_search_paths: list[Path] = [
            p.resolve() for p in (extra_search_paths or []) if p.is_dir()
        ]

    def resolve(self, binary_name: str) -> Path | None:
        """Resolve executable path, checking extra search paths before system PATH."""
        # 1. Check custom extra search paths
        for search_dir in self.extra_search_paths:
            candidate = search_dir / binary_name
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return candidate.resolve()
            if os.name == "nt" and not binary_name.lower().endswith(".exe"):
                candidate_exe = search_dir / f"{binary_name}.exe"
                if candidate_exe.is_file() and os.access(candidate_exe, os.X_OK):
                    return candidate_exe.resolve()

        # 2. Check system PATH via shutil.which
        resolved = shutil.which(binary_name)
        if resolved is not None:
            return Path(resolved).resolve()

        return None


class ToolManager:
    """Central registry and lifecycle manager for security and CLI tools."""

    def __init__(self, resolver: ToolResolver | None = None) -> None:
        self.resolver = resolver or ToolResolver()
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        """Register a tool definition."""
        self._tools[definition.metadata.name.lower()] = definition
        logger.debug("Registered tool in ToolManager: %s", definition.metadata.name)

    def get(self, name: str) -> ToolDefinition | None:
        """Retrieve a tool definition by name."""
        return self._tools.get(name.lower())

    def list_tools(self, category: str | None = None) -> list[ToolDefinition]:
        """List all registered tools, optionally filtered by category."""
        tools = list(self._tools.values())
        if category is not None:
            tools = [t for t in tools if t.metadata.category.lower() == category.lower()]
        return sorted(tools, key=lambda t: t.metadata.name)

    def is_available(self, name: str) -> bool:
        """Check if a tool's executable binary is available in the current environment."""
        definition = self.get(name)
        if definition is None:
            return False
        return self.resolver.resolve(definition.metadata.binary) is not None

    def resolve_binary_path(self, name: str) -> Path | None:
        """Return the resolved absolute Path to the tool's binary, or None."""
        definition = self.get(name)
        if definition is None:
            return None
        return self.resolver.resolve(definition.metadata.binary)

    def inspect_version(self, name: str, timeout: float = 5.0) -> str | None:
        """Execute the tool's version command safely to extract its installed version."""
        definition = self.get(name)
        if definition is None:
            return None

        # Check emulated mode
        if self._is_emulated_mode():
            return definition.metadata.min_version or "emulated"

        bin_path = self.resolver.resolve(definition.metadata.binary)
        if bin_path is None:
            return None

        cmd = [str(bin_path), *definition.version_args]
        try:
            res = subprocess.run(  # noqa: S603
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            raw = (res.stdout or res.stderr).strip()
            if definition.version_pattern:
                match = re.search(definition.version_pattern, raw)
                if match:
                    return match.group(1)
            # Default fallback: return first line or raw snippet
            return raw.splitlines()[0] if raw else None
        except (subprocess.SubprocessError, OSError) as exc:
            logger.warning("Failed to probe version for %s: %s", name, exc)
            return None

    def execute(
        self,
        name: str,
        args: list[str],
        *,
        cwd: Path | None = None,
        timeout: float = 60.0,
        emulated: bool | None = None,
    ) -> ToolResult:
        """Execute a tool with strict subprocess boundaries or deterministic emulation."""
        definition = self.get(name)
        if definition is None:
            return ToolResult(
                tool_name=name,
                exit_code=1,
                stderr=f"Unknown tool: {name}",
                success=False,
                failure_reason=f"Tool '{name}' is not registered in ToolManager",
            )

        run_emulated = emulated if emulated is not None else self._is_emulated_mode()

        if run_emulated:
            return self._execute_emulated(definition, args)

        bin_path = self.resolver.resolve(definition.metadata.binary)
        if bin_path is None:
            return ToolResult(
                tool_name=name,
                exit_code=127,
                stderr=f"Binary not found: {definition.metadata.binary}",
                success=False,
                failure_reason=f"Binary '{definition.metadata.binary}' is not available on PATH",
            )

        cmd = [str(bin_path), *args]
        start_time = time.perf_counter()

        try:
            completed = subprocess.run(  # noqa: S603
                cmd,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            return ToolResult(
                tool_name=name,
                tool_version=self.inspect_version(name),
                execution_mode="real",
                runtime="Host",
                command=cmd,
                exit_code=completed.returncode,
                stdout=completed.stdout,
                stderr=completed.stderr,
                duration_ms=duration_ms,
                timeout=False,
                success=(completed.returncode == 0),
                source="system",
            )
        except subprocess.TimeoutExpired as exc:
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            return ToolResult(
                tool_name=name,
                execution_mode="real",
                runtime="Host",
                command=cmd,
                exit_code=124,
                stdout=exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or ""),
                stderr=f"Tool execution timed out after {timeout}s",
                duration_ms=duration_ms,
                timeout=True,
                success=False,
                failure_reason=f"Execution timed out after {timeout} seconds",
                source="system",
            )
        except (subprocess.SubprocessError, OSError) as exc:
            duration_ms = (time.perf_counter() - start_time) * 1000.0
            return ToolResult(
                tool_name=name,
                execution_mode="real",
                runtime="Host",
                command=cmd,
                exit_code=1,
                stderr=str(exc),
                duration_ms=duration_ms,
                timeout=False,
                success=False,
                failure_reason=f"Subprocess launch failed: {exc}",
                source="system",
            )

    def _execute_emulated(self, definition: ToolDefinition, args: list[str]) -> ToolResult:
        """Return deterministic, synthetic execution record for emulated mode."""
        sim_output = definition.simulated_output or (
            f"[EMULATED SANDBOX - DRY RUN MODE]\n"
            f"Simulated tool: {definition.metadata.name}\n"
            f"Args: {' '.join(args)}\n"
        )
        return ToolResult(
            tool_name=definition.metadata.name,
            tool_version=definition.metadata.min_version or "emulated",
            execution_mode="emulated",
            runtime="EmulatedSandbox",
            command=[definition.metadata.binary, *args],
            exit_code=0,
            stdout=sim_output,
            stderr="",
            duration_ms=1.0,
            timeout=False,
            success=True,
            source="fixture",
        )

    @staticmethod
    def _is_emulated_mode() -> bool:
        return (
            os.environ.get("STRIX_RUNTIME_BACKEND") == "emulated"
            or load_settings().runtime.backend == "emulated"
        )


def build_default_tool_manager() -> ToolManager:
    """Construct and populate a ToolManager with Strix's canonical Go and security tools."""
    manager = ToolManager()

    tools = [
        ToolDefinition(
            metadata=ToolMetadata(
                name="nuclei",
                binary="nuclei",
                category="scanner",
                min_version="v3.0.0",
                description="Fast and customizable vulnerability scanner based on YAML DSL.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"Current nuclei Version:\s*([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "[INF] Current nuclei-templates version: v10.0.0 (emulated)\n"
                "[http-missing-security-headers:info] [http] [info] http://target/\n"
                "[tech-detect:apache] [http] [info] http://target/ [Apache/2.4.52]\n"
                "[cve-2023-xxxx:medium] [http] [medium] http://target/api/v1/status\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="httpx",
                binary="httpx",
                category="recon",
                min_version="v1.3.0",
                description="Fast and multi-purpose HTTP toolkit for probing and fingerprinting.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"httpx\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "http://target/api/v1/users [200 OK]\n"
                "http://target/api/v1/status [200 OK]\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="katana",
                binary="katana",
                category="crawler",
                min_version="v1.0.0",
                description="Next-generation web crawler and spider for endpoint discovery.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"katana\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "http://target/api/v1/login\n"
                "http://target/api/v1/users\n"
                "http://target/dashboard\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="naabu",
                binary="naabu",
                category="recon",
                min_version="v2.1.0",
                description="Fast SYN/CONNECT port scanner focused on reliability and simplicity.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"naabu\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "target:80\n"
                "target:443\n"
                "target:8080\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="ffuf",
                binary="ffuf",
                category="fuzzer",
                min_version="2.0.0",
                description="Fast web fuzzer in Go for discovering endpoints and parameters.",
                is_go_tool=True,
            ),
            version_args=["-V"],
            version_pattern=r"ffuf version:\s*([v\d\.\-a-z]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                ":: Method           : GET\n"
                ":: URL              : http://target/FUZZ\n"
                "api                     [Status: 301, Size: 178]\n"
                "login                   [Status: 200, Size: 2412]\n"
                "admin                   [Status: 403, Size: 280]\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="subfinder",
                binary="subfinder",
                category="recon",
                min_version="v2.6.0",
                description="Fast passive subdomain discovery tool for reconnaissance.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"subfinder\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "api.target.local\n"
                "dev.target.local\n"
                "admin.target.local\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="govulncheck",
                binary="govulncheck",
                category="scanner",
                min_version="v1.0.0",
                description="Go vulnerability checker analyzing Go source and dependencies.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"govulncheck\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "govulncheck: No vulnerabilities found.\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="interactsh-client",
                binary="interactsh-client",
                category="oob",
                min_version="v1.1.0",
                description="Out-of-band interaction client for detecting blind vulnerabilities.",
                is_go_tool=True,
            ),
            version_args=["-version"],
            version_pattern=r"interactsh-client\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "[INF] Client session started: xyz.interact.sh\n"
            ),
        ),
        ToolDefinition(
            metadata=ToolMetadata(
                name="strix-tui",
                binary="strix-tui.exe" if os.name == "nt" else "strix-tui",
                category="tui",
                min_version="1.0.0",
                description="Terminal User Interface sidecar written in Go using Bubble Tea.",
                is_go_tool=True,
            ),
            version_args=["--version"],
            version_pattern=r"strix-tui\s+([v\d\.]+)",
            simulated_output=(
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "strix-tui v1.6.2 (emulated)\n"
            ),
        ),
    ]

    for tool in tools:
        manager.register(tool)

    return manager


@functools.cache
def get_tool_manager() -> ToolManager:
    """Return the global cached default ToolManager instance."""
    return build_default_tool_manager()
