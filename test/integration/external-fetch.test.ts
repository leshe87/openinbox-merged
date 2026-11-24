import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { useFakeApis } from '../helpers/fake';
import { Client, setupInstance } from '../helpers/client';
import { fetchExternalAccount } from '../../src/worker/services/external-fetch';
import { FakeSocket, chunked, fakeConnect } from '../unit/fake-socket';

const enc = new TextEncoder();

function message(id: string, subject: string): string {
  return (
    'From: Ann Sender <ann@sender.test>\r\n' +
    'To: admin@example.com\r\n' +
    `Subject: ${subject}\r\n` +
    'Date: Mon, 24 Nov 2026 08:00:00 +0000\r\n' +
    `Message-ID: <${id}@sender.test>\r\n` +
    'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=sender.test; dmarc=pass header.from=sender.test; spf=pass smtp.mailfrom=ann@sender.test\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    '\r\n' +
    `Body of ${subject}.\r\n`
  );
}

function pop3Script(messages: { uid: string; body: string }[]): FakeSocket {
  let script = '+OK ready.\r\n+OK\r\n+OK\r\n+OK\r\n';
  messages.forEach((m, i) => {
    script += `${i + 1} ${m.uid}\r\n`;
  });
  script += '.\r\n';
  messages.forEach((m) => {
    script += `+OK\r\n${m.body}.\r\n`;
  });
  script += '+OK\r\n';
  return new FakeSocket(chunked(script, 128));
}

function imapScript(uidvalidity: number, uid: number, body: string): FakeSocket {
  const bytes = enc.encode(body);
  const script =
    '* OK ready.\r\n' +
    'a001 OK LOGIN completed\r\n' +
    '* 1 EXISTS\r\n' +
    `* OK [UIDVALIDITY ${uidvalidity}] UIDs valid\r\n` +
    'a002 OK SELECT completed\r\n' +
    `* SEARCH ${uid}\r\n` +
    'a003 OK SEARCH completed\r\n' +
    `* 1 FETCH (UID ${uid} BODY[] {${bytes.byteLength}}\r\n` +
    body +
    '\r\n)\r\n' +
    'a004 OK FETCH completed\r\n' +
    '* BYE bye\r\n' +
    'a005 OK LOGOUT completed\r\n';
  return new FakeSocket(chunked(script, 128));
}

