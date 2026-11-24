"""pixel-agent-v2 NDJSON stdio protocol server with concurrent cancel & tool correlation."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Any, Optional

from . import PROTOCOL_VERSION, SUPPORTED_PROTOCOLS
from .budgets import IterationBudget
from .crash_log import install_panic_hook, record_crash
from .errors import AgentError
from .loop import run_agent_turn
from .multimodal import annotate_som_png_base64, assert_vision_capable_model, generate_image_artifact
from .providers import ProviderConfig
from .voice import exchange_gpt_live_sdp_offer, synthesize_cloud, transcribe_cloud

MAX_FRAME_BYTES = 4 * 1024 * 1024  # 4 MiB guard against unbounded frame memory


class _PendingToolWait:
    def __init__(self, request_id: str) -> None:
        self.request_id = request_id
        self.event = threading.Event()
        self.response: Optional[dict[str, Any]] = None


class PixelAgentProtocolServer:
    """Thread-safe NDJSON stdio server speaking pixel-agent-v2 (and v1 compat methods)."""

    def __init__(self, stdin: Any = None, stdout: Any = None) -> None:
        self._stdin = stdin or sys.stdin
        self._stdout = stdout or sys.stdout
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._active_turns: dict[str, threading.Event] = {}
        self._pending_tools: dict[str, _PendingToolWait] = {}
        self._shutting_down = False

    def send(self, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False) + "\n"
        with self._write_lock:
            self._stdout.write(encoded)
            self._stdout.flush()

    def _request_tool(self, request_id: str, call_id: str, name: str, args: dict[str, Any], timeout_s: float) -> dict[str, Any]:
        waiter = _PendingToolWait(request_id)
        with self._state_lock:
            cancel_ev = self._active_turns.get(request_id)
            if cancel_ev is None or cancel_ev.is_set():
                return {"ok": False, "content": "Turn was cancelled before tool execution."}
            self._pending_tools[call_id] = waiter

        self.send({
            "type": "tool.request",
            "requestId": request_id,
            "callId": call_id,
            "name": name,
            "args": args,
        })

        deadline = time.monotonic() + max(1.0, timeout_s)
        while not waiter.event.is_set():
            if cancel_ev.is_set():
                with self._state_lock:
                    self._pending_tools.pop(call_id, None)
                return {"ok": False, "content": "Tool request cancelled by user."}
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                with self._state_lock:
                    self._pending_tools.pop(call_id, None)
                return {"ok": False, "content": f"Timed out waiting for Electron tool execution ({name})."}
            waiter.event.wait(timeout=min(0.15, remaining))

        return waiter.response or {"ok": False, "content": "Empty tool response."}

    def _start_turn_worker(self, msg: dict[str, Any]) -> None:
        request_id = str(msg.get("requestId") or msg.get("id") or "")
        if not request_id:
            self.send({"type": "turn.error", "requestId": "", "error": AgentError("PROTOCOL_ERROR", "Missing requestId.").to_dict()})
            return

        client_protocol = msg.get("protocol")
        if client_protocol and client_protocol not in SUPPORTED_PROTOCOLS:
            self.send({
                "type": "turn.error",
                "requestId": request_id,
                "error": AgentError("VERSION_MISMATCH", f"Unsupported protocol '{client_protocol}'.").to_dict(),
            })
            return

        cancel_event = threading.Event()
        with self._state_lock:
            self._active_turns[request_id] = cancel_event

        params = msg.get("params") if isinstance(msg.get("params"), dict) else msg
        messages = params.get("messages") if isinstance(params.get("messages"), list) else []
        tools = params.get("tools") if isinstance(params.get("tools"), list) else []
        prov_raw = params.get("provider") if isinstance(params.get("provider"), dict) else {}
        budgets_raw = params.get("budgets") if isinstance(params.get("budgets"), dict) else {}

        provider_config = ProviderConfig(
            provider=str(prov_raw.get("provider") or "deepseek"),
            model=str(prov_raw.get("model") or "deepseek-flash"),
            base_url=str(prov_raw.get("baseUrl") or ""),
            api_key=prov_raw.get("apiKey") if isinstance(prov_raw.get("apiKey"), str) else None,
            temperature=float(prov_raw.get("temperature", 1.0)),
            max_tokens=int(prov_raw.get("maxTokens", 4096)),
            timeout_ms=int(prov_raw.get("timeoutMs", 60_000)),
            thinking=prov_raw.get("thinking") if isinstance(prov_raw.get("thinking"), dict) else None,
        )
        fallback_configs: list[ProviderConfig] = []
        raw_fallbacks = prov_raw.get("fallbacks")
        if isinstance(raw_fallbacks, list):
            for fb in raw_fallbacks:
                if not isinstance(fb, dict):
                    continue
                fb_model = str(fb.get("model") or "").strip()
                if not fb_model:
                    continue
                fallback_configs.append(
                    ProviderConfig(
                        provider=str(fb.get("provider") or "deepseek"),
                        model=fb_model,
                        base_url=str(fb.get("baseUrl") or ""),
                        api_key=fb.get("apiKey") if isinstance(fb.get("apiKey"), str) else None,
                        temperature=float(prov_raw.get("temperature", 1.0)),
                        max_tokens=int(prov_raw.get("maxTokens", 4096)),
                        timeout_ms=int(prov_raw.get("timeoutMs", 60_000)),
                        thinking=prov_raw.get("thinking") if isinstance(prov_raw.get("thinking"), dict) else None,
                    )
                )
        budget = IterationBudget(
            max_iterations=max(1, min(20, int(budgets_raw.get("maxIterations", 8)))),
            max_tool_calls=max(1, min(40, int(budgets_raw.get("maxToolCalls", 16)))),
            max_wall_ms=max(2_000, min(600_000, int(budgets_raw.get("maxWallMs", 300_000)))),
            max_context_tokens=max(2_048, int(budgets_raw.get("maxContextTokens", 32_000))),
        )
        tool_timeout_s = max(2.0, min(180.0, float(budgets_raw.get("toolTimeoutMs", 35_000)) / 1000.0))

        def _worker() -> None:
            try:
                run_agent_turn(
                    request_id=request_id,
                    messages=messages,
                    tools=tools,
                    provider_config=provider_config,
                    fallback_configs=fallback_configs,
                    budget=budget,
                    cancel_event=cancel_event,
                    emit=self.send,
                    request_tool_execution=lambda cid, nm, ag, ts: self._request_tool(request_id, cid, nm, ag, ts),
                    tool_timeout_s=tool_timeout_s,
                )
            except Exception as exc:
                record_crash("turn worker exception", type(exc), exc, exc.__traceback__)
                self.send({
                    "type": "turn.error",
                    "requestId": request_id,
                    "error": AgentError("UNKNOWN", "Python turn worker crashed unexpectedly.", detail=str(exc)).to_dict(),
                })
            finally:
                with self._state_lock:
                    self._active_turns.pop(request_id, None)
                    for cid, w in list(self._pending_tools.items()):
                        if w.request_id == request_id:
                            w.event.set()
                            self._pending_tools.pop(cid, None)

        threading.Thread(target=_worker, name=f"pixel-turn-{request_id}", daemon=True).start()

    def handle_message(self, msg: dict[str, Any]) -> bool:
        """Process one decoded NDJSON frame. Returns False on shutdown."""
        msg_type = str(msg.get("type") or msg.get("method") or "")
        req_id = str(msg.get("id") or msg.get("requestId") or "")
        params = msg.get("params") if isinstance(msg.get("params"), dict) else msg

        client_protocol = msg.get("protocol")
        if isinstance(client_protocol, str) and client_protocol and client_protocol not in SUPPORTED_PROTOCOLS:
            self.send({
                "id": req_id,
                "ok": False,
                "error": f"Unsupported protocol '{client_protocol}'. Supported: {', '.join(SUPPORTED_PROTOCOLS)}",
            })
            return True

        if msg_type == "ping":
            self.send({
                "id": req_id,
                "type": "pong",
                "ok": True,
                "result": {
                    "protocol": PROTOCOL_VERSION,
                    "supportedProtocols": list(SUPPORTED_PROTOCOLS),
                    "pid": os.getpid(),
                    "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                    "timestampMs": int(time.time() * 1000),
                    "authority": "main-process-broker",
                },
            })
            return True

        if msg_type == "turn.start":
            self._start_turn_worker(msg)
            return True

        if msg_type == "tool.response":
            call_id = str(params.get("callId") or "")
            with self._state_lock:
                waiter = self._pending_tools.pop(call_id, None)
            if waiter is not None:
                resp_payload: dict[str, Any] = {
                    "ok": bool(params.get("ok", False)),
                    "content": str(params.get("content", "")),
                    "denied": bool(params.get("denied", False)),
                }
                if isinstance(params.get("image"), dict):
                    resp_payload["image"] = params["image"]
                waiter.response = resp_payload
                waiter.event.set()
            return True

        if msg_type in ("turn.cancel", "cancel"):
            target_id = str(params.get("requestId") or params.get("targetId") or "")
            with self._state_lock:
                ev = self._active_turns.get(target_id)
                if ev is not None:
                    ev.set()
                for cid, w in list(self._pending_tools.items()):
                    if w.request_id == target_id:
                        w.response = {"ok": False, "content": "Cancelled by user."}
                        w.event.set()
                        self._pending_tools.pop(cid, None)
            if req_id:
                self.send({"id": req_id, "ok": True, "result": {"cancelled": target_id}})
            return True

        # Backward-compatible v1 helper methods
        if msg_type == "plan_turn":
            prompt = str(params.get("prompt", "")).strip()
            allowed_tools = [str(t) for t in params.get("allowedTools", []) if isinstance(t, str)]
            lower = prompt.lower()
            suggested: list[str] = []
            if any(k in lower for k in ("git ", "repository", "commit", "branch", "diff", "clone")):
                suggested = [t for t in allowed_tools if t.startswith("git_") or "github" in t][:6]
            elif any(k in lower for k in ("file", "folder", "read ", "search ")):
                suggested = [t for t in allowed_tools if t.startswith("file_") or t.startswith("documents_")][:6]
            self.send({
                "id": req_id,
                "ok": True,
                "result": {
                    "protocol": PROTOCOL_VERSION,
                    "mode": str(params.get("mode", "hybrid")),
                    "suggestedTools": suggested,
                    "requiresMainProcessAuthorization": True,
                },
            })
            return True

        if msg_type == "score_memory":
            text = str(params.get("text", "")).strip()
            existing = [str(x).lower().strip() for x in params.get("existing", []) if isinstance(x, str)]
            if not text or text.endswith("?"):
                res = {"keep": False, "score": 0.1, "reason": "question-or-empty"}
            elif text.lower().strip() in existing:
                res = {"keep": False, "score": 0.0, "reason": "duplicate"}
            else:
                durable = any(kw in text.lower() for kw in ("prefer", "always use", "project uses", "remember", "workflow", "correction"))
                score = 0.88 if durable else 0.35
                res = {"keep": score >= 0.65, "score": score, "reason": "durable-signal" if durable else "low-relevance"}
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "voice.transcribe":
            res = transcribe_cloud(
                provider=str(params.get("provider") or "openai"),
                wav_base64=str(params.get("wavBase64") or ""),
                api_key=str(params.get("apiKey") or ""),
                model=str(params.get("model") or ""),
                language=str(params.get("language") or "auto"),
                base_url=str(params.get("baseUrl") or ""),
                local_only=bool(params.get("localOnly", False)),
                timeout_s=float(params.get("timeoutSec", 30.0)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "voice.synthesize":
            res = synthesize_cloud(
                provider=str(params.get("provider") or "openai"),
                text=str(params.get("text") or ""),
                api_key=str(params.get("apiKey") or ""),
                voice=str(params.get("voice") or ""),
                model=str(params.get("model") or ""),
                speed=float(params.get("speed", 1.0)),
                base_url=str(params.get("baseUrl") or ""),
                local_only=bool(params.get("localOnly", False)),
                timeout_s=float(params.get("timeoutSec", 30.0)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "voice.gpt_live_sdp":
            res = exchange_gpt_live_sdp_offer(
                sdp_offer=str(params.get("sdpOffer") or ""),
                api_key=str(params.get("apiKey") or ""),
                model=str(params.get("model") or "gpt-realtime"),
                voice=str(params.get("voice") or "marin"),
                instructions=str(params.get("instructions") or ""),
                base_url=str(params.get("baseUrl") or "https://api.openai.com/v1"),
                local_only=bool(params.get("localOnly", False)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "multimodal.annotate_som":
            try:
                res = annotate_som_png_base64(
                    str(params.get("pngBase64") or ""),
                    params.get("elements") if isinstance(params.get("elements"), list) else [],
                    params.get("windowBounds") if isinstance(params.get("windowBounds"), dict) else None,
                )
                self.send({"id": req_id, "ok": True, "result": res})
            except Exception as exc:
                self.send({"id": req_id, "ok": True, "result": {"ok": False, "error": str(exc)}})
            return True

        if msg_type == "multimodal.generate_image":
            res = generate_image_artifact(
                prompt=str(params.get("prompt") or ""),
                provider=str(params.get("provider") or "openai"),
                api_key=str(params.get("apiKey") or ""),
                output_dir=str(params.get("outputDir") or ""),
                model=str(params.get("model") or ""),
                size=str(params.get("size") or "1024x1024"),
                base_url=str(params.get("baseUrl") or ""),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "multimodal.check_vision":
            res = assert_vision_capable_model(str(params.get("model") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "runtime.diagnostics":
            with self._state_lock:
                active_ids = list(self._active_turns.keys())
            self.send({
                "id": req_id,
                "ok": True,
                "result": {
                    "runtime": "python",
                    "protocol": PROTOCOL_VERSION,
                    "pid": os.getpid(),
                    "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                    "activeTurnIds": active_ids,
                    "capabilities": {
                        "concurrentTurns": True,
                        "multimodalToolAttachments": True,
                        "somPngAnnotation": True,
                        "cloudVoiceRouting": True,
                        "gptLiveSdpBroker": True,
                        "imageGeneration": True,
                    },
                },
            })
            return True

        if msg_type == "shutdown":
            self._shutting_down = True
            with self._state_lock:
                for ev in self._active_turns.values():
                    ev.set()
            self.send({"id": req_id, "ok": True, "result": {"shuttingDown": True}})
            return False

        self.send({"id": req_id, "ok": False, "error": f"unknown-method:{msg_type}"})
        return True

    def serve_forever(self) -> int:
        install_panic_hook()
        for raw_line in self._stdin:
            if len(raw_line.encode("utf-8", errors="ignore")) > MAX_FRAME_BYTES:
                self.send({"id": None, "ok": False, "error": "frame-too-large"})
                continue
            line = raw_line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                self.send({"id": None, "ok": False, "error": "invalid-json"})
                continue
            if not isinstance(msg, dict):
                self.send({"id": None, "ok": False, "error": "invalid-frame"})
                continue
            if not self.handle_message(msg):
                break
        return 0
