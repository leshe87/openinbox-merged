// Minimal IMAP client over Workers TCP sockets, modeled on providers/smtp.ts.
// LOGIN, SELECT, UID SEARCH, UID FETCH (BODY[]), UID STORE +FLAGS, EXPUNGE,
// LOGOUT. Handles tagged vs untagged responses, byte-counted literals
// (`* 1 FETCH (BODY[] {1234}` — exactly N bytes, not lines) and continuation
// requests. No IDLE: a Worker socket cannot outlive one invocation, so IMAP is
// poll-only, like POP3.
import { connect as cfConnect } from 'cloudflare:sockets';
import { ByteIo } from './io';
import { ProviderError } from './types';

export interface ImapConfig {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'plain';
  username: string;
  password: string;
}

type ConnectFn = typeof cfConnect;

export interface ImapClient {
  select(): Promise<{ uidvalidity: number | null; exists: number }>;
  uidSearchAll(): Promise<number[]>;
  fetchBody(uid: number): Promise<Uint8Array>;
  markSeen(uid: number): Promise<void>;
  markDeleted(uid: number): Promise<void>;
  expunge(): Promise<void>;
}

function fail(message: string, retryable = false): never {
  throw new ProviderError(message, retryable);
}

// An IMAP quoted-string: backslash-escape \ and ".
function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface Untagged {
  text: string;
  literal?: Uint8Array;
}

class ImapIo {
  // Tags must stay unique for the whole connection, including across the
  // STARTTLS upgrade (which swaps the underlying socket): the counter lives
  // outside this object so a fresh ImapIo keeps counting.
  constructor(
    private io: ByteIo,
    private tags: { n: number } = { n: 0 },
  ) {}

  release(): void {
    this.io.release();
  }

  takeBuffered(): Uint8Array {
    return this.io.takeBuffered();
  }

  private nextTag(): string {
    this.tags.n += 1;
    return `a${String(this.tags.n).padStart(3, '0')}`;
  }

  // Read until the tagged response for `tag`; collect untagged lines. A line
  // ending in {N} is followed by exactly N literal bytes, then CRLF and ")".
  private async readResponse(tag: string): Promise<{ text: string; untagged: Untagged[] }> {
    const untagged: Untagged[] = [];
    for (;;) {
      const line = await this.io.readLineString();
      if (line.startsWith('+')) fail('IMAP: unexpected continuation request from server');
      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const status = rest.split(/\s+/, 1)[0]?.toUpperCase();
        if (status === 'OK') return { text: rest, untagged };
        fail(`IMAP: ${rest.slice(0, 200)}`);
      }
      if (line.startsWith('*')) {
        const m = /\{(\d+)\+?\}$/.exec(line);
        if (m) {
          const literal = await this.io.readExact(Number(m[1]));
          let close = await this.io.readLineString();
          if (close === '') close = await this.io.readLineString();
          untagged.push({ text: close ? `${line} ${close}` : line, literal });
        } else {
          untagged.push({ text: line });
        }
        continue;
      }
      fail(`IMAP: unexpected line: ${line.slice(0, 120)}`);
    }
  }

  async command(line: string): Promise<{ text: string; untagged: Untagged[] }> {
    const tag = this.nextTag();
    await this.io.writeLine(`${tag} ${line}`);
    return this.readResponse(tag);
  }

  async greeting(): Promise<void> {
    const line = await this.io.readLineString();
    if (/^\* (OK|PREAUTH)\b/.test(line)) return;
    fail(`IMAP: bad greeting: ${line.slice(0, 200)}`);
  }
}

export async function imapSession<T>(
  cfg: ImapConfig,
  folder: string,
  work: (client: ImapClient) => Promise<T>,
  connect: ConnectFn = cfConnect,
  timeoutMs = 20_000,
): Promise<T> {
  let socket = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: cfg.security === 'tls' ? 'on' : cfg.security === 'starttls' ? 'starttls' : 'off', allowHalfOpen: false });
  const tags = { n: 0 };
  let io = new ImapIo(new ByteIo(socket, timeoutMs, 'IMAP server timed out.'), tags);
  try {
    await io.greeting();
    if (cfg.security === 'starttls') {
      await io.command('STARTTLS');
      const leftover = io.takeBuffered();
      io.release();
      socket = socket.startTls();
      io = new ImapIo(new ByteIo(socket, timeoutMs, 'IMAP server timed out.', leftover), tags);
      // RFC 3501: no new greeting after STARTTLS.
    }
    await io.command(`LOGIN ${quote(cfg.username)} ${quote(cfg.password)}`);
    const client: ImapClient = {
      async select() {
        const { untagged } = await io.command(`SELECT ${quote(folder)}`);
        let uidvalidity: number | null = null;
        let exists = 0;
        for (const u of untagged) {
          const v = /\[UIDVALIDITY (\d+)\]/.exec(u.text);
          if (v) uidvalidity = Number(v[1]);
          const e = /^\* (\d+) EXISTS/.exec(u.text);
          if (e) exists = Number(e[1]);
        }
        return { uidvalidity, exists };
      },
      async uidSearchAll() {
        const { untagged } = await io.command('UID SEARCH ALL');
        const out: number[] = [];
        for (const u of untagged) {
          const m = /^\* SEARCH\s*(.*)$/.exec(u.text);
          if (!m) continue;
          for (const n of m[1].trim().split(/\s+/).filter(Boolean)) {
            const v = Number(n);
            if (Number.isInteger(v)) out.push(v);
          }
        }
        return out;
      },
      async fetchBody(uid: number) {
        const { untagged } = await io.command(`UID FETCH ${uid} (BODY[])`);
        const hit = untagged.find((u) => u.literal !== undefined);
        if (!hit?.literal) fail(`IMAP: no message body for UID ${uid}`);
        return hit.literal;
      },
      async markSeen(uid: number) {
        await io.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
      },
      async markDeleted(uid: number) {
        await io.command(`UID STORE ${uid} +FLAGS (\\Deleted)`);
      },
      async expunge() {
        await io.command('EXPUNGE');
      },
    };
    const result = await work(client);
    await io.command('LOGOUT').catch(() => undefined);
    return result;
  } finally {
    try {
      await socket.close();
    } catch {
      // already closed
    }
  }
}

// Connect, log in, SELECT the folder, quit — no messages downloaded.
export async function imapValidate(cfg: ImapConfig, folder: string, connect: ConnectFn = cfConnect): Promise<{ uidvalidity: number | null; exists: number }> {
  return imapSession(cfg, folder, (c) => c.select(), connect);
}
