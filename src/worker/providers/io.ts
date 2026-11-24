// Byte-oriented I/O over a Workers TCP socket, shared by the line-based mail
// clients (POP3, IMAP). Lines are read as bytes so a fetched message keeps its
// exact octets; status lines are decoded as latin1 on top. Literals (IMAP's
// byte-counted reads) come from the same buffer via readExact().
import { ProviderError } from './types';

const decoder = new TextDecoder();
const latin1 = new TextDecoder('iso-8859-1');
const encoder = new TextEncoder();

export class ByteIo {
  // Subarray() keeps the buffer's element type, so the field is typed with
  // ArrayBufferLike: chunks arriving from the socket are ArrayBufferLike.
  private buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;

  constructor(
    private socket: Socket,
    private timeoutMs = 20_000,
    private timeoutMessage = 'Mail server timed out.',
    initial?: Uint8Array,
  ) {
    if (initial?.byteLength) this.buf = initial;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  // Bytes read from the socket but not yet consumed. A STARTTLS upgrade swaps
  // the socket (and the ByteIo with it); the leftover must move to the new
  // reader or the reply lines already buffered are lost.
  takeBuffered(): Uint8Array {
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }

  release(): void {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  get closed(): Promise<void> {
    return this.socket.closed;
  }

  async close(): Promise<void> {
    try {
      await this.socket.close();
    } catch {
      // already closed
    }
  }

  async write(data: string | Uint8Array): Promise<void> {
    await this.writer.write(typeof data === 'string' ? encoder.encode(data) : data);
  }

  async writeLine(line: string): Promise<void> {
    await this.write(`${line}\r\n`);
  }

  // Fill the buffer with at least one more chunk. False when the server closed.
  private async fill(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError(this.timeoutMessage, true)), this.timeoutMs);
    });
    const { value, done } = await Promise.race([this.reader.read(), timeout]).finally(() => clearTimeout(timer));
    if (done) return false;
    if (value.byteLength) {
      const next = new Uint8Array(this.buf.byteLength + value.byteLength);
      next.set(this.buf);
      next.set(value, this.buf.byteLength);
      this.buf = next;
    }
    return true;
  }

  // One line without its CRLF, as raw bytes. Throws when the server closes.
  async readLine(): Promise<Uint8Array> {
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl >= 0) {
        const line = this.buf.subarray(0, nl);
        this.buf = this.buf.subarray(nl + 1);
        return line.byteLength && line[line.byteLength - 1] === 0x0d ? line.subarray(0, line.byteLength - 1) : line;
      }
      if (!(await this.fill())) throw new ProviderError('Mail server closed the connection.', true);
    }
  }

  async readLineString(): Promise<string> {
    return latin1.decode(await this.readLine());
  }

  // Exactly n bytes, spanning chunk boundaries. Throws on close or timeout.
  async readExact(n: number): Promise<Uint8Array> {
    while (this.buf.byteLength < n) {
      if (!(await this.fill())) throw new ProviderError('Mail server closed the connection.', true);
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  // Decode a status line (ASCII by spec).
  static decode(line: Uint8Array): string {
    return decoder.decode(line);
  }
}
