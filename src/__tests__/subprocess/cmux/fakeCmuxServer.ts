/**
 * A fake cmux control socket — a real Unix domain socket server speaking the exact newline-delimited-JSON
 * wire format `src/cmux/socketFrames.ts` documents, so `openCmuxSocket`/`openCmuxEventStream` talk to it
 * exactly as they would talk to the real cmux app.
 *
 * Built for the cmux lane's Option C:
 * a free, deterministic double that can force conditions a real running cmux app cannot reliably be made to
 * produce on demand — a reply split across two writes, two replies glued into one write, a call that never
 * answers, a connection that drops mid-call — plus an opt-in smoke test against the real thing
 * (`realCmuxSmoke.test.ts`) for "does this still actually talk to it today".
 *
 * Filesystem-and-Unix-socket only (a temp socket file under `mkdtempSync`, no network, no external process),
 * which `.claude/rules/testing.md` permits for exactly this kind of genuine round-trip.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One accepted connection, as the fake server hands it to a test's `onLine`/`onConnection` callback. */
export interface FakeCmuxConnection {
  /** Write raw bytes with no framing added — a test controls exactly where the newline lands. */
  readonly writeRaw: (options: { chunk: string }) => void;
  /** Write one JSON value as a single newline-terminated frame — the common case. */
  readonly writeFrame: (options: { value: unknown }) => void;
  /** Half-close the connection, the way a well-behaved server ending a call would. */
  readonly end: () => void;
  /** Drop the connection immediately, with no FIN — the way a crashed or killed server would. */
  readonly destroy: () => void;
}

/** A running fake server: where to connect, and how to shut it down. */
export interface FakeCmuxServer {
  readonly socketPath: string;
  /** Destroy every open connection, stop listening, and remove the temp directory. */
  readonly close: () => Promise<void>;
}

/** The callbacks a test supplies to {@link startFakeCmuxServer}. */
interface FakeCmuxServerHandlers {
  /**
   * Called once per complete newline-delimited frame a connected client sends — with the capability prefix
   * stripped the way real cmux strips it, and the token it carried (`undefined` when none), so a test can
   * assert what was presented without every JSON-parsing handler learning the prefix.
   */
  onLine?: (options: { connection: FakeCmuxConnection; line: string; capability: string | undefined }) => void;
  /** Called once per new connection, before any frame from it has arrived. */
  onConnection?: (options: { connection: FakeCmuxConnection }) => void;
}

/**
 * Wire one accepted connection: build its {@link FakeCmuxConnection} wrapper, register it for cleanup, and
 * frame its incoming bytes into lines exactly the way `src/cmux/socket.ts`'s own client does.
 *
 * @param socket the newly accepted raw socket
 * @param sockets every open connection this server is tracking, so `close()` can destroy them all
 * @param handlers the test's `onLine`/`onConnection` callbacks
 */
function handleConnection({
  socket,
  sockets,
  handlers,
}: {
  socket: Socket;
  sockets: Set<Socket>;
  handlers: FakeCmuxServerHandlers;
}): void {
  sockets.add(socket);
  socket.setEncoding("utf8");
  let buffer = "";
  const connection: FakeCmuxConnection = {
    destroy: () => socket.destroy(),
    end: () => socket.end(),
    writeFrame: ({ value }) => socket.write(`${JSON.stringify(value)}\n`),
    writeRaw: ({ chunk }) => socket.write(chunk),
  };
  socket.on("close", () => sockets.delete(socket));
  handlers.onConnection?.({ connection });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    // `String.split` never returns an empty array, so `pop()` always has a value here — asserted rather
    // than coalesced, same reasoning as `socketFrames.ts`'s own `splitFrames`.
    buffer = parts.pop()!;
    for (const line of parts) {
      if (line.trim().length > 0) {
        handlers.onLine?.({ connection, ...withoutCapability({ line }) });
      }
    }
  });
}

/** The prefix cmux's own CLI writes ahead of a request (`src/cmux/socketFrames.ts`'s `encodeRequest`). */
const CAPABILITY_PREFIX = /^_cmux_capability_v1 (\S+) /u;

/** One frame with any capability prefix removed, and the token it carried. */
function withoutCapability({ line }: { line: string }): { line: string; capability: string | undefined } {
  const match = CAPABILITY_PREFIX.exec(line);
  if (match === null) {
    return { capability: undefined, line };
  }
  return { capability: match[1], line: line.slice(match[0].length) };
}

/**
 * Start a fake cmux server listening on a fresh Unix socket in its own throwaway temp directory.
 *
 * @param handlers the test's `onLine`/`onConnection` callbacks, both optional
 * @returns the socket path to connect to, and how to shut the server down
 */
export async function startFakeCmuxServer(handlers: FakeCmuxServerHandlers = {}): Promise<FakeCmuxServer> {
  const dir = mkdtempSync(join(tmpdir(), "fake-cmux-"));
  const socketPath = join(dir, "s.sock");
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    handleConnection({ handlers, socket, sockets });
  });

  await new Promise<void>((resolve) => {
    server.listen(socketPath, resolve);
  });

  let closed = false;
  return {
    close: () => {
      if (closed) {
        return Promise.resolve();
      }
      closed = true;
      return new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          rmSync(dir, { force: true, recursive: true });
          resolve();
        });
      });
    },
    socketPath,
  };
}

/** Pause briefly — used only to force a reply across two separate `data` events, never as a timing assertion. */
export async function wait({ ms }: { ms: number }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
