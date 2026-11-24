// AI API (ported from CunInbox, adapted to OpenInbox).
// Mounted behind the global requireUser in app.ts. AI settings changes are admin-only.
// Analysis and security rows are scoped by mailbox membership; identities and digests are
// scoped by user. Responses use the same { error: { code, message } } envelope as the rest
// of the API (see app.onError); successful bodies are plain JSON.
import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { body, intParam } from '../lib/validate';
import { aiChatSchema, aiSettingsSchema, confirmIdentitySchema, identitySchema, identityUpdateSchema, securityStatusSchema } from '../../shared/schemas';
import { saveSettings, type AppSettings } from '../db/settings';
import { currentUser, clientIp, requireAdmin } from '../auth/middleware';
import { audit } from '../services/audit';
import { encrypt } from '../lib/crypto';
import { errorMessage, HttpError, notFound } from '../lib/errors';
import { aiChat } from '../services/ai-client';
import {
  analyzeBatch,
  analysisStats,
  confirmIdentity,
  listAnalysis,
  listNewIdentities,
  listSecurityEvents,
  parseKeyInfo,
  securityStats,
  setSecurityStatus,
} from '../services/ai-analysis';
import { addIdentity, deleteIdentity, identityStats, listIdentities, updateIdentity } from '../services/ai-identities';
import { generateDailyDigest, listDigests } from '../services/ai-digest';

export const ai = new Hono<AppBindings>();

