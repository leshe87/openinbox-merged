// Pulls new mail from external POP3/IMAP accounts into a target mailbox.
// Runs on the 10-minute cron and on demand from the admin UI; both paths call
// fetchExternalAccount, so the UID/UIDL state, per-run cap, import cap and
// dedupe are identical. UIDL/UID state is the first dedupe layer; ingest's
// message-id dedupe is the backstop, so a run interrupted halfway re-fetches
// safely instead of duplicating mail.
import type { Env } from '../env';
import { all, run } from '../db/db';
import { loadSettings } from '../db/settings';
import { errorMessage } from '../lib/errors';
import { log } from '../lib/log';
import { ingest } from './inbound';
import { getMailbox } from './mailboxes';
import { decryptPassword, getExternalAccount, seenUids, type ExternalAccountRow } from './external-accounts';
import { pop3Session } from '../providers/pop3';
import { imapSession } from '../providers/imap';
import { connect as cfConnect } from 'cloudflare:sockets';

export const FETCH_PER_RUN = 20;
export const MAX_FAILURES = 5;

export interface FetchResult {
  fetched: number;
  skipped: number; // over the size limit
  duplicates: number;
  capped: boolean;
  error?: string;
}

const EMPTY: FetchResult = { fetched: 0, skipped: 0, duplicates: 0, capped: false };

interface RunOutcome {
  fetched: number;
  skipped: number;
  duplicates: number;
  moreWaiting: boolean;
  seen: string[];
  currentUids: string[];
  uidvalidity: number | null;
}

export async function fetchExternalAccount(env: Env, id: number, connect: typeof cfConnect = cfConnect): Promise<FetchResult> {
  const row = await getExternalAccount(env.DB, id);
  if (!row.enabled) return { ...EMPTY, error: 'Account is disabled.' };
  // The import cap stops a large backfill from filling D1: once the total
  // imported count reaches it, fetching parks until the cap is raised.
  if (row.max_import > 0 && row.imported_count >= row.max_import) {
    await run(env.DB, "UPDATE external_accounts SET last_status = 'capped', updated_at = ? WHERE id = ?", Date.now(), id);
    return { ...EMPTY, capped: true };
  }
  try {
    const settings = await loadSettings(env.DB);
    const limit = settings.maxInboundMb * 1024 * 1024;
    const mailbox = await getMailbox(env.DB, row.mailbox_id);
    const password = await decryptPassword(env, row);
    const remaining = row.max_import > 0 ? row.max_import - row.imported_count : Number.POSITIVE_INFINITY;
    const perRun = Math.min(FETCH_PER_RUN, remaining);
    const outcome = row.protocol === 'pop3' ? await fetchPop3(env, row, password, mailbox.address, limit, perRun, connect) : await fetchImap(env, row, password, mailbox.address, limit, perRun, connect);

    // Drop UIDs that no longer exist on the server, so the seen set stays
    // bounded by the remote mailbox instead of growing forever.
    const current = new Set(outcome.currentUids);
    const kept = outcome.seen.filter((u) => current.has(u));
    const capped = row.max_import > 0 && row.imported_count + outcome.fetched >= row.max_import && outcome.moreWaiting;
    await run(
      env.DB,
      `UPDATE external_accounts SET seen_uids = ?, uidvalidity = ?, imported_count = imported_count + ?,
         last_fetched_at = ?, last_fetched_count = ?, last_status = ?, last_error = NULL, failure_count = 0, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(kept),
      outcome.uidvalidity ?? row.uidvalidity,
      outcome.fetched,
      Date.now(),
      outcome.fetched,
      capped ? 'capped' : 'ok',
      Date.now(),
      id,
    );
    return { fetched: outcome.fetched, skipped: outcome.skipped, duplicates: outcome.duplicates, capped };
  } catch (e) {
    const message = errorMessage(e);
    const failures = row.failure_count + 1;
    const parked = failures >= MAX_FAILURES;
    await run(
      env.DB,
      `UPDATE external_accounts SET last_status = 'error', last_error = ?, failure_count = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      message,
      failures,
      parked ? 0 : 1,
      Date.now(),
      id,
    ).catch(() => undefined);
    log('external-fetch.failed', { account: id, error: message, failures, parked });
    return { ...EMPTY, error: parked ? `${message} (disabled after ${MAX_FAILURES} consecutive failures)` : message };
  }
}

