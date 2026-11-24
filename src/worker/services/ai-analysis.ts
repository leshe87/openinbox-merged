// AI mail analysis, digital-identity discovery and the security center.
// Ported from CunInbox (cunzhangcrypto/CunInbox, MIT) and adapted to OpenInbox:
// - Analysis and security events are scoped by mailbox (visibility = mailbox membership),
//   identities are scoped by the user who confirms them.
// - Platform matching uses an exact domain match (CunInbox used a LIKE match, which could
//   attach mail to the wrong platform).
// - AI-returned category/platform values are validated against the allowlists; the source
//   stored whatever the model returned.
// - CunInbox's unreachable `phishing`/`suspicious` branches and its dead `checkInactiveIdentities`
//   and `ai_task` are not ported.
import type { Env } from '../env';
import type { AppSettings } from '../db/settings';
import type { SessionUser } from '../types';
import { all, first, run } from '../db/db';
import { accessibleMailboxes } from '../auth/access';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { logError } from '../lib/log';
import { aiChatWithJSON, cleanText } from './ai-client';
import { AI_CATEGORIES, AI_PLATFORM_CATEGORIES, type AiCategory, type AiPlatformCategory } from '../../shared/constants';

export const AI_CATEGORIES_SET = new Set<string>(AI_CATEGORIES);
export const AI_PLATFORM_CATEGORIES_SET = new Set<string>(AI_PLATFORM_CATEGORIES);

export function validCategory(v: unknown): AiCategory | '' {
  return typeof v === 'string' && AI_CATEGORIES_SET.has(v) ? (v as AiCategory) : '';
}

export function validPlatformCategory(v: unknown): AiPlatformCategory | '' {
  return typeof v === 'string' && AI_PLATFORM_CATEGORIES_SET.has(v) ? (v as AiPlatformCategory) : '';
}

export interface AnalysisInput {
  mailboxId: number;
  messageId: number;
  fromAddr: string;
  fromName: string;
  deliveredTo: string;
  subject: string;
  text: string;
}

export interface AnalysisRow {
  id: number;
  mailbox_id: number;
  message_id: number;
  category: string;
  summary: string;
  key_info: string;
  platform_name: string;
  platform_domain: string;
  platform_category: string;
  identity_id: number | null;
  is_new_identity: number;
  confidence: number;
  created_at: number;
}

const SECURITY_KEYWORDS: Record<string, string[]> = {
  password_change: ['password', '密码', '重置密码', 'change password', 'reset password', '修改密码'],
  abnormal_login: ['new device', '新设备', '新登录', 'unusual activity', '异常登录', 'new login', 'sign-in from'],
  data_breach: ['breach', 'leak', '泄露', '数据泄露', 'compromised', 'security incident'],
};

const HIGH_RISK_KEYWORDS = ['urgent', '紧急', 'immediately', 'verify your account', 'suspended', 'verify identity', '确认身份'];

/** First matching keyword rule wins, same as the source. Returns null when nothing matches. */
export function matchSecurityType(subject: string, text: string): string | null {
  const combined = `${subject} ${cleanText(text, 500)}`.toLowerCase();
  for (const [type, keywords] of Object.entries(SECURITY_KEYWORDS)) {
    if (keywords.some((kw) => combined.includes(kw.toLowerCase()))) return type;
  }
  return null;
}

/** 2 = high, 1 = medium, 0 = low — same thresholds as the source. */
export function calculateRiskLevel(subject: string, text: string, aiConfidence: number): number {
  const combined = `${subject} ${cleanText(text, 500)}`.toLowerCase();
  const hasHighRisk = HIGH_RISK_KEYWORDS.some((kw) => combined.includes(kw.toLowerCase()));
  if (hasHighRisk && aiConfidence >= 0.6) return 2;
  if (aiConfidence >= 0.7 || hasHighRisk) return 1;
  return 0;
}

export function securityTitle(type: string, sender: string): string {
  if (type === 'password_change') return `${sender} 密码变更通知`;
  if (type === 'abnormal_login') return `${sender} 检测到新登录`;
  if (type === 'data_breach') return `${sender} 数据安全事件`;
  return `安全事件: ${sender}`;
}

