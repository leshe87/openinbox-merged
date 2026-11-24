// In-process fake for `cloudflare:sockets` connect(): the client under test
// reads a scripted server transcript and its writes are recorded. The whole
// transcript can be pre-loaded (the protocols are lock-step request/response),
// or pushed mid-session with push(). startTls() returns the same socket: the
// client releases its readers/writers first, exactly like the real flow.
import type { connect as cfConnect } from 'cloudflare:sockets';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class FakeSocket {
  written: string[] = [];
  private chunks: Uint8Array[] = [];
  private notify: (() => void) | null = null;
  private closedFlag = false;
  private resolveClosed!: () => void;
  closed: Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(script: (string | Uint8Array)[] = []) {
    for (const item of script) this.push(item);
    this.closed = new Promise<void>((r) => {
      this.resolveClosed = r;
    });
    this.readable = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (this.chunks.length === 0) {
          if (this.closedFlag) {
            controller.close();
            return;
          }
          await new Promise<void>((r) => {
            this.notify = r;
          });
        }
        controller.enqueue(this.chunks.shift()!);
      },
      cancel: () => {
        this.closedFlag = true;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(decoder.decode(chunk));
      },
    });
  }

  push(data: string | Uint8Array): void {
    this.chunks.push(typeof data === 'string' ? encoder.encode(data) : data);
    this.notify?.();
    this.notify = null;
  }

  close(): Promise<void> {
    this.closedFlag = true;
    this.notify?.();
    this.notify = null;
    this.resolveClosed();
    return Promise.resolve();
  }

  startTls(): Socket {
    return this as unknown as Socket;
  }
}

// A connect() that always hands out this socket, ignoring the address.
export function fakeConnect(socket: FakeSocket): typeof cfConnect {
  return (() => socket as unknown as Socket) as unknown as typeof cfConnect;
}

// Split a transcript into odd-sized pieces: the client's byte buffer must
// reassemble lines and literals across chunk boundaries.
export function chunked(transcript: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < transcript.length; i += size) out.push(transcript.slice(i, i + size));
  return out;
}
