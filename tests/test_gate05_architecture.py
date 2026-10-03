"""Tests for Gate 05: Architectural validation of Agent Graph coordination,
SQLite session persistence, and ToolManager integration.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from strix.core.agents import AgentCoordinator
from strix.core.sessions import open_agent_session, seed_initial_input
from strix.tools.manager import get_tool_manager


if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.asyncio
async def test_agent_coordinator_lifecycle() -> None:
    coordinator = AgentCoordinator()

    # 1. Register root agent
    await coordinator.register("root", "strix", parent_id=None, task="Main pentest orchestrator")
    assert coordinator.statuses["root"] == "running"
    assert coordinator.parent_of["root"] is None
    assert coordinator.names["root"] == "strix"

    # 2. Register child agent
    await coordinator.register(
        "child-1", "Validator", parent_id="root", task="Vulnerability verification"
    )
    assert coordinator.statuses["child-1"] == "running"
    assert coordinator.parent_of["child-1"] == "root"
    assert coordinator.names["child-1"] == "Validator"

    # 3. Active agents hierarchy query
    active = await coordinator.active_agents_except("root")
    assert len(active) == 1
    assert active[0]["agent_id"] == "child-1"
    assert active[0]["parent_id"] == "root"

    # 4. State transitions: Park waiting & mark running
    await coordinator.park_waiting("child-1", wait_kind="agents")
    assert coordinator.statuses["child-1"] == "waiting"
    assert await coordinator.wait_kind_of("child-1") == "agents"

    await coordinator.mark_running("child-1")
    assert coordinator.statuses["child-1"] == "running"
    assert await coordinator.wait_kind_of("child-1") is None

    # 5. Inter-agent communication
    sent = await coordinator.send(
        "child-1", {"from": "root", "type": "task", "content": "Verify SQLi"}
    )
    assert sent is True
    assert coordinator.pending_counts["child-1"] == 1

    # 6. Graph snapshot contract
    parent_map, status_map, name_map, err_map = await coordinator.graph_snapshot()
    assert parent_map["root"] is None
    assert parent_map["child-1"] == "root"
    assert status_map["root"] == "running"
    assert status_map["child-1"] == "running"
    assert name_map["root"] == "strix"
    assert name_map["child-1"] == "Validator"
    assert err_map == {}

    # 7. Request stop and terminal states
    await coordinator.request_stop("child-1")
    assert coordinator.statuses["child-1"] == "stopped"


@pytest.mark.asyncio
async def test_agent_coordinator_negative_scenarios() -> None:
    coordinator = AgentCoordinator()

    # Querying nonexistent agent status & reachability
    assert coordinator.statuses.get("nonexistent") is None
    reachable, status = await coordinator.reachability("nonexistent")
    assert reachable is False
    assert status is None

    # Sending message to nonexistent agent drops gracefully
    sent = await coordinator.send("nonexistent", {"from": "root", "content": "ping"})
    assert sent is False

    # Setting status on nonexistent agent is a safe no-op
    await coordinator.set_status("nonexistent", "completed")
    assert "nonexistent" not in coordinator.statuses


@pytest.mark.asyncio
async def test_sqlite_session_persistence(tmp_path: Path) -> None:
    db_file = tmp_path / "sessions.db"
    agent_id = "agent-arch-01"

    # 1. Create session backed by SQLite database file
    session = open_agent_session(agent_id, db_file)
    assert session is not None
    assert session.session_id == agent_id

    # 2. Seed initial input asynchronously
    seeded = await seed_initial_input(session, "Initial mission directive for agent")
    assert seeded is True

    # 3. Subsequent seed returns False (idempotent / non-destructive)
    seeded_again = await seed_initial_input(session, "Different directive")
    assert seeded_again is False

    # 4. Verify DB file creation on disk
    assert db_file.exists()
    assert db_file.stat().st_size > 0

    # 5. Reopen session from same SQLite DB and verify items preserved
    session_reopened = open_agent_session(agent_id, db_file)
    items = await session_reopened.get_items()
    assert len(items) > 0


def test_tool_manager_architecture_contract() -> None:
    manager = get_tool_manager()
    assert manager is not None

    # Validate essential security tools catalogued
    tools = {t.metadata.name: t for t in manager.list_tools()}
    assert "nuclei" in tools
    assert "httpx" in tools
    assert "katana" in tools
    assert "naabu" in tools
    assert "ffuf" in tools
    assert "subfinder" in tools
    assert "strix-tui" in tools

    # All tools have valid OS support definition
    for t in tools.values():
        assert t.metadata.is_os_supported("linux") is True
        assert t.metadata.is_os_supported("win32") is True


def test_agent_graph_and_tool_manager_coexistence() -> None:
    # Verifies that agent graph coordinator operates cleanly with tool manager catalog
    coordinator = AgentCoordinator()
    manager = get_tool_manager()

    assert coordinator is not None
    assert manager is not None
    assert len(manager.list_tools()) >= 9