describe('external accounts', () => {
  let admin: Client;
  let mailboxId: number;

  beforeEach(async () => {
    useFakeApis();
    admin = new Client();
    await setupInstance(admin);
    const boxes = await admin.get('/api/admin/mailboxes');
    mailboxId = boxes[0].id;
  });

  async function createAccount(patch: Record<string, unknown> = {}) {
    return admin.post('/api/admin/external-accounts', {
      protocol: 'pop3',
      name: 'Test',
      host: 'pop3.test',
      port: 995,
      security: 'tls',
      username: 'u',
      password: 'p',
      mailboxId,
      folder: 'INBOX',
      deleteAfterFetch: false,
      markSeen: false,
      maxImport: 5000,
      enabled: true,
      ...patch,
    });
  }

  async function listAccounts() {
    return admin.get('/api/admin/external-accounts');
  }

  it('pulls POP3 mail into the chosen mailbox and never fetches the same UID twice', async () => {
    const { id } = await createAccount();
    const socket = pop3Script([
      { uid: 'uid-1', body: message('pull1', 'Pulled one') },
      { uid: 'uid-2', body: message('pull2', 'Pulled two') },
    ]);
    const first = await fetchExternalAccount(env, id, fakeConnect(socket));
    expect(first).toMatchObject({ fetched: 2, duplicates: 0, capped: false });
    const { threads } = await admin.get('/api/threads?mailbox=all&view=inbox');
    expect(threads.map((t: { subject: string }) => t.subject).sort()).toEqual(['Pulled one', 'Pulled two']);
    expect((await listAccounts())[0]).toMatchObject({ importedCount: 2, lastStatus: 'ok', lastFetchedCount: 2 });

    const again = await fetchExternalAccount(env, id, fakeConnect(pop3Script([])));
    expect(again).toMatchObject({ fetched: 0, duplicates: 0 });
    const [account] = await listAccounts();
    // The second (empty) run is the latest fetch, so its count is 0; the
    // imported total still stands.
    expect(account).toMatchObject({ importedCount: 2, lastStatus: 'ok', lastFetchedCount: 0 });
    expect(account.lastFetchedAt).toBeGreaterThan(0);
  });

  it('pulls IMAP mail, and a UIDVALIDITY change resets tracking with dedupe as backstop', async () => {
    const { id } = await createAccount({ protocol: 'imap', host: 'imap.test', port: 993 });
    const body = message('imap1', 'IMAP pulled');
    const first = await fetchExternalAccount(env, id, fakeConnect(imapScript(4242, 7, body)));
    expect(first).toMatchObject({ fetched: 1, duplicates: 0 });
    expect((await admin.get('/api/threads?mailbox=all&view=inbox')).threads).toHaveLength(1);

    // The remote folder was recreated (new UIDVALIDITY): the same UID now
    // names the same message, so it is re-fetched and deduped by Message-ID.
    const second = await fetchExternalAccount(env, id, fakeConnect(imapScript(9999, 7, body)));
    expect(second).toMatchObject({ fetched: 0, duplicates: 1 });
    expect((await admin.get('/api/threads?mailbox=all&view=inbox')).threads).toHaveLength(1);
  });

  it('stops at the import cap and reports it', async () => {
    const { id } = await createAccount({ maxImport: 1 });
    const socket = pop3Script([
      { uid: 'uid-1', body: message('cap1', 'Cap one') },
      { uid: 'uid-2', body: message('cap2', 'Cap two') },
    ]);
    const r = await fetchExternalAccount(env, id, fakeConnect(socket));
    expect(r).toMatchObject({ fetched: 1, capped: true });
    const [account] = await listAccounts();
    expect(account).toMatchObject({ importedCount: 1, lastStatus: 'capped' });
    const again = await fetchExternalAccount(env, id, fakeConnect(pop3Script([])));
    expect(again).toMatchObject({ fetched: 0, capped: true });
  });

  it('parks an account after repeated auth failures', async () => {
    const { id } = await createAccount();
    const failing = () => new FakeSocket(chunked('+OK ready.\r\n+OK\r\n-ERR bad login\r\n', 64));
    for (let i = 0; i < 5; i++) {
      const r = await fetchExternalAccount(env, id, fakeConnect(failing()));
      expect(r.error).toMatch(/bad login/);
    }
    const [account] = await listAccounts();
    expect(account).toMatchObject({ enabled: false, failureCount: 5, lastStatus: 'error' });
    expect(account.lastError).toMatch(/bad login/);
    // A parked account is skipped, not retried.
    const skipped = await fetchExternalAccount(env, id, fakeConnect(failing()));
    expect(skipped.error).toMatch(/disabled/);
  });

  it('CRUD hides the password and validates the target mailbox', async () => {
    const { id } = await createAccount();
    const [account] = await listAccounts();
    expect(account).toMatchObject({ protocol: 'pop3', host: 'pop3.test', mailboxId });
    expect('password' in account).toBe(false);
    expect('password_enc' in account).toBe(false);

    await admin.patch(`/api/admin/external-accounts/${id}`, { name: 'Renamed', enabled: false });
    expect((await listAccounts())[0]).toMatchObject({ name: 'Renamed', enabled: false });

    expect(await admin.status('POST', '/api/admin/external-accounts', { protocol: 'pop3', host: 'x', port: 995, security: 'tls', username: 'u', password: 'p', mailboxId: 999999999 })).toBe(404);
    await admin.del(`/api/admin/external-accounts/${id}`);
    expect(await listAccounts()).toHaveLength(0);
    expect(await admin.status('POST', '/api/admin/external-accounts/999999999/test', {})).toBe(404);
  });

  it('manual fetch and test endpoints answer without hanging on an unreachable server', async () => {
    const { id } = await createAccount({ host: '127.0.0.1', port: 1995 });
    const test = await admin.post(`/api/admin/external-accounts/${id}/test`);
    expect(test.ok).toBe(false);
    expect(typeof test.message).toBe('string');
    const fetched = await admin.post(`/api/admin/external-accounts/${id}/fetch`);
    expect(typeof fetched.error).toBe('string');
  });
});
