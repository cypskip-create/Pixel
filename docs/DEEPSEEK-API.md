# DeepSeek API Contract — Verified Facts

Source: official DeepSeek API docs, fetched 2026-11-06.
Do not invent endpoints, model names, or capabilities beyond what is recorded here.

## Base URL

| Format | URL |
|---|---|
| OpenAI-compatible | `https://api.deepseek.com` |
| Anthropic-compatible | `https://api.deepseek.com/anthropic` |

Chat endpoint: `POST https://api.deepseek.com/chat/completions`

## Models (exactly two)

| Model name | Backing version | Context | Max output | Vision | Tool calls |
|---|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | 1M | 384K | ✅ **supported** | ✅ |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 1M | 384K | ❌ **NOT supported** | ✅ |

> **Critical correction to the product spec.** The spec said vision should use
> "deepseek-flash for fast responses and supported vision requests" — that is
> correct — but it also implied `deepseek-v4-pro` could be used broadly. It
> **cannot accept images**. Sending an image to `deepseek-v4-pro` is an invalid
> call. Cyps enforces this in code (`modelSupportsVision`) and refuses locally
> with a clear message instead of issuing a request that would fail.

Legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are still
accepted but retired; requests are served by the Flash model. Cyps normalizes
them to `deepseek-flash`.

## Thinking mode

- Controlled by `thinking: { type: "enabled" | "disabled" }`, or by
  `reasoning_effort: "none" | "low" | "high" | "max"`.
- `thinking` takes precedence over `reasoning_effort` when both are sent.
- Default when both omitted: **thinking enabled**.
- `reasoning_effort` aliases: `minimal`→`low`, `medium`/`xhigh`→`high`.
- Default `max_tokens`: 8K non-thinking, 64K thinking (128K at `max` effort).
- Reasoning text arrives in `message.reasoning_content` (streamed as
  `delta.reasoning_content`). Cyps shows this as a distinct "thinking" stream.

## Streaming

- `stream: true` → server-sent events, terminated by `data: [DONE]`.
- `stream_options: { include_usage: true }` adds a `usage` field to chunks
  (null except the last).
- The last chunk before `[DONE]` carries full token usage on a chunk whose
  `choices[0]` has no new content but a non-null `finish_reason`.

## Vision / images

- **Only `deepseek-flash`.** Images in `system`/`assistant` messages → HTTP 400.
- Content is an array of blocks:
  ```json
  {"type":"text","text":"..."},
  {"type":"image_url","image_url":{"url":"data:image/png;base64,....","detail":"original"}}
  ```
- `detail`: `low` (downscale 512×512), `high`, `original`, `auto`.
- Formats: JPEG, PNG, GIF, WebP — detected from **content**, not filename/MIME.
- Limits: request body 48 MiB; inline image ≤32 MiB; ≤600 images/request;
  ≤8192 px per side.
- Images are auto-resized; **≤1024 tokens per image** regardless of input size.
  → Large screenshots are not proportionally expensive; downscaling is still
  applied locally to keep upload size and latency low.

## Other request notes

- `temperature` (0–2) has **no effect in thinking mode**.
- `frequency_penalty` / `presence_penalty` are **deprecated and ignored**.
- `max_tokens` range 1–393216.
- `tool_choice: "required"` and named tool choice are **not supported in
  thinking mode** → HTTP 400. Disable thinking first.
- `response_format: {"type":"json_object"}` requires the prompt to mention JSON.

## Usage fields

`usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`,
`usage.prompt_cache_hit_tokens`, `usage.prompt_cache_miss_tokens`,
`usage.completion_tokens_details.reasoning_tokens`.

## Error handling required by Cyps

| Condition | Handling |
|---|---|
| No API key | Refuse locally, open Settings. Never send an unauthenticated call. |
| 401 | "Invalid API key" — prompt to re-enter; clear cached key. |
| 402 | Insufficient balance — surface clearly. |
| 429 | Rate limited — backoff + surface retry-after. |
| 400 on vision | Should never occur: blocked client-side by capability check. |
| Timeout | Abort via `AbortController`, report as timeout, keep partial text. |
| User cancel | `AbortController.abort()`, persist whatever streamed. |

## Security rules

- API key never hardcoded, never committed, never logged.
- Stored via OS-backed encryption (Electron `safeStorage` → DPAPI on Windows).
- Key is only ever sent to `api.deepseek.com` over HTTPS.
- Screenshots are transmitted **only** after explicit per-session authorization.