export function securitySuggestion(type: string, riskLevel: number): string {
  if (type === 'password_change')
    return riskLevel >= 2 ? '建议立即核实是否本人操作，如非本人请尽快修改密码并启用两步验证。' : '请确认密码修改是否为本人操作。';
  if (type === 'abnormal_login')
    return riskLevel >= 2 ? '检测到异常登录，建议立即检查账号安全设置，修改密码并查看登录设备列表。' : '检测到新设备登录，请确认是否为本人操作。';
  if (type === 'data_breach') return '建议立即更改该平台密码，并检查其他使用相同密码的账号。';
  return '请关注此安全提醒。';
}

interface AnalysisJson {
  category?: unknown;
  summary?: unknown;
  platform_name?: unknown;
  platform_domain?: unknown;
  platform_category?: unknown;
  confidence?: unknown;
  key_info?: unknown;
}

/** Classify one already-stored message. Never throws: failures return null and are logged. */
export async function analyzeMessage(env: Env, settings: AppSettings, input: AnalysisInput): Promise<AnalysisRow | null> {
  try {
    if (settings.aiEnabled !== 'on') return null;
    const existing = await first<AnalysisRow>(env.DB, 'SELECT * FROM email_analysis WHERE mailbox_id = ? AND message_id = ?', input.mailboxId, input.messageId);
    if (existing) return existing;
    const text = cleanText(input.text, 800);
    if (!input.subject && !text) return null;
    const result = await aiChatWithJSON(
      env,
      settings,
      [
        { role: 'system', content: '你是一个数字身份管理助手。分析邮件并返回JSON。只返回JSON，不要其他内容。' },
        {
          role: 'user',
          content: `分析以下邮件，提取信息：\n\n发件人: ${input.fromAddr}\n发件名: ${input.fromName}\n主题: ${input.subject}\n正文: ${text}\n\n返回JSON格式:\n{\n  "category": "register/verify/security/bill/update/marketing/social",\n  "summary": "一句话摘要(中文)",\n  "platform_name": "平台名(如GitHub,无则空)",\n  "platform_domain": "平台域名(无则空)",\n  "platform_category": "dev/ai/saas/social/cloud/web3/finance/shop/news/other",\n  "is_new_identity": true/false,\n  "confidence": 0.0-1.0,\n  "key_info": {\n    "action_required": "需要操作的内容(无则空)",\n    "deadline": "截止时间(无则空)",\n    "amount": "金额(无则空)"\n  }\n}`,
        },
      ],
      { temperature: 0.2, maxTokens: 512 },
    );
    const analysis = (result.json ?? null) as AnalysisJson | null;
    if (!analysis || typeof analysis !== 'object') return null;

    const category = validCategory(analysis.category);
    const platformCategory = validPlatformCategory(analysis.platform_category);
    const platformDomain = typeof analysis.platform_domain === 'string' ? analysis.platform_domain.trim().toLowerCase() : '';
    const platformName = typeof analysis.platform_name === 'string' ? analysis.platform_name.trim() : '';
    const confidence = typeof analysis.confidence === 'number' && Number.isFinite(analysis.confidence) ? Math.min(1, Math.max(0, analysis.confidence)) : 0;
    const summary = typeof analysis.summary === 'string' ? analysis.summary : '';
    const keyInfo = analysis.key_info && typeof analysis.key_info === 'object' ? analysis.key_info : {};

    // Identity discovery: an existing identity with the same platform domain (exact match),
    // otherwise one whose identity email is the recipient address. Discovery only flags —
    // the identity itself is created when the user confirms it.
    let identityId: number | null = null;
    let isNewIdentity = 0;
    if (platformDomain || input.deliveredTo) {
      const match = await first<{ id: number }>(
        env.DB,
        `SELECT id FROM identities WHERE (platform_domain != '' AND platform_domain = ?) OR (identity_email != '' AND identity_email = ?) ORDER BY last_active_at DESC LIMIT 1`,
        platformDomain,
        input.deliveredTo,
      );
      if (match) {
        identityId = match.id;
        await run(env.DB, 'UPDATE identities SET last_active_at = ?, updated_at = ? WHERE id = ?', Date.now(), Date.now(), match.id);
      } else if (platformDomain) {
        isNewIdentity = 1;
      }
    }

    const id = newId();
    const now = Date.now();
    await run(
      env.DB,
      `INSERT INTO email_analysis (id, mailbox_id, message_id, category, summary, key_info, platform_name, platform_domain, platform_category, identity_id, is_new_identity, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.mailboxId,
      input.messageId,
      category,
      summary,
      JSON.stringify(keyInfo),
      platformName,
      platformDomain,
      platformCategory,
      identityId,
      isNewIdentity,
      confidence,
      now,
    );
    const row = await first<AnalysisRow>(env.DB, 'SELECT * FROM email_analysis WHERE id = ?', id);
    if (category === 'security' && row) await scanSecurity(env, input, row, summary, confidence);
    return row;
  } catch (e) {
    logError('ai.analyze_failed', e, { mailboxId: input.mailboxId, messageId: input.messageId });
    return null;
  }
}

/** Security scan: only runs for security-category mail. Returns the event id or null. */
export async function scanSecurity(env: Env, input: AnalysisInput, analysis: AnalysisRow, summary: string, confidence: number): Promise<number | null> {
  try {
    const type = matchSecurityType(input.subject, input.text);
    if (!type) return null;
    const riskLevel = calculateRiskLevel(input.subject, input.text, confidence);
    const sender = input.fromName || input.fromAddr;
    const id = newId();
    await run(
      env.DB,
      `INSERT INTO security_events (id, mailbox_id, message_id, identity_id, type, risk_level, title, description, suggestion, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      id,
      input.mailboxId,
      input.messageId,
      analysis.identity_id,
      type,
      riskLevel,
      securityTitle(type, sender),
      summary || input.subject,
      securitySuggestion(type, riskLevel),
      Date.now(),
    );
    return id;
  } catch (e) {
    logError('ai.security_scan_failed', e, { mailboxId: input.mailboxId, messageId: input.messageId });
    return null;
  }
}

/** Batch-analyze a user's unanalyzed received mail (at most 20 per run, serial). */
export async function analyzeBatch(env: Env, settings: AppSettings, user: SessionUser): Promise<number> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return 0;
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all<{
    id: number;
    mailbox_id: number;
    from_addr: string;
    from_name: string;
    delivered_to: string | null;
    subject: string;
    text: string | null;
  }>(
    env.DB,
    `SELECT m.id, m.mailbox_id, m.from_addr, m.from_name, m.delivered_to, m.subject, b.text
     FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
     WHERE m.direction = 'in' AND m.status = 'received' AND m.mailbox_id IN (${placeholders})
       AND NOT EXISTS (SELECT 1 FROM email_analysis a WHERE a.mailbox_id = m.mailbox_id AND a.message_id = m.id)
     ORDER BY m.id DESC LIMIT 20`,
    ...ids,
  );
  let analyzed = 0;
  for (const r of rows) {
    const row = await analyzeMessage(env, settings, {
      mailboxId: r.mailbox_id,
      messageId: r.id,
      fromAddr: r.from_addr,
      fromName: r.from_name,
      deliveredTo: r.delivered_to ?? '',
      subject: r.subject,
      text: r.text ?? '',
    });
    if (row) analyzed++;
  }
  return analyzed;
}