function queryInt(c: { req: { query: (name: string) => string | undefined } }, name: string): number | null {
  const v = c.req.query(name);
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

ai.get('/status', async (c) => {
  const settings = c.get('settings');
  return c.json({
    enabled: settings.aiEnabled === 'on',
    provider: settings.aiProvider,
    model: settings.aiModel,
    baseUrl: settings.aiBaseUrl,
    hasApiKey: !!settings.aiApiKeyEnc,
    workersAiBound: !!c.env.AI,
  });
});

ai.get('/settings', requireAdmin, async (c) => {
  const s = c.get('settings');
  return c.json({ aiEnabled: s.aiEnabled, aiProvider: s.aiProvider, aiModel: s.aiModel, aiBaseUrl: s.aiBaseUrl, hasApiKey: !!s.aiApiKeyEnc });
});

ai.patch('/settings', requireAdmin, async (c) => {
  const input = await body(c, aiSettingsSchema);
  const patch: Partial<AppSettings> = {
    aiEnabled: input.aiEnabled,
    aiProvider: input.aiProvider,
    aiModel: input.aiModel,
    aiBaseUrl: input.aiBaseUrl,
  };
  if (input.aiApiKey) patch.aiApiKeyEnc = await encrypt(c.env, input.aiApiKey);
  await saveSettings(c.env.DB, patch);
  await audit(c.env.DB, { userId: currentUser(c).id, action: 'ai.settings_updated', details: { ...input, aiApiKey: input.aiApiKey ? '***' : undefined }, ip: clientIp(c) });
  return c.json({ ok: true });
});

ai.get('/analysis', async (c) => {
  const user = currentUser(c);
  const rows = await listAnalysis(c.env, user, c.req.query('category') ?? '', Number(c.req.query('limit') ?? 20));
  return c.json(rows.map((r) => ({ ...r, key_info: parseKeyInfo(r) })));
});

ai.get('/analysis/new', async (c) => {
  const user = currentUser(c);
  const rows = await listNewIdentities(c.env, user);
  return c.json(rows.map((r) => ({ ...r, key_info: parseKeyInfo(r) })));
});

ai.get('/analysis/stats', async (c) => {
  return c.json(await analysisStats(c.env, currentUser(c)));
});

ai.post('/analysis/batch', async (c) => {
  const user = currentUser(c);
  const settings = c.get('settings');
  const analyzed = await analyzeBatch(c.env, settings, user);
  return c.json({ analyzed });
});

ai.post('/analysis/:id/confirm', async (c) => {
  const user = currentUser(c);
  const input = await body(c, confirmIdentitySchema);
  const id = await confirmIdentity(c.env, user, intParam(c, 'id'), input);
  if (id === null) throw notFound('Analysis not found.');
  return c.json({ identityId: id });
});

ai.get('/identities', async (c) => {
  const user = currentUser(c);
  const status = queryInt(c, 'status');
  return c.json(await listIdentities(c.env, user, c.req.query('category') ?? '', status, c.req.query('q') ?? ''));
});

ai.get('/identities/stats', async (c) => {
  return c.json(await identityStats(c.env, currentUser(c)));
});

ai.post('/identities', async (c) => {
  const user = currentUser(c);
  const input = await body(c, identitySchema);
  const id = await addIdentity(c.env, user, {
    name: input.name,
    platformName: input.platformName,
    platformDomain: input.platformDomain,
    category: input.category,
    identityEmail: input.identityEmail,
    purpose: input.purpose,
    remark: input.remark,
  });
  return c.json({ id });
});

ai.put('/identities/:id', async (c) => {
  const user = currentUser(c);
  const input = await body(c, identityUpdateSchema);
  const ok = await updateIdentity(c.env, user, intParam(c, 'id'), {
    name: input.name,
    platformName: input.platformName,
    platformDomain: input.platformDomain,
    category: input.category,
    identityEmail: input.identityEmail,
    purpose: input.purpose,
    remark: input.remark,
    status: input.status,
  });
  if (!ok) throw notFound('Identity not found.');
  return c.json({ ok: true });
});

ai.delete('/identities/:id', async (c) => {
  const ok = await deleteIdentity(c.env, currentUser(c), intParam(c, 'id'));
  if (!ok) throw notFound('Identity not found.');
  return c.json({ ok: true });
});

ai.get('/digests', async (c) => {
  return c.json(await listDigests(c.env, currentUser(c).id, Number(c.req.query('limit') ?? 10)));
});

ai.post('/digests/generate', async (c) => {
  const user = currentUser(c);
  const settings = c.get('settings');
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const row = await generateDailyDigest(c.env, settings, user.id, date);
  return c.json(row ?? { generated: false });
});

ai.get('/security', async (c) => {
  const user = currentUser(c);
  return c.json(await listSecurityEvents(c.env, user, queryInt(c, 'riskLevel'), queryInt(c, 'status'), Number(c.req.query('limit') ?? 20)));
});

ai.get('/security/stats', async (c) => {
  return c.json(await securityStats(c.env, currentUser(c)));
});

ai.put('/security/:id/status', async (c) => {
  const input = await body(c, securityStatusSchema);
  const ok = await setSecurityStatus(c.env, currentUser(c), intParam(c, 'id'), input.status);
  if (!ok) throw notFound('Security event not found.');
  return c.json({ ok: true });
});

ai.post('/chat', async (c) => {
  const user = currentUser(c);
  const settings = c.get('settings');
  const input = await body(c, aiChatSchema);
  if (settings.aiEnabled !== 'on') return c.json({ error: 'AI is off. Turn it on in AI settings.' }, 400);
  // Fixed CunInbox bug: its list call returned an array, so the identity count was always 0.
  const identities = await listIdentities(c.env, user, '', null, '');
  const identityLines = identities.slice(0, 100).map((i) => `- ${i.name} (${i.platform_name || '未知平台'}，${i.identity_email || '无邮箱'})`).join('\n');
  let result;
  try {
    result = await aiChat(
      c.env,
      settings,
      [
        {
          role: 'system',
          content: `你是CunInbox的AI助手，帮助用户管理数字身份和邮件。用户当前有${identities.length}个数字身份记录。\n${identityLines}\n用户问题: ${input.message} 请用简洁的中文回答，帮助用户管理他们的数字身份、邮箱和安全。`,
        },
        { role: 'user', content: input.message },
      ],
      { temperature: 0.3, maxTokens: 1024 },
    );
  } catch (e) {
    // AI is switched on but no provider is actually configured (no Workers AI binding
    // and no API key): that is a 503, not a 500 — the service is unavailable until the
    // user configures it. Genuine provider failures still surface as 500 via onError.
    if (/not bound|not configured/i.test(errorMessage(e))) {
      throw new HttpError(503, 'ai_not_configured', 'AI 未配置：请在 AI 设置里绑定 Workers AI，或填写 DeepSeek API Key 后再试。');
    }
    throw e;
  }
  return c.json({ content: result.content, provider: result.providerName, fallback: result.fallback });
});
