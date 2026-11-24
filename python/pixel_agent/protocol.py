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
from .gateway import GatewayService
from .loop import run_agent_turn
from .multimodal import annotate_som_png_base64, assert_vision_capable_model, generate_image_artifact
from .plugin_manager import PluginManager
from .providers import ProviderConfig
from .voice import exchange_gpt_live_sdp_offer, synthesize_cloud, transcribe_cloud
from .workspace_services import WorkspaceServices

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
        self._plugins: Optional[PluginManager] = None
        self._gateway: Optional[GatewayService] = None
        self._workspace: Optional[WorkspaceServices] = None
        self._gateway_provider_config: Optional[ProviderConfig] = None
        self._gateway_tools: list[dict[str, Any]] = []

    def _plugin_manager(self) -> PluginManager:
        if self._plugins is None:
            self._plugins = PluginManager()
        return self._plugins

    def _workspace_services(self) -> WorkspaceServices:
        if self._workspace is None:
            self._workspace = WorkspaceServices()
        return self._workspace

    def _dispatch_gateway_turn(self, turn_input: dict[str, Any]) -> dict[str, Any]:
        """Production Gateway -> primary Python `run_agent_turn` dispatcher."""
        project_id = str(turn_input.get("projectId") or "default")
        if self._gateway_provider_config is None:
            return {
                "ok": False,
                "content": f"No model provider configured for remote gateway execution (project={project_id}). Configure a provider in Pixel Settings.",
            }
        req_id = f"gw_{int(time.time() * 1000)}_{os.getpid()}"
        cancel_ev = threading.Event()
        with self._state_lock:
            self._active_turns[req_id] = cancel_ev
        try:
            pm = self._plugin_manager()
            raw_allowed = turn_input.get("allowedTools")
            explicit_allowlist = [str(x) for x in raw_allowed] if isinstance(raw_allowed, list) else []
            effective_tools = pm.filter_tools(self._gateway_tools, explicit_allowlist=explicit_allowlist)
            msg_obj = turn_input.get("message") if isinstance(turn_input.get("message"), dict) else {}
            user_text = str(msg_obj.get("text") or "").strip()
            active_profile = self._workspace_services().get_active_profile()
            profile_instructions = str(active_profile.get("instructions") or "").strip()
            system_parts = [
                f"You are Pixel answering an authorized remote request for project '{project_id}' (profile '{active_profile.get('name', 'Default')}')."
            ]
            if profile_instructions:
                system_parts.append(f"Active profile instructions:\n{profile_instructions}")
            messages = [
                {"role": "system", "content": "\n\n".join(system_parts)},
                {"role": "user", "content": user_text},
            ]
            effective_provider_config = self._gateway_provider_config
            prov_override = str(active_profile.get("providerOverride") or "").strip()
            model_override = str(active_profile.get("modelOverride") or "").strip()
            if prov_override or model_override:
                effective_provider_config = ProviderConfig(
                    provider=prov_override or self._gateway_provider_config.provider,
                    model=model_override or self._gateway_provider_config.model,
                    base_url=self._gateway_provider_config.base_url,
                    api_key=self._gateway_provider_config.api_key,
                    temperature=self._gateway_provider_config.temperature,
                    max_tokens=self._gateway_provider_config.max_tokens,
                    timeout_ms=self._gateway_provider_config.timeout_ms,
                    thinking=self._gateway_provider_config.thinking,
                )
            result = run_agent_turn(
                request_id=req_id,
                messages=messages,
                tools=effective_tools,
                provider_config=effective_provider_config,
                budget=IterationBudget(max_iterations=6, max_tool_calls=12),
                cancel_event=cancel_ev,
                emit=self.send,
                request_tool_execution=lambda cid, nm, ag, ts: self._request_tool(req_id, cid, nm, ag, ts),
                tool_timeout_s=30.0,
                hook_dispatcher=lambda ev, pl: pm.dispatch_hook(ev, pl),
                tool_policy_check=lambda nm: pm.is_tool_allowed(nm, explicit_allowlist=explicit_allowlist),
            )
            return {"ok": bool(result.get("ok")), "content": str(result.get("content") or "")}
        finally:
            with self._state_lock:
                self._active_turns.pop(req_id, None)

    def _gateway_service(self) -> GatewayService:
        if self._gateway is None:
            self._gateway = GatewayService(agent_dispatch=self._dispatch_gateway_turn)
        return self._gateway

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
                pm = self._plugin_manager()
                raw_allowlist = params.get("allowedTools")
                explicit_allowlist = [str(x) for x in raw_allowlist] if isinstance(raw_allowlist, list) else None
                effective_tools = pm.filter_tools(tools, explicit_allowlist=explicit_allowlist)
                run_agent_turn(
                    request_id=request_id,
                    messages=messages,
                    tools=effective_tools,
                    provider_config=provider_config,
                    fallback_configs=fallback_configs,
                    budget=budget,
                    cancel_event=cancel_event,
                    emit=self.send,
                    request_tool_execution=lambda cid, nm, ag, ts: self._request_tool(request_id, cid, nm, ag, ts),
                    tool_timeout_s=tool_timeout_s,
                    hook_dispatcher=lambda ev, pl: pm.dispatch_hook(ev, pl),
                    tool_policy_check=lambda nm: pm.is_tool_allowed(nm, explicit_allowlist=explicit_allowlist),
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

        if msg_type == "plugins.list":
            self.send({"id": req_id, "ok": True, "result": self._plugin_manager().list_plugins()})
            return True

        if msg_type == "plugins.discover":
            res = self._plugin_manager().discover(str(params.get("searchDir") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.install":
            res = self._plugin_manager().install(
                str(params.get("sourceDir") or ""),
                provenance=str(params.get("provenance") or "local"),
                enable=bool(params.get("enable", False)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.enable":
            res = self._plugin_manager().enable(str(params.get("pluginId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.disable":
            res = self._plugin_manager().disable(str(params.get("pluginId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.update":
            res = self._plugin_manager().update(
                str(params.get("pluginId") or ""),
                str(params.get("newSourceDir") or ""),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.uninstall":
            res = self._plugin_manager().uninstall(str(params.get("pluginId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.configure":
            res = self._plugin_manager().configure(
                str(params.get("pluginId") or ""),
                params.get("settings") if isinstance(params.get("settings"), dict) else {},
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.tools":
            self.send({"id": req_id, "ok": True, "result": self._plugin_manager().list_tools()})
            return True

        if msg_type == "plugins.invoke_tool":
            res = self._plugin_manager().invoke_tool(
                str(params.get("name") or ""),
                params.get("args") if isinstance(params.get("args"), dict) else {},
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.dispatch_hook":
            res = self._plugin_manager().dispatch_hook(
                str(params.get("event") or ""),
                params.get("payload") if isinstance(params.get("payload"), dict) else {},
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "plugins.emergency_stop":
            stopped = self._plugin_manager().emergency_stop() if self._plugins else 0
            self.send({"id": req_id, "ok": True, "result": {"stopped": stopped}})
            return True

        if msg_type == "toolsets.list":
            active = params.get("activeTools") if isinstance(params.get("activeTools"), list) else []
            self.send({"id": req_id, "ok": True, "result": self._plugin_manager().list_toolsets([str(x) for x in active])})
            return True

        if msg_type == "toolsets.set_enabled":
            res = self._plugin_manager().set_toolset_enabled(
                str(params.get("toolsetId") or ""),
                bool(params.get("enabled", True)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "skills.hub_list":
            self.send({"id": req_id, "ok": True, "result": self._plugin_manager().skills_hub_list()})
            return True

        if msg_type == "skills.hub_install":
            res = self._plugin_manager().skills_hub_install(
                str(params.get("skillId") or ""),
                markdown=params.get("markdown") if isinstance(params.get("markdown"), str) else None,
                name=params.get("name") if isinstance(params.get("name"), str) else None,
                description=params.get("description") if isinstance(params.get("description"), str) else None,
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "skills.hub_remove":
            res = self._plugin_manager().skills_hub_remove(str(params.get("skillId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.status":
            self.send({"id": req_id, "ok": True, "result": self._gateway_service().status()})
            return True

        if msg_type == "gateway.start":
            res = self._gateway_service().start(
                host=str(params.get("host") or "127.0.0.1"),
                port=int(params.get("port", 0)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.stop":
            res = self._gateway_service().stop()
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.emergency_stop":
            res = self._gateway_service().emergency_stop() if self._gateway else {"ok": True, "emergencyStopped": True}
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.platform_configure":
            res = self._gateway_service().configure_platform(
                str(params.get("platform") or ""),
                params.get("config") if isinstance(params.get("config"), dict) else {},
                connect=bool(params.get("connect", False)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.platform_disconnect":
            res = self._gateway_service().disconnect_platform(str(params.get("platform") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.inbound":
            res = self._gateway_service().ingest_inbound(
                str(params.get("platform") or ""),
                params.get("payload") if isinstance(params.get("payload"), dict) else {},
                available_tools=[str(x) for x in params.get("availableTools", [])] if isinstance(params.get("availableTools"), list) else None,
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.pairing_approve":
            res = self._gateway_service().approve_pairing(
                str(params.get("code") or ""),
                project_id=str(params.get("projectId") or "default"),
                scopes=[str(x) for x in params.get("scopes", [])] if isinstance(params.get("scopes"), list) else None,
                allow_groups=bool(params.get("allowGroups", False)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.pairing_reject":
            res = self._gateway_service().pairing.reject_pairing(str(params.get("code") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.user_revoke":
            res = self._gateway_service().revoke_user(
                str(params.get("platform") or ""),
                str(params.get("accountId") or ""),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.device_pair":
            res = self._gateway_service().pair_device(
                str(params.get("deviceName") or "Paired Device"),
                project_id=str(params.get("projectId") or "default"),
                scopes=[str(x) for x in params.get("scopes", [])] if isinstance(params.get("scopes"), list) else None,
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.device_revoke":
            res = self._gateway_service().revoke_device(str(params.get("deviceId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.webhook_create":
            res = self._gateway_service().webhooks.create_route(
                name=str(params.get("name") or "Webhook"),
                project_id=str(params.get("projectId") or "default"),
                event_filters=[str(x) for x in params.get("eventFilters", [])] if isinstance(params.get("eventFilters"), list) else None,
                rate_limit_per_min=int(params.get("rateLimitPerMin", 30)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.webhook_set_enabled":
            res = self._gateway_service().webhooks.set_enabled(
                str(params.get("routeId") or ""),
                bool(params.get("enabled", True)),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.webhook_delete":
            res = self._gateway_service().webhooks.delete_route(str(params.get("routeId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "gateway.webhook_history":
            self.send({"id": req_id, "ok": True, "result": self._gateway_service().webhooks.list_history(int(params.get("limit", 50)))})
            return True

        if msg_type == "gateway.configure_agent":
            prov_raw = params.get("provider") if isinstance(params.get("provider"), dict) else {}
            if prov_raw.get("model"):
                self._gateway_provider_config = ProviderConfig(
                    provider=str(prov_raw.get("provider") or "deepseek"),
                    model=str(prov_raw.get("model") or "deepseek-flash"),
                    base_url=str(prov_raw.get("baseUrl") or ""),
                    api_key=prov_raw.get("apiKey") if isinstance(prov_raw.get("apiKey"), str) else None,
                    temperature=float(prov_raw.get("temperature", 1.0)),
                    max_tokens=int(prov_raw.get("maxTokens", 4096)),
                    timeout_ms=int(prov_raw.get("timeoutMs", 60_000)),
                )
            raw_tools = params.get("tools") if isinstance(params.get("tools"), list) else []
            self._gateway_tools = [t for t in raw_tools if isinstance(t, dict) and t.get("name")]
            self._gateway_service().set_available_tools([str(t["name"]) for t in self._gateway_tools])
            self.send({"id": req_id, "ok": True, "result": {"configured": True, "toolCount": len(self._gateway_tools)}})
            return True

        if msg_type == "gateway.start_polling":
            res = self._gateway_service().start_telegram_polling(interval_s=float(params.get("intervalSec", 1.0)))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "profiles.list":
            self.send({"id": req_id, "ok": True, "result": self._workspace_services().list_profiles()})
            return True

        if msg_type == "profiles.create":
            res = self._workspace_services().create_profile(
                str(params.get("name") or ""),
                description=str(params.get("description") or ""),
                instructions=str(params.get("instructions") or ""),
                provider_override=str(params.get("providerOverride") or ""),
                model_override=str(params.get("modelOverride") or ""),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "profiles.switch":
            res = self._workspace_services().switch_profile(str(params.get("profileId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "profiles.update":
            res = self._workspace_services().update_profile(
                str(params.get("profileId") or ""),
                params.get("patch") if isinstance(params.get("patch"), dict) else {},
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "profiles.delete":
            res = self._workspace_services().delete_profile(str(params.get("profileId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "artifacts.list":
            res = self._workspace_services().list_artifacts(
                profile_id=params.get("profileId") if isinstance(params.get("profileId"), str) else None,
                project_id=params.get("projectId") if isinstance(params.get("projectId"), str) else None,
                kind=params.get("kind") if isinstance(params.get("kind"), str) else None,
                query=str(params.get("query") or ""),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "artifacts.register":
            res = self._workspace_services().register_artifact(
                kind=str(params.get("kind") or "file"),
                name=str(params.get("name") or "Untitled"),
                mime_type=str(params.get("mimeType") or "application/octet-stream"),
                file_path=str(params.get("filePath") or ""),
                project_id=str(params.get("projectId") or "default"),
                profile_id=params.get("profileId") if isinstance(params.get("profileId"), str) else None,
                session_id=str(params.get("sessionId") or ""),
                task_id=str(params.get("taskId") or ""),
                size_bytes=int(params.get("sizeBytes") or 0),
                preview_text=str(params.get("previewText") or ""),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "artifacts.delete":
            res = self._workspace_services().delete_artifact(str(params.get("artifactId") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "starmap.build":
            res = self._workspace_services().build_starmap(
                memories=params.get("memories") if isinstance(params.get("memories"), list) else [],
                skills=params.get("skills") if isinstance(params.get("skills"), list) else [],
                sessions=params.get("sessions") if isinstance(params.get("sessions"), list) else [],
                profile_id=params.get("profileId") if isinstance(params.get("profileId"), str) else None,
                project_id=params.get("projectId") if isinstance(params.get("projectId"), str) else None,
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "session_import.preview":
            res = self._workspace_services().preview_session_import(
                str(params.get("rawText") or ""),
                format_hint=str(params.get("format") or "json"),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "session_import.commit":
            res = self._workspace_services().commit_session_import(
                str(params.get("rawText") or ""),
                format_hint=str(params.get("format") or "json"),
            )
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "session_import.confirm":
            res = self._workspace_services().confirm_session_import(str(params.get("digest") or ""))
            self.send({"id": req_id, "ok": True, "result": res})
            return True

        if msg_type == "shutdown":
            self._shutting_down = True
            if self._gateway is not None:
                self._gateway.stop()
            if self._plugins is not None:
                self._plugins.emergency_stop()
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