export interface AnalysisListItem extends AnalysisRow {
  subject: string;
  from_addr: string;
  delivered_to: string | null;
}

export async function listAnalysis(env: Env, user: SessionUser, category: string, limit: number): Promise<AnalysisListItem[]> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return [];
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  const params: (string | number)[] = [...ids];
  let categoryFilter = '';
  if (category && AI_CATEGORIES_SET.has(category)) {
    categoryFilter = 'AND a.category = ?';
    params.push(category);
  }
  params.push(Math.min(50, Math.max(1, limit || 20)));
  return all<AnalysisListItem>(
    env.DB,
    `SELECT a.*, m.subject, m.from_addr, m.delivered_to FROM email_analysis a
     JOIN messages m ON m.id = a.message_id
     WHERE a.mailbox_id IN (${placeholders}) ${categoryFilter}
     ORDER BY a.created_at DESC LIMIT ?`,
    ...params,
  );
}

export async function listNewIdentities(env: Env, user: SessionUser): Promise<AnalysisListItem[]> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return [];
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  return all<AnalysisListItem>(
    env.DB,
    `SELECT a.*, m.subject, m.from_addr, m.delivered_to FROM email_analysis a
     JOIN messages m ON m.id = a.message_id
     WHERE a.mailbox_id IN (${placeholders}) AND a.is_new_identity = 1
     ORDER BY a.created_at DESC LIMIT 20`,
    ...ids,
  );
}

