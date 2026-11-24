import { describe, expect, it } from 'vitest';
import { pop3Session, pop3Validate, type Pop3Config } from '../../src/worker/providers/pop3';
import { ProviderError } from '../../src/worker/providers/types';
import { FakeSocket, chunked, fakeConnect } from './fake-socket';

const dec = new TextDecoder();
const cfg: Pop3Config = { host: 'pop3.test', port: 995, security: 'tls', username: 'u', password: 's3cret-pass' };

// The server speaks first (greeting), then answers each command in order.
// Chunked into 64-byte pieces so the client must reassemble split lines.
const session = (script: string) => new FakeSocket(chunked(script, 64));

describe('POP3 client', () => {
  it('runs a full session: greeting, login, STAT, UIDL, RETR with dot-stuffing, DELE, QUIT', async () => {
    const socket = session(
      '+OK [henhaoji.com] POP3 Service Ready.\r\n' +
        '+OK\r\n' + // USER
        '+OK\r\n' + // PASS
        '+OK 2 320\r\n' + // STAT
        '+OK\r\n' + // UIDL
        '1 uid-aaa\r\n' +
        '2 uid-bbb\r\n' +
        '.\r\n' +
        '+OK 120 octets\r\n' + // RETR 1
        'From: a@example.com\r\n' +
        'Subject: Hello\r\n' +
        '\r\n' +
        'Body line\r\n' +
        '..dot-stuffed line\r\n' +
        '.\r\n' +
        '+OK\r\n' + // DELE 1
        '+OK\r\n', // QUIT
    );
    const out = await pop3Session(cfg, async (c) => {
      const stat = await c.stat();
      const uidl = await c.uidl();
      const msg = await c.retr(1);
      await c.dele(1);
      return { stat, uidl, msg };
    }, fakeConnect(socket));
    expect(out.stat).toEqual({ count: 2, octets: 320 });
    expect([...out.uidl.entries()]).toEqual([
      [1, 'uid-aaa'],
      [2, 'uid-bbb'],
    ]);
    expect(dec.decode(out.msg)).toBe('From: a@example.com\r\nSubject: Hello\r\n\r\nBody line\r\n.dot-stuffed line\r\n');
    expect(socket.written.map((w) => w.trim())).toEqual(['USER u', 'PASS s3cret-pass', 'STAT', 'UIDL', 'RETR 1', 'DELE 1', 'QUIT']);
  });

  it('reassembles lines split across tiny chunks', async () => {
    const socket = new FakeSocket(chunked('+OK ready.\r\n+OK\r\n+OK\r\n+OK 0 0\r\n+OK\r\n', 3));
    const stat = await pop3Session(cfg, (c) => c.stat(), fakeConnect(socket));
    expect(stat).toEqual({ count: 0, octets: 0 });
  });

  it('reports a bad greeting', async () => {
    const socket = session('-ERR server down\r\n');
    await expect(pop3Session(cfg, async () => null, fakeConnect(socket))).rejects.toThrow(ProviderError);
    await expect(pop3Session(cfg, async () => null, fakeConnect(session('-ERR server down\r\n')))).rejects.toThrow(/server down/);
  });

  it('reports a failed login without leaking the password', async () => {
    const socket = session('+OK ready.\r\n+OK\r\n-ERR invalid password\r\n');
    const err = (await pop3Session(cfg, async () => null, fakeConnect(socket)).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toMatch(/invalid password/);
    expect(err.message).not.toContain('s3cret-pass');
  });

  it('times out instead of hanging on a silent server', async () => {
    const silent = new FakeSocket();
    await expect(pop3Session(cfg, async () => null, fakeConnect(silent), 50)).rejects.toThrow(/timed out/);
    await silent.close();
  });

  it('upgrades with STLS and reads the fresh greeting', async () => {
    const socket = session(
      '+OK ready.\r\n' +
        '+OK\r\n' + // STLS
        '+OK ready after TLS.\r\n' + // fresh greeting
        '+OK\r\n' + // USER
        '+OK\r\n' + // PASS
        '+OK 1 10\r\n' + // STAT
        '+OK\r\n', // QUIT
    );
    const stat = await pop3Session({ ...cfg, security: 'starttls', port: 110 }, (c) => c.stat(), fakeConnect(socket));
    expect(stat).toEqual({ count: 1, octets: 10 });
    expect(socket.written.map((w) => w.trim())).toEqual(['STLS', 'USER u', 'PASS s3cret-pass', 'STAT', 'QUIT']);
  });

  it('validate() connects, logs in and STATs without downloading', async () => {
    const socket = session('+OK ready.\r\n+OK\r\n+OK\r\n+OK 3 99\r\n+OK\r\n');
    await expect(pop3Validate(cfg, fakeConnect(socket))).resolves.toEqual({ count: 3, octets: 99 });
    expect(socket.written.map((w) => w.trim())).toEqual(['USER u', 'PASS s3cret-pass', 'STAT', 'QUIT']);
  });
});
