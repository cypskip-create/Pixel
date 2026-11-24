/**
 * Multimodal Utilities & Image Generation Adapter (Hermes Stage 6 parity).
 *
 * Adapted from Hermes `tools/vision_tools_history_budget.py` and
 * `tools/image_generation_tool.py`:
 *  - `assertVisionCapableModel(provider, model)`: prevents silent routing of
 *    images to text-only models by checking `PROVIDER_MODEL_CATALOG`.
 *  - `enforceImageHistoryBudget(messages, maxImages)`: bounds historical image
 *    attachments per turn so long multimodal chats do not exhaust context limits.
 *  - `generateImageArtifact(...)`: executes OpenAI `/v1/images/generations` or
 *    FAL.ai image generation with bounded size and writes a real PNG artifact
 *    into Pixel's artifact directory (never fabricates fake images).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PROVIDER_MODEL_CATALOG,
  type ChatMessage,
  type ProviderId,
} from '../../shared/types';

export interface VisionCapabilityCheck {
  supported: boolean;
  reason?: string;
}

export function assertVisionCapableModel(
  provider: ProviderId,
  modelId: string,
): VisionCapabilityCheck {
  const entry = PROVIDER_MODEL_CATALOG.find(
    (m) => m.provider === provider && m.id.toLowerCase() === modelId.trim().toLowerCase(),
  );
  if (!entry) {
    // Unknown custom model: fail closed with clear guidance.
    return {
      supported: false,
      reason: `Model "${provider}/${modelId}" is not verified for image vision inputs. Switch to a vision-capable model (e.g. deepseek-flash, gpt-4o, claude-sonnet-4, gemini-2.5-flash).`,
    };
  }
  if (!entry.vision) {
    return {
      supported: false,
      reason: `Model "${entry.label}" is text-only and does not accept image attachments.`,
    };
  }
  return { supported: true };
}

/**
 * Retain at most `maxImages` most-recent images across conversation history
 * (preserving all text content) so multimodal context stays bounded.
 */
export function enforceImageHistoryBudget(
  messages: ChatMessage[],
  maxImages = 4,
): { messages: ChatMessage[]; strippedCount: number } {
  const cap = Math.max(0, maxImages);
  let remaining = cap;
  let strippedCount = 0;

  const reversed = [...messages].reverse().map((msg) => {
    if (!msg.images || msg.images.length === 0) return msg;
    if (remaining <= 0) {
      strippedCount += msg.images.length;
      const { images: _dropped, ...rest } = msg;
      return rest;
    }
    if (msg.images.length <= remaining) {
      remaining -= msg.images.length;
      return msg;
    }
    const kept = msg.images.slice(msg.images.length - remaining);
    strippedCount += msg.images.length - kept.length;
    remaining = 0;
    return { ...msg, images: kept };
  });

  return { messages: reversed.reverse(), strippedCount };
}

export interface ImageGenerationRequest {
  provider: 'openai' | 'fal';
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  apiKey: string | null;
  outputDir: string;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface ImageGenerationResult {
  ok: boolean;
  filePath?: string;
  mimeType?: string;
  bytes?: number;
  revisedPrompt?: string;
  error?: string;
}

export async function generateImageArtifact(
  req: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const prompt = req.prompt.trim();
  if (!prompt) return { ok: false, error: 'Image prompt cannot be empty.' };
  const key = (req.apiKey ?? '').trim();
  if (!key) {
    return {
      ok: false,
      error: `Missing API key for image generation provider "${req.provider}".`,
    };
  }
  const doFetch = req.fetchImpl ?? fetch;

  try {
    let imageBytes: Buffer;
    let revisedPrompt: string | undefined;

    if (req.provider === 'openai') {
      const url = `${(req.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/images/generations`;
      const resp = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          size: req.size || '1024x1024',
          response_format: 'b64_json',
        }),
        signal: req.signal,
      });
      if (!resp.ok) {
        return { ok: false, error: `OpenAI image generation failed (HTTP ${resp.status}).` };
      }
      const json = (await resp.json()) as {
        data?: Array<{ b64_json?: string; revised_prompt?: string }>;
      };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) return { ok: false, error: 'OpenAI image generation returned no image bytes.' };
      imageBytes = Buffer.from(b64, 'base64');
      revisedPrompt = json.data?.[0]?.revised_prompt;
    } else {
      // FAL.ai Flux endpoint
      const url = `${(req.baseUrl || 'https://fal.run').replace(/\/+$/, '')}/fal-ai/flux/schnell`;
      const resp = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: 'square_hd' }),
        signal: req.signal,
      });
      if (!resp.ok) {
        return { ok: false, error: `FAL.ai image generation failed (HTTP ${resp.status}).` };
      }
      const json = (await resp.json()) as { images?: Array<{ url?: string }> };
      const imgUrl = json.images?.[0]?.url;
      if (!imgUrl) return { ok: false, error: 'FAL.ai returned no image URL.' };
      const imgResp = await doFetch(imgUrl, { signal: req.signal });
      if (!imgResp.ok) return { ok: false, error: `Could not download generated image (HTTP ${imgResp.status}).` };
      imageBytes = Buffer.from(await imgResp.arrayBuffer());
    }

    if (imageBytes.byteLength > 20 * 1024 * 1024) {
      return { ok: false, error: 'Generated image exceeded 20 MiB safety limit.' };
    }
    mkdirSync(req.outputDir, { recursive: true });
    const filePath = join(req.outputDir, `pixel-img-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}.png`);
    writeFileSync(filePath, imageBytes);
    return {
      ok: true,
      filePath,
      mimeType: 'image/png',
      bytes: imageBytes.byteLength,
      ...(revisedPrompt ? { revisedPrompt } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Image generation failed.',
    };
  }
}