export async function analysisStats(env: Env, user: SessionUser): Promise<{ category: string; total: number }[]> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return [];
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  return all<{ category: string; total: number }>(
    env.DB,
    `SELECT category, COUNT(*) AS total FROM email_analysis WHERE mailbox_id IN (${placeholders}) GROUP BY category`,
    ...ids,
  );
}

/**
 * Confirm a flagged identity: creates the identity owned by the confirming user and links
 * the analysis row to it. Returns the new identity id, or null when the row is not visible
 * to this user.
 */
export async function confirmIdentity(
  env: Env,
  user: SessionUser,
  analysisId: number,
  input: { name: string; category: string; purpose: string; remark: string },
): Promise<number | null> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return null;
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  const row = await first<AnalysisRow & { delivered_to: string | null }>(
    env.DB,
    `SELECT a.*, m.delivered_to FROM email_analysis a JOIN messages m ON m.id = a.message_id
     WHERE a.id = ? AND a.mailbox_id IN (${placeholders})`,
    analysisId,
    ...ids,
  );
  if (!row) return null;
  const now = Date.now();
  const id = newId();
  await run(
    env.DB,
    `INSERT INTO identities (id, user_id, name, platform_name, platform_domain, category, status, identity_email, purpose, remark, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    input.name,
    row.platform_name,
    row.platform_domain,
    validPlatformCategory(input.category) || 'other',
    row.delivered_to ?? '',
    input.purpose,
    input.remark,
    now,
    now,
    now,
  );
  await run(env.DB, 'UPDATE email_analysis SET identity_id = ?, is_new_identity = 0 WHERE id = ?', id, analysisId);
  return id;
}

export function parseKeyInfo(row: AnalysisRow): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(row.key_info, {});
}

export interface SecurityEventRow {
  id: number;
  mailbox_id: number;
  message_id: number;
  identity_id: number | null;
  type: string;
  risk_level: number;
  title: string;
  description: string;
  suggestion: string;
  status: number;
  created_at: number;
  subject: string;
  from_addr: string;
}

export async function listSecurityEvents(env: Env, user: SessionUser, riskLevel: number | null, status: number | null, limit: number): Promise<SecurityEventRow[]> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return [];
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  const params: (string | number)[] = [...ids];
  let filter = '';
  if (riskLevel !== null) {
    filter += ' AND s.risk_level = ?';
    params.push(riskLevel);
  }
  if (status !== null) {
    filter += ' AND s.status = ?';
    params.push(status);
  }
  params.push(Math.min(50, Math.max(1, limit || 20)));
  return all<SecurityEventRow>(
    env.DB,
    `SELECT s.*, m.subject, m.from_addr FROM security_events s
     JOIN messages m ON m.id = s.message_id
     WHERE s.mailbox_id IN (${placeholders}) ${filter}
     ORDER BY s.created_at DESC LIMIT ?`,
    ...params,
  );
}

export async function securityStats(env: Env, user: SessionUser): Promise<{ total: number; unprocessed: number; highRisk: number }> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return { total: 0, unprocessed: 0, highRisk: 0 };
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  const row = await first<{ total: number; unprocessed: number; highRisk: number }>(
    env.DB,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS unprocessed,
            SUM(CASE WHEN status = 0 AND risk_level = 2 THEN 1 ELSE 0 END) AS highRisk
     FROM security_events WHERE mailbox_id IN (${placeholders})`,
    ...ids,
  );
  return { total: row?.total ?? 0, unprocessed: row?.unprocessed ?? 0, highRisk: row?.highRisk ?? 0 };
}

export async function setSecurityStatus(env: Env, user: SessionUser, eventId: number, status: number): Promise<boolean> {
  const access = await accessibleMailboxes(env.DB, user);
  if (!access.length) return false;
  const ids = access.map((a) => a.mailboxId);
  const placeholders = ids.map(() => '?').join(',');
  const row = await first<{ id: number }>(env.DB, `SELECT id FROM security_events WHERE id = ? AND mailbox_id IN (${placeholders})`, eventId, ...ids);
  if (!row) return false;
  await run(env.DB, 'UPDATE security_events SET status = ? WHERE id = ?', status, eventId);
  return true;
}
