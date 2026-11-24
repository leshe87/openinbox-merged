// External mail accounts (POP3/IMAP pull): CRUD and connection tests. Passwords
// are stored encrypted with ENCRYPTION_KEY and never returned by the API.
// Saving an account does not test the connection: the remote server may be
// briefly down, and the Test button / first fetch surfaces failures instead.
import type { Env } from '../env';
import { all, first, run } from '../db/db';
import { decrypt, encrypt } from '../lib/crypto';
import { errorMessage, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { parseJson } from '../lib/json';
import { log } from '../lib/log';
import { getMailbox } from './mailboxes';
import { pop3Validate, type Pop3Config } from '../providers/pop3';
import { imapValidate, type ImapConfig } from '../providers/imap';
import type { externalAccountPatchSchema, externalAccountSchema } from '../../shared/schemas';
import type { z } from 'zod';
import { connect as cfConnect } from 'cloudflare:sockets';

export type ExternalAccountInput = z.infer<typeof externalAccountSchema>;
export type ExternalAccountPatch = z.infer<typeof externalAccountPatchSchema>;

export interface ExternalAccountRow {
  id: number;
  protocol: 'pop3' | 'imap';
  name: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'plain';
  username: string;
  password_enc: string;
  mailbox_id: number;
  folder: string;
  delete_after_fetch: number;
  mark_seen: number;
  max_import: number;
  enabled: number;
  seen_uids: string;
  uidvalidity: number | null;
  imported_count: number;
  last_fetched_at: number | null;
  last_fetched_count: number;
  last_status: string | null;
  last_error: string | null;
  failure_count: number;
  created_at: number;
  updated_at: number;
}

export interface ExternalAccountInfo {
  id: number;
  protocol: 'pop3' | 'imap';
  name: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'plain';
  username: string;
  mailboxId: number;
  mailboxAddress: string;
  folder: string;
  deleteAfterFetch: boolean;
  markSeen: boolean;
  maxImport: number;
  enabled: boolean;
  importedCount: number;
  lastFetchedAt: number | null;
  lastFetchedCount: number;
  lastStatus: string | null;
  lastError: string | null;
  failureCount: number;
  createdAt: number;
  updatedAt: number;
}

export function toInfo(row: ExternalAccountRow, mailboxAddress: string): ExternalAccountInfo {
  return {
    id: row.id,
    protocol: row.protocol,
    name: row.name,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    mailboxId: row.mailbox_id,
    mailboxAddress,
    folder: row.folder,
    deleteAfterFetch: !!row.delete_after_fetch,
    markSeen: !!row.mark_seen,
    maxImport: row.max_import,
    enabled: !!row.enabled,
    importedCount: row.imported_count,
    lastFetchedAt: row.last_fetched_at,
    lastFetchedCount: row.last_fetched_count,
    lastStatus: row.last_status,
    lastError: row.last_error,
    failureCount: row.failure_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getExternalAccount(db: D1Database, id: number): Promise<ExternalAccountRow> {
  const row = await first<ExternalAccountRow>(db, 'SELECT * FROM external_accounts WHERE id = ?', id);
  if (!row) throw notFound('External account not found.');
  return row;
}

export async function listExternalAccounts(env: Env): Promise<ExternalAccountInfo[]> {
  const rows = await all<ExternalAccountRow>(env.DB, 'SELECT * FROM external_accounts ORDER BY name, host');
  const boxes = await all<{ id: number; address: string }>(env.DB, 'SELECT id, address FROM mailboxes');
  const byId = new Map(boxes.map((b) => [b.id, b.address]));
  return rows.map((r) => toInfo(r, byId.get(r.mailbox_id) ?? ''));
}

export function seenUids(row: ExternalAccountRow): string[] {
  return parseJson<string[]>(row.seen_uids, []);
}

export async function decryptPassword(env: Env, row: ExternalAccountRow): Promise<string> {
  return decrypt(env, row.password_enc);
}

function toConfig(row: ExternalAccountRow, password: string): Pop3Config | ImapConfig {
  return { host: row.host, port: row.port, security: row.security, username: row.username, password };
}

export async function createExternalAccount(env: Env, input: ExternalAccountInput): Promise<{ id: number }> {
  const mailbox = await getMailbox(env.DB, input.mailboxId);
  const id = newId();
  const now = Date.now();
  await run(
    env.DB,
    `INSERT INTO external_accounts (id, protocol, name, host, port, security, username, password_enc, mailbox_id, folder,
       delete_after_fetch, mark_seen, max_import, enabled, seen_uids, uidvalidity, imported_count,
       last_fetched_at, last_fetched_count, last_status, last_error, failure_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, 0, NULL, 0, 'never', NULL, 0, ?, ?)`,
    id,
    input.protocol,
    input.name,
    input.host,
    input.port,
    input.security,
    input.username,
    await encrypt(env, input.password),
    mailbox.id,
    input.folder,
    input.deleteAfterFetch ? 1 : 0,
    input.markSeen ? 1 : 0,
    input.maxImport,
    input.enabled ? 1 : 0,
    now,
    now,
  );
  return { id };
}

const CONNECTION_FIELDS = ['protocol', 'host', 'port', 'security', 'username', 'password'] as const;

export async function updateExternalAccount(env: Env, id: number, patch: ExternalAccountPatch): Promise<void> {
  const row = await getExternalAccount(env.DB, id);
  if (patch.mailboxId !== undefined) await getMailbox(env.DB, patch.mailboxId);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (sql: string, value: string | number | null) => {
    sets.push(sql);
    params.push(value);
  };
  if (patch.protocol !== undefined) set('protocol = ?', patch.protocol);
  if (patch.name !== undefined) set('name = ?', patch.name);
  if (patch.host !== undefined) set('host = ?', patch.host);
  if (patch.port !== undefined) set('port = ?', patch.port);
  if (patch.security !== undefined) set('security = ?', patch.security);
  if (patch.username !== undefined) set('username = ?', patch.username);
  if (patch.password !== undefined) set('password_enc = ?', await encrypt(env, patch.password));
  if (patch.mailboxId !== undefined) set('mailbox_id = ?', patch.mailboxId);
  if (patch.folder !== undefined) set('folder = ?', patch.folder);
  if (patch.deleteAfterFetch !== undefined) set('delete_after_fetch = ?', patch.deleteAfterFetch ? 1 : 0);
  if (patch.markSeen !== undefined) set('mark_seen = ?', patch.markSeen ? 1 : 0);
  if (patch.maxImport !== undefined) set('max_import = ?', patch.maxImport);
  if (patch.enabled !== undefined) set('enabled = ?', patch.enabled ? 1 : 0);
  // New connection details (or re-enabling) deserve a fresh chance: clear the
  // failure backoff so the next fetch tries again instead of staying parked.
  const resetsBackoff = CONNECTION_FIELDS.some((f) => patch[f] !== undefined) || patch.enabled === true;
  if (resetsBackoff) {
    set('failure_count = ?', 0);
    // A raised cap un-parks a capped account; a lowered one takes effect next run.
    if (row.last_status === 'capped' && (patch.maxImport === 0 || (patch.maxImport !== undefined && patch.maxImport > row.imported_count))) {
      set('last_status = ?', 'never');
      set('last_error = ?', null);
    }
  }
  if (!sets.length) return;
  set('updated_at = ?', Date.now());
  await run(env.DB, `UPDATE external_accounts SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
}

export async function deleteExternalAccount(env: Env, id: number): Promise<void> {
  await getExternalAccount(env.DB, id);
  await run(env.DB, 'DELETE FROM external_accounts WHERE id = ?', id);
}

// Connect, log in and read the mailbox (STAT / SELECT) without downloading.
// Success clears the failure backoff; failure records the error for the UI.
export async function testExternalAccount(
  env: Env,
  id: number,
  connect: typeof cfConnect = cfConnect,
): Promise<{ ok: boolean; message: string }> {
  const row = await getExternalAccount(env.DB, id);
  try {
    const password = await decryptPassword(env, row);
    const cfg = toConfig(row, password);
    if (row.protocol === 'pop3') {
      const s = await pop3Validate(cfg, connect);
      await run(env.DB, "UPDATE external_accounts SET last_status = 'ok', last_error = NULL, failure_count = 0, updated_at = ? WHERE id = ?", Date.now(), id);
      return { ok: true, message: `Connected (${s.count} message${s.count === 1 ? '' : 's'} on the server).` };
    }
    const s = await imapValidate(cfg, row.folder, connect);
    await run(env.DB, "UPDATE external_accounts SET last_status = 'ok', last_error = NULL, failure_count = 0, updated_at = ? WHERE id = ?", Date.now(), id);
    return { ok: true, message: `Connected (${s.exists} message${s.exists === 1 ? '' : 's'} in ${row.folder}).` };
  } catch (e) {
    const message = errorMessage(e);
    await run(env.DB, 'UPDATE external_accounts SET last_status = ?, last_error = ?, updated_at = ? WHERE id = ?', 'error', message, Date.now(), id).catch(() => undefined);
    log('external-account.test_failed', { account: id, error: message });
    return { ok: false, message };
  }
}
