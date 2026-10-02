"""Emulated sandbox runtime backend for safe, deterministic simulation without Docker.

This runtime implements the `BaseSandboxSession` and `BaseSandboxClient` interfaces,
providing an isolated, local workspace and deterministic, synthetic responses for
common security and discovery tools (nmap, sqlmap, nuclei, semgrep, ffuf, etc.).
No real offensive tools or exploits are executed, and no external targets are contacted.
"""

from __future__ import annotations

import contextlib
import io
import logging
import shutil
import tarfile
import tempfile
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from agents.sandbox.session import BaseSandboxSession
from agents.sandbox.types import ExecResult, ExposedPortEndpoint


if TYPE_CHECKING:
    from agents.sandbox.manifest import Manifest
    from agents.sandbox.types import User


logger = logging.getLogger(__name__)

# Common workspace root matching the in-container path
_WORKSPACE_ROOT = "/workspace"


class EmulatedSandboxSession(BaseSandboxSession):
    """An isolated local session simulating sandbox tools deterministically."""

    def __init__(
        self,
        *,
        manifest: Manifest | None = None,
        bind_mounts: list[dict[str, Any]] | None = None,
        workspace_dir: Path | None = None,
    ) -> None:
        super().__init__()
        if workspace_dir is not None:
            self._temp_dir = None
            self.workspace_dir = Path(workspace_dir).resolve()
            self.workspace_dir.mkdir(parents=True, exist_ok=True)
        else:
            self._temp_dir = tempfile.TemporaryDirectory(prefix="strix-emulated-")
            self.workspace_dir = Path(self._temp_dir.name).resolve()

        self.workspace_path = self.workspace_dir
        self.id = f"emulated-session-{uuid.uuid4().hex[:8]}"
        self.manifest = manifest
        self.bind_mounts = bind_mounts or []
        self._running = True
        self.execution_log: list[dict[str, Any]] = []

        self._materialize_sources()

    def _materialize_sources(self) -> None:
        """Populate the emulated workspace directory with local sources if provided."""
        for mount in self.bind_mounts:
            src = mount.get("source")
            target = mount.get("target", "")
            if not src or not target:
                continue
            src_path = Path(src)
            if not src_path.exists():
                continue
            rel_target = target
            if rel_target.startswith(_WORKSPACE_ROOT):
                rel_target = rel_target[len(_WORKSPACE_ROOT) :].lstrip("/\\")
            dest_dir = self.workspace_dir / rel_target
            dest_dir.parent.mkdir(parents=True, exist_ok=True)
            if src_path.is_dir() and not dest_dir.exists():
                try:
                    shutil.copytree(
                        src_path,
                        dest_dir,
                        symlinks=True,
                        ignore_dangling_symlinks=True,
                    )
                except OSError as exc:
                    logger.warning("Emulated sandbox could not copy bind mount %s: %s", src, exc)
            elif src_path.is_file() and not dest_dir.exists():
                try:
                    shutil.copy2(src_path, dest_dir)
                except OSError as exc:
                    logger.warning("Emulated sandbox could not copy file mount %s: %s", src, exc)

    def _resolve_local_path(self, path: Path | str) -> Path:
        """Resolve a sandbox workspace path to the local directory with traversal protection."""
        s = str(path).replace("\\", "/")
        if s.startswith(_WORKSPACE_ROOT):
            rel = s[len(_WORKSPACE_ROOT) :].lstrip("/")
        elif s.startswith("/"):
            rel = s.lstrip("/")
        else:
            rel = s
        resolved = (self.workspace_dir / rel).resolve()
        if not resolved.is_relative_to(self.workspace_dir):
            raise PermissionError(f"Access denied: path escapes sandbox workspace ({path})")
        return resolved

    async def write(self, path: Path, data: io.IOBase, *, user: str | User | None = None) -> None:
        del user
        local_path = self._resolve_local_path(path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        content = data.read()
        if isinstance(content, str):
            content = content.encode()
        local_path.write_bytes(content)

    async def read(self, path: Path, *, user: str | User | None = None) -> io.IOBase:
        del user
        local_path = self._resolve_local_path(path)
        if not local_path.is_file():
            raise FileNotFoundError(f"File not found in emulated sandbox: {path}")
        return io.BytesIO(local_path.read_bytes())

    async def hydrate_workspace(self, data: io.IOBase) -> None:
        """Unpack tarball into emulated workspace."""
        content = data.read()
        if isinstance(content, str):
            content = content.encode()
        buffer = io.BytesIO(content)
        with tarfile.open(fileobj=buffer, mode="r:*") as archive:
            if hasattr(tarfile, "data_filter"):
                archive.extractall(path=self.workspace_dir, filter="data")
            else:
                archive.extractall(path=self.workspace_dir)  # noqa: S202

    async def persist_workspace(self) -> io.IOBase:
        """Archive emulated workspace into tar bytes."""
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for item in self.workspace_dir.iterdir():
                archive.add(item, arcname=item.name)
        buffer.seek(0)
        return buffer

    async def running(self) -> bool:
        return self._running

    def supports_pty(self) -> bool:
        return False

    def supports_docker_volume_mounts(self) -> bool:
        return True

    async def start(self) -> None:
        self._running = True

    async def stop(self) -> None:
        self._running = False

    async def shutdown(self) -> None:
        self._running = False
        if self._temp_dir is not None:
            with contextlib.suppress(Exception):
                self._temp_dir.cleanup()

    async def aclose(self) -> None:
        await self.shutdown()

    async def resolve_exposed_port(self, port: int) -> ExposedPortEndpoint:
        return ExposedPortEndpoint(host="127.0.0.1", port=port, tls=False)

    async def _exec_internal(
        self, *command: str | Path, timeout: float | None = None
    ) -> ExecResult:
        """Execute or simulate shell commands deterministically without real attacks."""
        del timeout
        # Determine command string
        cmd_tokens = [str(c) for c in command]
        if (
            len(cmd_tokens) >= 3
            and cmd_tokens[0] in ("sh", "bash")
            and cmd_tokens[1] in ("-c", "-lc")
        ):
            cmd_str = cmd_tokens[2]
        else:
            cmd_str = " ".join(cmd_tokens)

        cmd_str_clean = cmd_str.strip()
        self.execution_log.append({"command": cmd_str_clean, "timestamp": time.time()})
        logger.debug("[EmulatedSandbox] Executing: %s", cmd_str_clean)

        # 1. Archive extraction commands (e.g. extra files unpack)
        if "tar " in cmd_str_clean and ("-xf" in cmd_str_clean or "-x" in cmd_str_clean):
            return self._handle_tar_extract(cmd_str_clean)

        # 2. GraphQL probe for Caido guest login
        if "graphql" in cmd_str_clean and "LoginAsGuest" in cmd_str_clean:
            guest_resp = (
                b'{"data":{"loginAsGuest":{"token":{"accessToken":"emulated-guest-token"}}}}'
            )
            return ExecResult(stdout=guest_resp, stderr=b"", exit_code=0)

        # 3. Basic workspace file commands (pwd, ls, cat, find, mkdir)
        file_result = self._handle_file_command(cmd_str_clean)
        if file_result is not None:
            return file_result

        # 4. Simulated Security / Offensive Tools
        tool_result = self._handle_simulated_tools(cmd_str_clean)
        if tool_result is not None:
            return tool_result

        # Default fallback: safe acknowledgment
        ack_msg = (
            f"[EMULATED SANDBOX - DRY RUN MODE]\n"
            f"Simulated execution: {cmd_str_clean}\n"
            f"Exit code: 0\n"
        ).encode()
        return ExecResult(stdout=ack_msg, stderr=b"", exit_code=0)

    def _handle_tar_extract(self, cmd: str) -> ExecResult:
        """Handle unpack of extra files archive into workspace."""
        for part in cmd.split():
            if part.endswith(".tar"):
                archive_path = self._resolve_local_path(part)
                if archive_path.is_file():
                    try:
                        with tarfile.open(archive_path, mode="r:*") as archive:
                            if hasattr(tarfile, "data_filter"):
                                archive.extractall(path=self.workspace_dir, filter="data")
                            else:
                                archive.extractall(path=self.workspace_dir)  # noqa: S202
                        # Remove archive if asked
                        if "rm -f" in cmd:
                            with contextlib.suppress(Exception):
                                archive_path.unlink()
                        return ExecResult(stdout=b"", stderr=b"", exit_code=0)
                    except Exception as exc:  # noqa: BLE001
                        return ExecResult(
                            stdout=b"",
                            stderr=f"tar extraction failed: {exc}".encode(),
                            exit_code=1,
                        )
        return ExecResult(stdout=b"", stderr=b"", exit_code=0)

    def _handle_file_command(self, cmd: str) -> ExecResult | None:  # noqa: PLR0911
        """Handle safe local inspection commands."""
        parts = cmd.split()
        if not parts:
            return ExecResult(stdout=b"", stderr=b"", exit_code=0)

        prog = parts[0]

        if prog == "pwd":
            return ExecResult(stdout=b"/workspace\n", stderr=b"", exit_code=0)

        if prog in ("mkdir",):
            target = parts[-1]
            local_target = self._resolve_local_path(target)
            local_target.mkdir(parents=True, exist_ok=True)
            return ExecResult(stdout=b"", stderr=b"", exit_code=0)

        if prog == "cat" and len(parts) >= 2:
            target = parts[1]
            local_file = self._resolve_local_path(target)
            if local_file.is_file():
                return ExecResult(stdout=local_file.read_bytes(), stderr=b"", exit_code=0)
            return ExecResult(
                stdout=b"",
                stderr=f"cat: {target}: No such file or directory\n".encode(),
                exit_code=1,
            )

        if prog == "ls":
            target = (
                parts[-1]
                if len(parts) > 1 and not parts[-1].startswith("-")
                else "/workspace"
            )
            local_dir = self._resolve_local_path(target)
            if local_dir.is_dir():
                items = sorted(p.name for p in local_dir.iterdir())
                output_str = "\n".join(items) + "\n"
                return ExecResult(stdout=output_str.encode(), stderr=b"", exit_code=0)
            return ExecResult(stdout=b"", stderr=b"ls: directory not found\n", exit_code=1)

        return None

    def _handle_simulated_tools(self, cmd: str) -> ExecResult | None:  # noqa: PLR0911
        """Return deterministic, synthetic outputs for common offensive tools."""
        lower_cmd = cmd.lower()

        # Nmap / Naabu port scanner
        if lower_cmd.startswith(("nmap", "naabu")) or " nmap " in lower_cmd:
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "Starting Nmap 7.94 ( https://nmap.org ) at 2026-10-02\n"
                "Nmap scan report for target (emulated.local)\n"
                "Host is up (0.0010s latency).\n"
                "PORT     STATE SERVICE VERSION\n"
                "80/tcp   open  http    Apache httpd 2.4.52\n"
                "443/tcp  open  ssl/http Apache httpd 2.4.52\n"
                "8080/tcp open  http-proxy\n"
                "Nmap done: 1 IP address (1 host up) scanned in 0.04 seconds\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        # Nuclei vulnerability scanner
        if lower_cmd.startswith("nuclei") or " nuclei " in lower_cmd:
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "[INF] Current nuclei-templates version: v10.0.0 (emulated)\n"
                "[http-missing-security-headers:info] [http] [info] http://target/\n"
                "[tech-detect:apache] [http] [info] http://target/ [Apache/2.4.52]\n"
                "[cve-2023-xxxx:medium] [http] [medium] http://target/api/v1/status\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        # SQLMap
        if lower_cmd.startswith("sqlmap") or " sqlmap " in lower_cmd:
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "[*] starting @ 12:00:00 /2026-10-02/\n"
                "[INFO] testing connection to the target URL\n"
                "[INFO] checking if the target is protected by some kind of WAF/IPS\n"
                "[INFO] heuristic (basic) test shows that GET parameter 'id' might be injectable\n"
                "[INFO] parameter 'id' is vulnerable to boolean-based blind SQL injection\n"
                "[*] fetched tables: users, accounts, sessions\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        # FFUF / Dirsearch / Gobuster web fuzzer
        if any(tool in lower_cmd for tool in ("ffuf", "dirsearch", "gobuster")):
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                ":: Method           : GET\n"
                ":: URL              : http://target/FUZZ\n"
                "api                     [Status: 301, Size: 178, Words: 8, Lines: 7]\n"
                "login                   [Status: 200, Size: 2412, Words: 320, Lines: 45]\n"
                "admin                   [Status: 403, Size: 280, Words: 20, Lines: 10]\n"
                "robots.txt              [Status: 200, Size: 45, Words: 5, Lines: 3]\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        # Katana / Subfinder / Httpx / Arjun
        if any(tool in lower_cmd for tool in ("katana", "subfinder", "httpx", "arjun")):
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "http://target/api/v1/users\n"
                "http://target/api/v1/auth/login\n"
                "http://target/api/v1/status\n"
                "http://target/dashboard\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        # Semgrep / Bandit / SAST tools
        if any(tool in lower_cmd for tool in ("semgrep", "bandit", "trufflehog", "gitleaks")):
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "{\n"
                '  "results": [\n'
                "    {\n"
                '      "check_id": "emulated.rule.simulated-finding",\n'
                '      "path": "app.py",\n'
                '      "start": {"line": 10, "col": 1},\n'
                '      "extra": {\n'
                '        "message": "Simulated rule match for verification",\n'
                '        "severity": "INFO"\n'
                "      }\n"
                "    }\n"
                "  ]\n"
                "}\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        # Curl / Wget probes
        if lower_cmd.startswith(("curl", "wget")):
            output = (
                "[EMULATED SANDBOX - DRY RUN MODE]\n"
                "HTTP/1.1 200 OK\n"
                "Server: Apache/2.4.52\n"
                "Content-Type: text/html; charset=UTF-8\n"
                "\n"
                "<html><body><h1>Strix Emulated Target</h1></body></html>\n"
            )
            return ExecResult(stdout=output.encode(), stderr=b"", exit_code=0)

        return None


class EmulatedSandboxClient:
    """Mock sandbox client managing EmulatedSandboxSession lifecycles."""

    def __init__(self, workspace_dir: Path | None = None) -> None:
        self.workspace_dir = workspace_dir
        self.sessions: list[EmulatedSandboxSession] = []

    async def create(
        self,
        options: Any = None,
        manifest: Manifest | None = None,
        bind_mounts: list[dict[str, Any]] | None = None,
        name: str | None = None,
    ) -> EmulatedSandboxSession:
        del options, name
        session = EmulatedSandboxSession(
            manifest=manifest,
            bind_mounts=bind_mounts,
            workspace_dir=self.workspace_dir,
        )
        self.sessions.append(session)
        return session

    async def delete(self, session: EmulatedSandboxSession | str) -> None:
        target_session = None
        if isinstance(session, str):
            for s in self.sessions:
                if getattr(s, "id", None) == session:
                    target_session = s
                    break
        else:
            target_session = session

        if target_session is not None:
            if target_session in self.sessions:
                self.sessions.remove(target_session)
            await target_session.shutdown()
