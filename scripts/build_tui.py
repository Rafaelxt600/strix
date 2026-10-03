# ruff: noqa: INP001
"""Cross-platform build script for Strix Go TUI sidecar.

Supports Windows, Linux, and macOS. Resolves the Go toolchain, validates
version requirements (Go 1.24+), compiles with deterministic flags (CGO_ENABLED=0,
-trimpath, -ldflags="-s -w"), and outputs to build/sidecar and optionally strix/bin.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


logger = logging.getLogger("build_tui")

MIN_GO_MAJOR = 1
MIN_GO_MINOR = 24


def get_project_root() -> Path:
    """Return the absolute path to the repository root."""
    return Path(__file__).resolve().parents[1]


def tui_executable_name() -> str:
    """Return the platform-specific executable name."""
    return "strix-tui.exe" if os.name == "nt" else "strix-tui"


def find_go_binary() -> Path | None:
    """Locate the Go binary from PATH or standard platform installation directories."""
    resolved = shutil.which("go")
    if resolved is not None:
        return Path(resolved).resolve()

    if os.name == "nt":
        candidates = [
            Path(r"C:\Program Files\Go\bin\go.exe"),
            Path(r"C:\Go\bin\go.exe"),
            Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\Go\bin\go.exe")),
            Path(os.path.expandvars(r"%USERPROFILE%\go\bin\go.exe")),
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate.resolve()

    return None


def get_go_version(go_bin: Path) -> tuple[int, int, str]:
    """Inspect Go toolchain version, returning (major, minor, raw_string)."""
    res = subprocess.run(  # noqa: S603
        [str(go_bin), "version"],
        capture_output=True,
        text=True,
        check=True,
    )
    raw = res.stdout.strip()
    match = re.search(r"go(\d+)\.(\d+)(?:\.(\d+))?", raw)
    if not match:
        raise ValueError(f"Unable to parse Go version output: '{raw}'")
    major = int(match.group(1))
    minor = int(match.group(2))
    return major, minor, raw


def _check_toolchain() -> tuple[Path | None, str]:
    go_bin = find_go_binary()
    if go_bin is None:
        return None, "Go toolchain not found on PATH or standard locations."
    try:
        major, minor, version_str = get_go_version(go_bin)
        if (major, minor) < (MIN_GO_MAJOR, MIN_GO_MINOR):
            return None, f"Go {MIN_GO_MAJOR}.{MIN_GO_MINOR}+ required. Found: {version_str}"
    except (subprocess.CalledProcessError, OSError, ValueError) as exc:
        return None, f"Failed to inspect Go version: {exc}"
    else:
        return go_bin, version_str


def sha256_file(path: Path) -> str:
    """Calculate the SHA256 checksum of a file."""
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_tui(
    output_path: Path | None = None,
    copy_to_bin: bool = False,
    go_binary: Path | None = None,
) -> tuple[Path, str, int]:
    """Compile the Strix Go TUI sidecar binary.

    Returns (output_path, sha256_digest, size_bytes).
    """
    root = get_project_root()
    tui_source_dir = root / "strix" / "interface" / "tui"

    if not (tui_source_dir / "go.mod").is_file():
        raise FileNotFoundError(f"Go TUI source directory missing go.mod: {tui_source_dir}")

    go_bin = go_binary or find_go_binary()
    if go_bin is None:
        raise RuntimeError(
            "Go compiler not found. Please install Go 1.24 or newer to build the TUI."
        )

    major, minor, version_str = get_go_version(go_bin)
    if (major, minor) < (MIN_GO_MAJOR, MIN_GO_MINOR):
        raise RuntimeError(f"Go {MIN_GO_MAJOR}.{MIN_GO_MINOR}+ is required. Found: {version_str}")

    exe_name = tui_executable_name()
    target_output = output_path or (root / "build" / "sidecar" / exe_name)
    target_output.parent.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["CGO_ENABLED"] = "0"

    cmd = [
        str(go_bin),
        "build",
        "-trimpath",
        "-ldflags=-s -w",
        "-o",
        str(target_output),
        "./cmd/strix-tui",
    ]

    subprocess.run(  # noqa: S603
        cmd,
        cwd=tui_source_dir,
        env=env,
        check=True,
    )

    if not target_output.is_file():
        raise FileNotFoundError(f"Build succeeded but binary was not created: {target_output}")

    if copy_to_bin:
        dest_bin = root / "strix" / "bin" / exe_name
        dest_bin.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target_output, dest_bin)

    digest = sha256_file(target_output)
    size = target_output.stat().st_size
    return target_output, digest, size


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Strix Go TUI sidecar binary.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Custom destination path for the compiled binary.",
    )
    parser.add_argument(
        "--copy-to-bin",
        action="store_true",
        help="Also copy the compiled binary to strix/bin/ for standalone wheel packaging.",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Check toolchain and source validity without building.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    go_bin, version_info = _check_toolchain()
    if go_bin is None:
        logger.error("❌ %s", version_info)
        return 1

    logger.info("Found Go compiler: %s (%s)", go_bin, version_info)
    if args.check_only:
        logger.info("✅ Toolchain and environment check passed.")
        return 0

    logger.info("🔨 Building Strix Go TUI sidecar...")
    try:
        output_path, digest, size = build_tui(
            output_path=args.output,
            copy_to_bin=args.copy_to_bin,
            go_binary=go_bin,
        )
    except subprocess.CalledProcessError as exc:
        logger.exception("❌ Build failed with exit code %d", exc.returncode)
        return exc.returncode
    except (RuntimeError, FileNotFoundError, OSError):
        logger.exception("❌ Build failed")
        return 1

    logger.info("✅ Successfully built: %s", output_path)
    logger.info("   Size: %.2f MB (%d bytes)", size / (1024 * 1024), size)
    logger.info("   SHA256: %s", digest)
    if args.copy_to_bin:
        mirrored = get_project_root() / "strix" / "bin" / tui_executable_name()
        logger.info("   Mirrored to: %s", mirrored)
    return 0


if __name__ == "__main__":
    sys.exit(main())
