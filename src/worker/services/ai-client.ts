// AI client ported from CunInbox (cunzhangcrypto/CunInbox, MIT), adapted to OpenInbox:
// settings come from the OpenInbox settings table, secrets are stored encrypted, and the
// client never throws for a missing Workers AI binding — it falls back to the OpenAI-compatible
// provider instead. All failures are plain Errors; callers decide whether to log or surface.
//
// Provider rules (same as CunInbox):
// - provider 'workers': use the Workers AI binding; if it is missing or the call fails AND a
//   fallback API key is configured, retry once against the OpenAI-compatible endpoint.
// - provider 'deepseek' / 'custom': call the configured OpenAI-compatible endpoint directly.
// - No timeout, no retry loop, no streaming — matching the source behaviour.
import type { Env } from '../env';
import type { AppSettings } from '../db/settings';
import { decrypt } from '../lib/crypto';
import { logError } from '../lib/log';

// Llama 3.1 8B was retired 2026-05-30; CunInbox moved to Llama 4 Scout.
export const WORKERS_AI_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  content: string;
  model: string;
  provider: string;
  providerName: string;
  fallback: boolean;
  fallbackReason?: string;
  tokenUsed: number;
}

export interface AiOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export function providerLabel(provider: string, model: string, fallback = false): string {
  if (provider === 'workers') return fallback ? `Fallback: ${model || 'deepseek-chat'}` : 'Workers AI (free)';
  if (provider === 'deepseek') return `DeepSeek: ${model || 'deepseek-chat'}`;
  return `Custom: ${model || 'deepseek-chat'}`;
}

async function runWorkersAI(env: Env, messages: AiMessage[], options: AiOptions): Promise<{ content: string; model: string; tokenUsed: number }> {
  if (!env.AI) throw new Error('Workers AI is not bound. Bind AI in wrangler.jsonc or switch to DeepSeek.');
  const model = options.model ?? WORKERS_AI_MODEL;
  const response = await env.AI.run(model as never, {
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1024,
  } as never);
  const text = (response as { response?: string }).response ?? '';
  return { content: text, model, tokenUsed: 0 };
}

async function runOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AiMessage[],
  options: AiOptions,
): Promise<{ content: string; model: string; tokenUsed: number }> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: options.temperature ?? 0.3, max_tokens: options.maxTokens ?? 1024 }),
  });
  if (!response.ok) throw new Error(`AI request failed: ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
  return { content: data.choices?.[0]?.message?.content ?? '', model, tokenUsed: data.usage?.total_tokens ?? 0 };
}

async function fallbackApiKey(env: Env, settings: AppSettings): Promise<string | null> {
  if (!settings.aiApiKeyEnc) return null;
  try {
    return await decrypt(env, settings.aiApiKeyEnc);
  } catch (e) {
    logError('ai.key_decrypt_failed', e);
    return null;
  }
}

export async function aiChat(env: Env, settings: AppSettings, messages: AiMessage[], options: AiOptions = {}): Promise<AiResult> {
  const provider = settings.aiProvider;
  const model = settings.aiModel || 'deepseek-chat';
  const baseUrl = settings.aiBaseUrl || 'https://api.deepseek.com';
  const fallbackKey = await fallbackApiKey(env, settings);
  // Fallback only applies when Workers AI is the primary provider and a fallback key exists.
  const fallbackEnabled = provider === 'workers' && !!fallbackKey;
  try {
    let result;
    if (provider === 'workers') {
      result = await runWorkersAI(env, messages, options);
    } else {
      if (!fallbackKey) throw new Error('AI API key is not configured. Add one in AI settings.');
      result = await runOpenAICompatible(baseUrl, fallbackKey, model, messages, options);
    }
    return { ...result, provider, providerName: providerLabel(provider, model), fallback: false };
  } catch (e) {
    if (!fallbackEnabled || !fallbackKey) throw e;
    logError('ai.workers_failed_fallback', e);
    const fbResult = await runOpenAICompatible(baseUrl, fallbackKey, model, messages, options);
    return {
      ...fbResult,
      provider,
      providerName: providerLabel(provider, model, true),
      fallback: true,
      fallbackReason: e instanceof Error ? e.message : String(e),
    };
  }
}

export function extractJSON(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return t.substring(start, end + 1);
  return t;
}

export async function aiChatWithJSON(
  env: Env,
  settings: AppSettings,
  messages: AiMessage[],
  options: AiOptions = {},
): Promise<AiResult & { json: unknown | null }> {
  const result = await aiChat(env, settings, messages, options);
  let parsed: unknown | null = null;
  try {
    parsed = JSON.parse(extractJSON(result.content));
  } catch {
    logError('ai.json_parse_failed', new Error('AI did not return JSON'), { content: result.content.slice(0, 500) });
  }
  return { ...result, json: parsed };
}

/** Strip HTML, collapse whitespace and truncate — the text sent to the model. */
export function cleanText(text: string | null | undefined, maxLen = 800): string {
  if (!text) return '';
  let t = text.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > maxLen ? t.substring(0, maxLen) : t;
}
