# Model Providers & Auxiliary Routing

Source authority: `agent/anthropic_adapter.py`, `agent/bedrock_adapter.py`, `agent/azure_identity_adapter.py`, `agent/codex_responses_adapter.py`, `agent/agent_init_ollama.py`, `agent/auxiliary_client.py`, `agent/auxiliary_fallback_recovery.py`, `agent/error_classifier.py`, `agent/prompt_caching.py`, `agent/rate_limit_credits.py`.

## 1. Provider Architecture
- **Primary API Modes:** OpenAI Chat Completions (`openai==2.54.0`), OpenAI Responses / Codex Responses (`codex_responses_adapter.py`), Anthropic Messages (`anthropic_adapter.py`, with prompt-cache control & thinking replay), AWS Bedrock (`bedrock_adapter.py`), Azure (`azure_identity_adapter.py`), local Ollama (`agent_init_ollama.py`), plus plugin-registered providers (`plugins/model-providers/`).
- **Auxiliary Model Client (`agent/auxiliary_client.py`):** Dedicated lightweight client for secondary tasks (context compression summaries, session search summarization, smart-approval guardian checks). Supports its own `fallback_chain`, key rotation (`auxiliary_key_rotation.py`), stream stall watchdog (`auxiliary_stream_watchdog.py`), rate-limit backoff (`auxiliary_rate_limit_backoff.py`), and `ContextVar`-pinned single-use fallback routes (`context_compressor.py::pin_summary_route`).
- **Error Classification & Failover (`agent/error_classifier.py`):** Maps provider HTTP/SDK errors into typed `ClassifiedError` / `FailoverReason` so transient rate limits, auth failures, context-length overflows, and stream parse errors trigger distinct recovery paths.
- **Prompt Caching (`agent/prompt_caching.py`):** Builds cache-control plans and keeps `MEMORY.md` / `USER.md` frozen per session so prompt prefixes remain cache-hit-stable across turns.
- **TLS Trust (`pyproject.toml` + `agent/ssl_verify.py`):** Uses `truststore==0.10.5` so OS/corporate root certificates work natively on Windows without manual CA bundles.

## 2. Pixel Adaptation Strategy
- Keep Pixel's existing DeepSeek (`deepseek-flash`, `deepseek-v4-pro`, vision) and Ollama providers and DPAPI-encrypted `SettingsStore` credentials in Electron main.
- Add a clean provider registry in the future Python agent service that receives **per-turn ephemeral credentials only in memory over the local IPC pipe** (never written to Python disk config or `.env`), supporting OpenAI-compatible (DeepSeek, Ollama, OpenAI) and Anthropic adapters with typed error classification and optional auxiliary-model routing for compression.