async function fetchPop3(
  env: Env,
  row: ExternalAccountRow,
  password: string,
  targetAddress: string,
  limit: number,
  perRun: number,
  connect: typeof cfConnect,
): Promise<RunOutcome> {
  const seen = new Set(seenUids(row));
  return pop3Session(
    { host: row.host, port: row.port, security: row.security, username: row.username, password },
    async (client) => {
      const uidMap = await client.uidl();
      const entries = [...uidMap.entries()].filter(([, uid]) => !seen.has(uid)).sort((a, b) => a[0] - b[0]);
      const todo = entries.slice(0, perRun);
      let fetched = 0;
      let skipped = 0;
      let duplicates = 0;
      for (const [num, uid] of todo) {
        const bytes = await client.retr(num);
        if (bytes.byteLength > limit) {
          skipped++;
          seen.add(uid);
          log('external-fetch.skipped', { account: row.id, uid, size: bytes.byteLength });
          continue;
        }
        const r = await ingestMessage(env, bytes, row.mailbox_id, targetAddress);
        if (r === 'duplicate') duplicates++;
        else fetched++;
        seen.add(uid);
        // POP3 deletions only take effect on QUIT, so a run that dies halfway
        // leaves the server copy in place and the next run dedupes instead.
        if (row.delete_after_fetch) await client.dele(num);
      }
      return { fetched, skipped, duplicates, moreWaiting: entries.length > todo.length, seen: [...seen], currentUids: [...uidMap.values()], uidvalidity: null };
    },
    connect,
  );
}

async function fetchImap(
  env: Env,
  row: ExternalAccountRow,
  password: string,
  targetAddress: string,
  limit: number,
  perRun: number,
  connect: typeof cfConnect,
): Promise<RunOutcome> {
  let seen = new Set(seenUids(row));
  return imapSession(
    { host: row.host, port: row.port, security: row.security, username: row.username, password },
    row.folder,
    async (client) => {
      const { uidvalidity } = await client.select();
      if (uidvalidity !== null && row.uidvalidity !== null && uidvalidity !== row.uidvalidity) {
        // The remote folder was recreated: old UIDs name different messages.
        // Reset tracking; ingest's message-id dedupe is the backstop.
        log('external-fetch.uidvalidity', { account: row.id, old: row.uidvalidity, new: uidvalidity });
        seen = new Set();
      }
      const uids = await client.uidSearchAll();
      const todo = uids
        .filter((u) => !seen.has(String(u)))
        .sort((a, b) => a - b)
        .slice(0, perRun);
      let fetched = 0;
      let skipped = 0;
      let duplicates = 0;
      let deleted = false;
      for (const uid of todo) {
        const bytes = await client.fetchBody(uid);
        if (bytes.byteLength > limit) {
          skipped++;
          seen.add(String(uid));
          log('external-fetch.skipped', { account: row.id, uid, size: bytes.byteLength });
          continue;
        }
        const r = await ingestMessage(env, bytes, row.mailbox_id, targetAddress);
        if (r === 'duplicate') duplicates++;
        else fetched++;
        seen.add(String(uid));
        if (row.mark_seen) await client.markSeen(uid);
        if (row.delete_after_fetch) {
          await client.markDeleted(uid);
          deleted = true;
        }
      }
      if (deleted) await client.expunge();
      return { fetched, skipped, duplicates, moreWaiting: uids.filter((u) => !seen.has(String(u))).length > 0, seen: [...seen], currentUids: uids.map(String), uidvalidity };
    },
    connect,
  );
}

// The fetched message goes through the same pipeline as routed mail: parse,
// dedupe, thread, spam and filters. No envelope sender is known for a pulled
// message, so the From header speaks for itself.
async function ingestMessage(env: Env, bytes: Uint8Array, mailboxId: number, targetAddress: string): Promise<'fetched' | 'duplicate'> {
  const settings = await loadSettings(env.DB);
  const r = await ingest({ env, settings }, bytes, { rcpt: targetAddress, envelopeFrom: '', recipient: { mailboxId, address: targetAddress, via: 'exact' } });
  return r.status === 'duplicate' ? 'duplicate' : 'fetched';
}

// One account at a time: a fetch can take a while, and the free plan's
// per-invocation subrequest budget is shared with the other cron jobs.
export async function fetchAllExternalAccounts(env: Env, connect: typeof cfConnect = cfConnect): Promise<{ id: number; result: FetchResult }[]> {
  const accounts = await all<{ id: number }>(env.DB, 'SELECT id FROM external_accounts WHERE enabled = 1 ORDER BY id');
  const out: { id: number; result: FetchResult }[] = [];
  for (const a of accounts) {
    out.push({ id: a.id, result: await fetchExternalAccount(env, a.id, connect) });
  }
  return out;
}
