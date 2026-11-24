// Minimal POP3 client over Workers TCP sockets, modeled on providers/smtp.ts.
// Greeting, USER/PASS, STAT, LIST, UIDL, RETR, DELE, QUIT. Multiline responses
// end with a line holding only "." and use dot-stuffing. The message bytes from
// RETR are kept exact (lines joined with CRLF) for the ingest pipeline.
import { connect as cfConnect } from 'cloudflare:sockets';
import { ByteIo } from './io';
import { ProviderError } from './types';

export interface Pop3Config {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'plain';
  username: string;
  password: string;
}

type ConnectFn = typeof cfConnect;

export interface Pop3Client {
  stat(): Promise<{ count: number; octets: number }>;
  uidl(): Promise<Map<number, string>>;
  retr(msg: number): Promise<Uint8Array>;
  dele(msg: number): Promise<void>;
}

function fail(message: string, retryable = false): never {
  throw new ProviderError(message, retryable);
}

class Pop3Io {
  constructor(private io: ByteIo) {}

  release(): void {
    this.io.release();
  }

  takeBuffered(): Uint8Array {
    return this.io.takeBuffered();
  }

  // One +OK/-ERR status line.
  async status(): Promise<string> {
    const line = await this.io.readLineString();
    if (line.startsWith('+OK')) return line.slice(3).trim();
    if (line.startsWith('-ERR')) fail(`POP3: ${line.slice(4).trim() || 'error'}`);
    fail(`POP3: unexpected response: ${line.slice(0, 120)}`);
  }

  async command(line: string): Promise<string> {
    await this.io.writeLine(line);
    return this.status();
  }

  // A multiline response: lines until a lone ".", with dot-stuffing removed.
  async multiline(): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (;;) {
      const line = await this.io.readLine();
      if (line.byteLength === 1 && line[0] === 0x2e) return out;
      // A line starting with ".." carries one stuffed dot: drop the first.
      out.push(line.byteLength >= 2 && line[0] === 0x2e && line[1] === 0x2e ? line.subarray(1) : line);
    }
  }
}

export async function pop3Session<T>(
  cfg: Pop3Config,
  work: (client: Pop3Client) => Promise<T>,
  connect: ConnectFn = cfConnect,
  timeoutMs = 20_000,
): Promise<T> {
  let socket = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: cfg.security === 'tls' ? 'on' : cfg.security === 'starttls' ? 'starttls' : 'off', allowHalfOpen: false });
  let io = new Pop3Io(new ByteIo(socket, timeoutMs, 'POP3 server timed out.'));
  try {
    await io.status(); // greeting
    if (cfg.security === 'starttls') {
      await io.command('STLS');
      const leftover = io.takeBuffered();
      io.release();
      socket = socket.startTls();
      io = new Pop3Io(new ByteIo(socket, timeoutMs, 'POP3 server timed out.', leftover));
      // RFC 2595: the server sends a fresh greeting once TLS is up.
      await io.status();
    }
    await io.command(`USER ${cfg.username}`);
    await io.command(`PASS ${cfg.password}`);
    const client: Pop3Client = {
      async stat() {
        const text = await io.command('STAT');
        const [count, octets] = text.split(/\s+/).map((n) => Number(n));
        if (!Number.isFinite(count) || !Number.isFinite(octets)) fail(`POP3: bad STAT response: ${text.slice(0, 120)}`);
        return { count, octets };
      },
      async uidl() {
        await io.command('UIDL');
        const lines = await io.multiline();
        const map = new Map<number, string>();
        for (const raw of lines) {
          const [num, uid] = ByteIo.decode(raw).split(/\s+/);
          const n = Number(num);
          if (Number.isInteger(n) && uid) map.set(n, uid);
        }
        return map;
      },
      async retr(msg: number) {
        await io.command(`RETR ${msg}`);
        const lines = await io.multiline();
        const crlf = new Uint8Array([0x0d, 0x0a]);
        let size = 0;
        for (const l of lines) size += l.byteLength + 2;
        const out = new Uint8Array(size);
        let at = 0;
        for (const l of lines) {
          out.set(l, at);
          at += l.byteLength;
          out.set(crlf, at);
          at += 2;
        }
        return out;
      },
      async dele(msg: number) {
        await io.command(`DELE ${msg}`);
      },
    };
    const result = await work(client);
    await io.command('QUIT').catch(() => undefined);
    return result;
  } finally {
    try {
      await socket.close();
    } catch {
      // already closed
    }
  }
}

// Connect, log in, STAT, quit — no messages downloaded.
export async function pop3Validate(cfg: Pop3Config, connect: ConnectFn = cfConnect): Promise<{ count: number; octets: number }> {
  return pop3Session(cfg, (c) => c.stat(), connect);
}
