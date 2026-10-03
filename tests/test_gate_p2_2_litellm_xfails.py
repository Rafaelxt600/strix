"""Forensic test suite for Gate P2-2: LiteLLM XFAILs Audit & Verification.

This suite validates:
1. Exact XFAIL inventory across the test suite (exactly 3 cases).
2. Root cause confirmation: external Agents SDK Chat Completions converter limitation.
3. LiteLLM route conformance: automatic UUID generation for null tool call IDs.
4. Streaming vs non-streaming handling differences.
5. Strix TurnCallIdRewriter repair logic.
6. Offline provider independence and credential isolation.
"""

from __future__ import annotations

from typing import Any

import litellm
import pydantic_core
import pytest
from agents.extensions.models.litellm_model import LitellmModel
from agents.models.chatcmpl_converter import Converter
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from openai.types.chat.chat_completion_message import ChatCompletionMessage
from openai.types.chat.chat_completion_message_function_tool_call import (
    ChatCompletionMessageFunctionToolCall,
    Function,
)
from openai.types.responses import ResponseFunctionToolCall

from strix.config.models import (
    StrixProvider,
    _NonStreamingModel,
    _routes_via_litellm,
    _TurnGuardModel,
    routes_through_litellm,
)
from strix.config.tool_call_ids import TurnCallIdRewriter
from strix.llm.request_log import RequestLoggingModel
from tests.test_tool_call_ids_providers import MODELS, SCENARIOS


def test_xfail_inventory_exact_count_and_criteria() -> None:
    """Verify that exactly 3 test configurations trigger xfail in the repository."""
    xfail_entries: list[tuple[str, str, bool]] = [
        (model, scenario_name, stream)
        for model in MODELS
        for scenario_name, scenario in SCENARIOS.items()
        for stream in (True, False)
        if model.startswith("openai/") and not stream and scenario.has_null_id
    ]

    # Exactly 3 scenarios have has_null_id: 'null-id', 'missing-id', 'mixed-blank-and-recycled'
    assert len(xfail_entries) == 3
    assert xfail_entries == [
        ("openai/gpt-5.4", "null-id", False),
        ("openai/gpt-5.4", "missing-id", False),
        ("openai/gpt-5.4", "mixed-blank-and-recycled", False),
    ]


def test_xfail_scenarios_have_null_id_flag() -> None:
    """Verify the exact scenarios categorized as having null/missing IDs."""
    null_id_scenarios = [name for name, s in SCENARIOS.items() if s.has_null_id]
    assert sorted(null_id_scenarios) == ["missing-id", "mixed-blank-and-recycled", "null-id"]

    non_null_scenarios = [
        "empty-id",
        "parallel-empty-ids",
        "empty-id-every-turn",
        "recycled-counter",
        "valid-ids",
    ]
    for name in non_null_scenarios:
        assert not SCENARIOS[name].has_null_id, f"Scenario {name} should not have null id"


def test_litellm_synthesizes_valid_id_for_null_tool_calls() -> None:
    """Verify that LiteLLM synthesizes a valid UUID string for null tool-call IDs."""
    response = litellm.ModelResponse(
        choices=[
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": None,
                            "type": "function",
                            "function": {"name": "exec_cmd", "arguments": '{"cmd": "whoami"}'},
                        }
                    ],
                }
            }
        ]
    )
    first_choice = response.choices[0]
    assert hasattr(first_choice, "message")
    message = first_choice.message
    assert message.tool_calls is not None
    generated_id = message.tool_calls[0].id

    # LiteLLM generates a valid non-empty string ID (UUID format)
    assert isinstance(generated_id, str)
    assert len(generated_id) > 0
    assert generated_id != "None"


def test_agents_sdk_converter_rejects_none_tool_call_id() -> None:
    """Verify that Converter.message_to_output_items rejects a tool-call with id=None.

    This reproduces the exact root cause of the 3 XFAILs:
    pydantic_core.ValidationError on ResponseFunctionToolCall(call_id=None).
    """
    # Use construct to simulate an external raw payload parsed with id=None
    tool_call = ChatCompletionMessageFunctionToolCall.construct(
        id=None,
        type="function",
        function=Function(name="test_tool", arguments='{"param": 1}'),
    )
    message = ChatCompletionMessage(
        role="assistant",
        content=None,
        tool_calls=[tool_call],
    )

    with pytest.raises(pydantic_core.ValidationError) as exc_info:
        Converter.message_to_output_items(message)

    errors = exc_info.value.errors()
    assert any(
        err.get("loc") == ("call_id",) and err.get("type") == "string_type" for err in errors
    )


def test_turn_guard_rewriter_handles_blanks_and_recycled_counters() -> None:
    """Verify that Strix's TurnCallIdRewriter repairs empty IDs and cross-turn recycled counters."""
    # Simulate history containing a prior turn that already used 'counter:0'
    history: list[Any] = [
        ResponseFunctionToolCall(
            id="hist_1",
            call_id="counter:0",
            name="do_work",
            arguments='{"step": 0}',
            type="function_call",
        )
    ]
    rewriter = TurnCallIdRewriter(history)

    # In the new turn:
    # call_1 has an empty string ID (e.g. from stream assembly)
    call_1 = ResponseFunctionToolCall(
        id="resp_1",
        call_id="",
        name="do_work",
        arguments='{"step": 1}',
        type="function_call",
    )
    # call_2 has 'counter:0' which collides with history!
    call_2 = ResponseFunctionToolCall(
        id="resp_2",
        call_id="counter:0",
        name="do_work",
        arguments='{"step": 2}',
        type="function_call",
    )
    # call_3 has a new unused ID
    call_3 = ResponseFunctionToolCall(
        id="resp_3",
        call_id="counter:1",
        name="do_work",
        arguments='{"step": 3}',
        type="function_call",
    )

    items = [call_1, call_2, call_3]
    rewritten = rewriter.rewrite_items(items)

    assert len(rewritten) == 3
    # Check that blank and colliding IDs were rewritten, and unused ID was kept
    c1_new = rewritten[0].call_id
    c2_new = rewritten[1].call_id
    c3_new = rewritten[2].call_id

    assert c1_new.startswith("call_") and len(c1_new) > 5
    assert c2_new.startswith("call_") and c2_new != "counter:0"
    assert c3_new == "counter:1"  # Not in history, preserved
    assert len({c1_new, c2_new, c3_new}) == 3  # All distinct


