import { describe, expect, it } from 'vitest';
import { imapSession, imapValidate, type ImapConfig } from '../../src/worker/providers/imap';
import { ProviderError } from '../../src/worker/providers/types';
import { FakeSocket, chunked, fakeConnect } from './fake-socket';

const dec = new TextDecoder();
const cfg: ImapConfig = { host: 'imap.test', port: 993, security: 'tls', username: 'u', password: 's3cret-pass' };

// Tags are assigned in call order: a001 LOGIN, a002 SELECT, a003 UID SEARCH,
// a004 UID FETCH, a005/a006 UID STORE, a007 EXPUNGE, a008 LOGOUT.
const fullSession = () =>
  '* OK <2925.com> IMAP4rev1 server ready.\r\n' +
  'a001 OK LOGIN completed\r\n' +
  '* 3 EXISTS\r\n' +
  '* 0 RECENT\r\n' +
  '* OK [UIDVALIDITY 12345] UIDs valid\r\n' +
  '* OK [UIDNEXT 10] Predicted next UID\r\n' +
  'a002 OK [READ-WRITE] SELECT completed\r\n' +
  '* SEARCH 1 2 5\r\n' +
  'a003 OK SEARCH completed\r\n' +
  '* 1 FETCH (UID 2 BODY[] {12}\r\n' +
  'Hello world!' +
  '\r\n)\r\n' +
  'a004 OK FETCH completed\r\n' +
  'a005 OK STORE completed\r\n' +
  'a006 OK STORE completed\r\n' +
  'a007 OK EXPUNGE completed\r\n' +
  '* BYE Logging out\r\n' +
  'a008 OK LOGOUT completed\r\n';

describe('IMAP client', () => {
  it('runs a full session: greeting, LOGIN, SELECT, UID SEARCH, UID FETCH literal, STORE, EXPUNGE, LOGOUT', async () => {
    const socket = new FakeSocket(chunked(fullSession(), 64));
    const out = await imapSession(cfg, 'INBOX', async (c) => {
      const selected = await c.select();
      const uids = await c.uidSearchAll();
      const body = await c.fetchBody(2);
      await c.markSeen(2);
      await c.markDeleted(2);
      await c.expunge();
      return { selected, uids, body };
    }, fakeConnect(socket));
    expect(out.selected).toEqual({ uidvalidity: 12345, exists: 3 });
    expect(out.uids).toEqual([1, 2, 5]);
    expect(dec.decode(out.body)).toBe('Hello world!');
    expect(socket.written.map((w) => w.trim())).toEqual([
      'a001 LOGIN "u" "s3cret-pass"',
      'a002 SELECT "INBOX"',
      'a003 UID SEARCH ALL',
      'a004 UID FETCH 2 (BODY[])',
      'a005 UID STORE 2 +FLAGS (\\Seen)',
      'a006 UID STORE 2 +FLAGS (\\Deleted)',
      'a007 EXPUNGE',
      'a008 LOGOUT',
    ]);
  });

  it('reassembles a literal split across tiny chunks', async () => {
    const socket = new FakeSocket(chunked(fullSession(), 3));
    const body = await imapSession(cfg, 'INBOX', async (c) => {
      await c.select();
      await c.uidSearchAll();
      return c.fetchBody(2);
    }, fakeConnect(socket));
    expect(dec.decode(body)).toBe('Hello world!');
  });

  it('returns null UIDVALIDITY when the server does not send one', async () => {
    const socket = new FakeSocket(
      chunked('* OK ready.\r\n' + 'a001 OK LOGIN completed\r\n' + '* 0 EXISTS\r\n' + 'a002 OK SELECT completed\r\n' + '* BYE bye\r\n' + 'a003 OK LOGOUT completed\r\n', 64),
    );
    const selected = await imapSession(cfg, 'INBOX', (c) => c.select(), fakeConnect(socket));
    expect(selected).toEqual({ uidvalidity: null, exists: 0 });
  });

  it('selects the configured folder', async () => {
    const socket = new FakeSocket(
      chunked('* OK ready.\r\n' + 'a001 OK LOGIN completed\r\n' + '* 0 EXISTS\r\n' + 'a002 OK SELECT completed\r\n' + '* BYE bye\r\n' + 'a003 OK LOGOUT completed\r\n', 64),
    );
    await imapSession(cfg, 'Archive', (c) => c.select(), fakeConnect(socket));
    expect(socket.written.map((w) => w.trim())[1]).toBe('a002 SELECT "Archive"');
  });

  it('reports a failed LOGIN without leaking the password', async () => {
    const socket = new FakeSocket(chunked('* OK ready.\r\n' + 'a001 NO [AUTHENTICATIONFAILED] bad login\r\n', 64));
    const err = (await imapSession(cfg, 'INBOX', async () => null, fakeConnect(socket)).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/AUTHENTICATIONFAILED/);
    expect(err.message).not.toContain('s3cret-pass');
  });

  it('rejects a bad greeting and an unexpected continuation request', async () => {
    const badGreeting = new FakeSocket(chunked('* BAD go away\r\n', 64));
    await expect(imapSession(cfg, 'INBOX', async () => null, fakeConnect(badGreeting))).rejects.toThrow(/bad greeting/);
    const continuation = new FakeSocket(chunked('* OK ready.\r\n' + '+ OK send more\r\n', 64));
    await expect(imapSession(cfg, 'INBOX', async () => null, fakeConnect(continuation))).rejects.toThrow(/continuation/);
  });

  it('times out instead of hanging on a silent server', async () => {
    const silent = new FakeSocket();
    await expect(imapSession(cfg, 'INBOX', async () => null, fakeConnect(silent), 50)).rejects.toThrow(/timed out/);
    await silent.close();
  });

  it('upgrades with STARTTLS and sends no new greeting', async () => {
    const socket = new FakeSocket(
      chunked(
        '* OK ready.\r\n' +
          'a001 OK STARTTLS completed\r\n' +
          'a002 OK LOGIN completed\r\n' +
          '* 0 EXISTS\r\n' +
          'a003 OK SELECT completed\r\n' +
          '* BYE bye\r\n' +
          'a004 OK LOGOUT completed\r\n',
        64,
      ),
    );
    const selected = await imapSession({ ...cfg, security: 'starttls', port: 143 }, 'INBOX', (c) => c.select(), fakeConnect(socket));
    expect(selected).toEqual({ uidvalidity: null, exists: 0 });
    expect(socket.written.map((w) => w.trim())).toEqual(['a001 STARTTLS', 'a002 LOGIN "u" "s3cret-pass"', 'a003 SELECT "INBOX"', 'a004 LOGOUT']);
  });

  it('validate() connects, logs in and SELECTs without downloading', async () => {
    const socket = new FakeSocket(chunked(fullSession(), 64));
    await expect(imapValidate(cfg, 'INBOX', fakeConnect(socket))).resolves.toEqual({ uidvalidity: 12345, exists: 3 });
    expect(socket.written.map((w) => w.trim())).toEqual(['a001 LOGIN "u" "s3cret-pass"', 'a002 SELECT "INBOX"', 'a003 LOGOUT']);
  });
});
