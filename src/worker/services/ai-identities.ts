// Digital identities, ported from CunInbox (cunzhangcrypto/CunInbox, MIT).
// An identity only exists once its owner confirms it (see confirmIdentity in ai-analysis.ts).
// Status: 0 active, 1 disabled, 2 long unused.
import type { SessionUser } from '../types';
import { all, first, run } from '../db/db';
import { newId } from '../lib/ids';
import { validPlatformCategory } from './ai-analysis';
import type { AiPlatformCategory } from '../../shared/constants';

export interface IdentityRow {
  id: number;
  user_id: number;
  name: string;
  platform_name: string;
  platform_domain: string;
  category: string;
  status: number;
  identity_email: string;
  purpose: string;
  remark: string;
  last_active_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface IdentityInput {
  name: string;
  platformName: string;
  platformDomain: string;
  category: AiPlatformCategory;
  identityEmail: string;
  purpose: string;
  remark: string;
}

export async function listIdentities(env: { DB: D1Database }, user: SessionUser, category: string, status: number | null, keyword: string): Promise<IdentityRow[]> {
  const params: (string | number)[] = [user.id];
  let filter = '';
  if (category) {
    filter += ' AND category = ?';
    params.push(category);
  }
  if (status !== null) {
    filter += ' AND status = ?';
    params.push(status);
  }
  if (keyword) {
    filter += ' AND (name LIKE ? OR identity_email LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  return all<IdentityRow>(env.DB, `SELECT * FROM identities WHERE user_id = ? ${filter} ORDER BY created_at DESC`, ...params);
}

export async function identityStats(env: { DB: D1Database }, user: SessionUser): Promise<{ category: string; total: number }[]> {
  return all<{ category: string; total: number }>(env.DB, 'SELECT category, COUNT(*) AS total FROM identities WHERE user_id = ? GROUP BY category', user.id);
}

export async function addIdentity(env: { DB: D1Database }, user: SessionUser, input: IdentityInput): Promise<number> {
  const now = Date.now();
  const id = newId();
  await run(
    env.DB,
    `INSERT INTO identities (id, user_id, name, platform_name, platform_domain, category, status, identity_email, purpose, remark, last_active_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    input.name,
    input.platformName,
    input.platformDomain.trim().toLowerCase(),
    validPlatformCategory(input.category) || 'other',
    input.identityEmail,
    input.purpose,
    input.remark,
    now,
    now,
    now,
  );
  return id;
}

export async function updateIdentity(
  env: { DB: D1Database },
  user: SessionUser,
  id: number,
  patch: Partial<IdentityInput> & { status?: number },
): Promise<boolean> {
  const row = await first<IdentityRow>(env.DB, 'SELECT * FROM identities WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) return false;
  const sets: string[] = [];
  const params: (string | number)[] = [];
  const set = (col: string, v: string | number) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (patch.name !== undefined) set('name', patch.name);
  if (patch.platformName !== undefined) set('platform_name', patch.platformName);
  if (patch.platformDomain !== undefined) set('platform_domain', patch.platformDomain.trim().toLowerCase());
  if (patch.category !== undefined) set('category', validPlatformCategory(patch.category) || 'other');
  if (patch.identityEmail !== undefined) set('identity_email', patch.identityEmail);
  if (patch.purpose !== undefined) set('purpose', patch.purpose);
  if (patch.remark !== undefined) set('remark', patch.remark);
  if (patch.status !== undefined && [0, 1, 2].includes(patch.status)) set('status', patch.status);
  if (!sets.length) return true;
  sets.push('updated_at = ?');
  params.push(Date.now(), id, user.id);
  await run(env.DB, `UPDATE identities SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, ...params);
  return true;
}

export async function deleteIdentity(env: { DB: D1Database }, user: SessionUser, id: number): Promise<boolean> {
  const row = await first<{ id: number }>(env.DB, 'SELECT id FROM identities WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) return false;
  await run(env.DB, 'DELETE FROM identities WHERE id = ? AND user_id = ?', id, user.id);
  return true;
}