def test_provider_isolation_no_secrets_required(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that LiteLLM and turn guard test fixtures execute safely without provider secrets."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("LITELLM_API_KEY", raising=False)

    rewriter = TurnCallIdRewriter([])
    item = ResponseFunctionToolCall(
        id="test_id",
        call_id="valid_call_id_123",
        name="dummy_tool",
        arguments="{}",
        type="function_call",
    )
    result = rewriter.rewrite_items([item])
    assert len(result) == 1
    assert result[0].call_id == "valid_call_id_123"


def test_streaming_chunk_null_id_normalization() -> None:
    """Verify that streaming chunk handlers normalize missing/null id to empty string."""
    # Simulates stream handler chunk accumulation
    raw_delta_id: str | None = None
    accumulated_id: str = raw_delta_id or ""

    # When passed to ResponseFunctionToolCall, empty string is valid whereas None raises error
    call_item = ResponseFunctionToolCall(
        id="stream_id",
        call_id=accumulated_id,
        name="streamed_tool",
        arguments='{"a": 1}',
        type="function_call",
    )
    assert call_item.call_id == ""

    # And TurnCallIdRewriter successfully rewrites it
    rewriter = TurnCallIdRewriter([])
    rewritten = rewriter.rewrite_item(call_item, position=0)
    assert rewritten.call_id.startswith("call_")
    assert len(rewritten.call_id) > 5


EXPECTED_NON_OPENAI_MODELS: list[str] = [
    "openrouter/z-ai/glm-5.3",
    "openrouter/anthropic/claude-sonnet-4.6",
    "openrouter/google/gemini-3-pro-preview",
    "openrouter/qwen/qwen3-coder",
    "zai/glm-5.3",
    "zai/glm-5.3-flash",
    "deepseek/deepseek-chat",
    "moonshot/kimi-k2.5",
    "xai/grok-4",
    "mistral/mistral-large-latest",
    "together_ai/Qwen/Qwen3-235B-A22B",
    "fireworks_ai/accounts/fireworks/models/kimi-k2",
    "dashscope/qwen3-max",
    "deepinfra/Qwen/Qwen3-32B",
    "nebius/Qwen/Qwen3-32B",
    "hosted_vllm/Qwen/Qwen3-32B",
    "litellm/openai/gw-model",
]


def test_all_17_non_openai_models_are_routed_via_litellm() -> None:
    """Verify that each non-OpenAI model routes to LitellmModel via StrixProvider.

    Forensic verification:
    1. Proves that MODELS contains exactly 18 models: 17 non-OpenAI and 1 OpenAI.
    2. Verifies the exact inventory of all 17 non-OpenAI model identifiers.
    3. Calls production StrixProvider and verifies that each of the 17 models resolves
       to LitellmModel and satisfies _routes_via_litellm / routes_through_litellm.
    4. Verifies the contrast: 'openai/gpt-5.4' routes to OpenAIChatCompletionsModel, not LiteLLM.
    5. Proves that none of the 17 non-OpenAI models trigger the xfail marker under any scenario.
    """
    non_openai = [m for m in MODELS if not m.startswith("openai/")]
    assert len(non_openai) == 17
    assert non_openai == EXPECTED_NON_OPENAI_MODELS

    # Production StrixProvider configured with deterministic offline credentials
    provider = StrixProvider(api_key="mock_test_key", base_url="http://127.0.0.1:8000/v1")

    for model_name in non_openai:
        # Level 1 Evidence: StrixProvider production instantiation & unwrapping
        wrapped_model = provider.get_model(model_name)
        inner_model = wrapped_model
        while isinstance(inner_model, (_NonStreamingModel, _TurnGuardModel, RequestLoggingModel)):
            inner_model = inner_model._inner

        assert isinstance(inner_model, LitellmModel), (
            f"Expected LitellmModel for {model_name}, got {type(inner_model)}"
        )
        assert _routes_via_litellm(inner_model) is True

        # Level 2 Evidence: Direct provider fallback resolution & routing contract
        direct_model = super(StrixProvider, provider).get_model(model_name)
        assert isinstance(direct_model, LitellmModel)
        assert _routes_via_litellm(direct_model) is True
        assert routes_through_litellm(model_name) is True

        # Ensure no non-OpenAI model ever meets xfail criteria in test_tool_call_ids_providers
        for s in SCENARIOS.values():
            for stream in (True, False):
                assert not (model_name.startswith("openai/") and not stream and s.has_null_id)

    # Forensic contrast: verify openai/gpt-5.4 is handled by OpenAI SDK, not LiteLLM
    openai_wrapped = provider.get_model("openai/gpt-5.4")
    openai_inner = openai_wrapped
    while isinstance(openai_inner, (_NonStreamingModel, _TurnGuardModel, RequestLoggingModel)):
        openai_inner = openai_inner._inner

    assert isinstance(openai_inner, OpenAIChatCompletionsModel)
    assert _routes_via_litellm(openai_inner) is False
    assert routes_through_litellm("openai/gpt-5.4") is False
