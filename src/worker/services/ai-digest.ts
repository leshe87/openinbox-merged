// Daily AI digest, ported from CunInbox (cunzhangcrypto/CunInbox, MIT).
// One digest per user per UTC day; a day with no mail produces no row. Important mail is
// decided by the same rule as the source: security / bill / verify categories.
import type { Env } from '../env';
import type { AppSettings } from '../db/settings';
import { all, first, run } from '../db/db';
import { newId } from '../lib/ids';
import { logError } from '../lib/log';
import { aiChat } from './ai-client';

export interface DigestRow {
  id: number;
  user_id: number;
  digest_date: string;
  content: string;
  important_count: number;
  email_ids: string;
  created_at: number;
}

function dayRange(date: string): { start: number; end: number } {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return { start, end: start + 86_400_000 };
}

export async function generateDailyDigest(env: Env, settings: AppSettings, userId: number, date: string): Promise<DigestRow | null> {
  try {
    if (settings.aiEnabled !== 'on') return null;
    const existing = await first<DigestRow>(env.DB, 'SELECT * FROM daily_digests WHERE user_id = ? AND digest_date = ?', userId, date);
    if (existing) return existing;
    const members = await all<{ mailbox_id: number }>(env.DB, 'SELECT mailbox_id FROM mailbox_members WHERE user_id = ?', userId);
    const access = members.map((m) => ({ mailboxId: m.mailbox_id }));
    if (!access.length) return null;
    const ids = access.map((a) => a.mailboxId);
    const placeholders = ids.map(() => '?').join(',');
    const { start, end } = dayRange(date);
    const rows = await all<{
      id: number;
      subject: string;
      from_name: string;
      summary: string | null;
      category: string | null;
    }>(
      env.DB,
      `SELECT m.id, m.subject, m.from_name, a.summary, a.category FROM messages m
       LEFT JOIN email_analysis a ON a.mailbox_id = m.mailbox_id AND a.message_id = m.id
       WHERE m.direction = 'in' AND m.status = 'received' AND m.mailbox_id IN (${placeholders})
         AND m.sent_at >= ? AND m.sent_at < ?
       ORDER BY m.sent_at DESC LIMIT 50`,
      ...ids,
      start,
      end,
    );
    if (!rows.length) return null;
    const important = rows.filter((r) => r.category === 'security' || r.category === 'bill' || r.category === 'verify');
    const listText = rows.map((r, i) => `${i + 1}. [${r.category || '其他'}] ${r.from_name}: ${r.subject} (${r.summary || '无摘要'})`).join('\n');
    const result = await aiChat(
      env,
      settings,
      [
        { role: 'system', content: '你是CunInbox的AI助手，负责生成每日邮件摘要。用简洁的中文输出。' },
        {
          role: 'user',
          content: `以下是用户${date}收到的邮件列表，请生成一份每日摘要：\n\n${listText}\n\n输出格式：\n今日重要信息：\n1. [分类] 简要描述\n2. ...\n\n今日概览：共X封邮件，其中重要邮件Y封。`,
        },
      ],
      { temperature: 0.4, maxTokens: 1024 },
    );
    const id = newId();
    await run(
      env.DB,
      `INSERT INTO daily_digests (id, user_id, digest_date, content, important_count, email_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      date,
      result.content,
      important.length,
      JSON.stringify(rows.map((r) => r.id)),
      Date.now(),
    );
    return (await first<DigestRow>(env.DB, 'SELECT * FROM daily_digests WHERE id = ?', id)) ?? null;
  } catch (e) {
    logError('ai.digest_failed', e, { userId, date });
    return null;
  }
}

export async function listDigests(env: Env, userId: number, limit: number): Promise<DigestRow[]> {
  return all<DigestRow>(env.DB, 'SELECT * FROM daily_digests WHERE user_id = ? ORDER BY digest_date DESC LIMIT ?', userId, Math.min(30, Math.max(1, limit || 10)));
}

/** Daily cron: one digest per user who received mail yesterday (at most 20 users per run). */
export async function generateDigestsForAllUsers(env: Env, settings: AppSettings): Promise<number> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { start, end } = dayRange(yesterday);
  const users = await all<{ user_id: number }>(
    env.DB,
    `SELECT DISTINCT mm.user_id FROM messages m JOIN mailbox_members mm ON mm.mailbox_id = m.mailbox_id
     WHERE m.direction = 'in' AND m.status = 'received' AND m.sent_at >= ? AND m.sent_at < ? LIMIT 20`,
    start,
    end,
  );
  let done = 0;
  for (const u of users) {
    const row = await generateDailyDigest(env, settings, u.user_id, yesterday);
    if (row) done++;
  }
  return done;
}
