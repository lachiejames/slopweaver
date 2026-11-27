/**
 * {@link withSocketRetry} — the fix for `cmux control socket unavailable at
 * ~/.local/state/cmux/cmux-501.sock: write EPIPE`, four times in one night. Pure with respect
 * to I/O: `openFresh` and `wait` are fakes here, never a real socket, so this proves the RETRY POLICY —
 * reconnect-and-retry on `SOCKET_UNAVAILABLE`, never on anything else — without cmux running at all.
 *
 * A hand-written scripted transport, never `vi.fn`/`vi.mock`: each `openFresh()` call hands back the next
 * queued connection, so a test asserts exactly which connection answered which attempt.
 */
import { describe, expect, it } from "vitest";

import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import { type CmuxSocket, withSocketRetry } from "../../../cmux/socket.js";
import { err, ok, type Result, unwrapErr } from "../../../lib/result.js";

const SOCKET_DOWN = CmuxErrors.socketUnavailable({ detail: "write EPIPE", socketPath: "/tmp/cmux.sock" });
const CALL_REJECTED = CmuxErrors.callFailed({ cmuxCode: "invalid_params", message: "bad params", method: "x" });

/**
 * A fixed sequence of connections wrapped in {@link withSocketRetry}: each `openFresh()` call hands back the
 * next scripted connection in order, and every open, close and backoff wait is recorded so a test can assert
 * on them without any real socket.
 */
function scriptedSocket({ results }: { results: readonly Result<unknown, CmuxError>[] }): {
  socket: CmuxSocket;
  waits: number[];
  opensCount: () => number;
  closed: () => readonly boolean[];
} {
  const closesPerConnection: boolean[] = [];
  const waits: number[] = [];
  let opens = 0;
  const openFresh = (): CmuxSocket => {
    const index = opens;
    opens += 1;
    closesPerConnection.push(false);
    const result = results[index];
    return {
      call: () => Promise.resolve(result!),
      close: () => {
        closesPerConnection[index] = true;
      },
    };
  };
  const socket = withSocketRetry({
    attempts: 3,
    backoffMs: [250, 750, 1_500],
    openFresh,
    wait: ({ delayMs }) => {
      waits.push(delayMs);
      return Promise.resolve();
    },
  });
  return { closed: () => closesPerConnection, opensCount: () => opens, socket, waits };
}

describe("withSocketRetry", () => {
  it("reconnects once and succeeds, closing the dead connection and waiting the first backoff", async () => {
    const { closed, opensCount, socket, waits } = scriptedSocket({ results: [err(SOCKET_DOWN), ok("booted")] });

    const result = await socket.call({ method: "workspace.list", params: {} });

    expect(result.isOk()).toBe(true);
    expect(opensCount()).toBe(2);
    expect(closed()).toEqual([true, false]);
    expect(waits).toEqual([250]);
  });

  it("gives up after the attempt bound, returning the last SOCKET_UNAVAILABLE failure, the dead connection retired", async () => {
    const { closed, opensCount, socket, waits } = scriptedSocket({
      results: [err(SOCKET_DOWN), err(SOCKET_DOWN), err(SOCKET_DOWN)],
    });

    const result = await socket.call({ method: "workspace.list", params: {} });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SOCKET_UNAVAILABLE");
    expect(opensCount()).toBe(3);
    expect(closed()).toEqual([true, true, true]);
    expect(waits).toEqual([250, 750]);
  });

  it.each(["surface.send_text", "surface.send_key", "workspace.create"])(
    "never replays %s — cmux may have applied it before the reply was lost, and a replay applies it twice",
    async (method) => {
      const { opensCount, socket, waits } = scriptedSocket({ results: [err(SOCKET_DOWN), ok("never reached")] });

      const result = await socket.call({ method, params: {} });

      expect(unwrapErr(result)).toEqual(SOCKET_DOWN);
      expect(opensCount()).toBe(1);
      expect(waits).toEqual([]);
    },
  );

  it("starts the call after a failed create on a FRESH connection, with its whole retry budget", async () => {
    const { closed, opensCount, socket } = scriptedSocket({
      results: [err(SOCKET_DOWN), err(SOCKET_DOWN), err(SOCKET_DOWN), ok("listed")],
    });

    const created = await socket.call({ method: "workspace.create", params: {} });
    const listed = await socket.call({ method: "workspace.list", params: {} });

    expect(unwrapErr(created)).toEqual(SOCKET_DOWN);
    expect(listed.isOk()).toBe(true);
    expect(opensCount()).toBe(4);
    expect(closed()).toEqual([true, true, true, false]);
  });

  it("opens ONE replacement when two calls in flight fail on the same dead connection", async () => {
    const { closed, opensCount, socket } = scriptedSocket({ results: [err(SOCKET_DOWN), ok("answered")] });

    const [first, second] = await Promise.all([
      socket.call({ method: "workspace.list", params: {} }),
      socket.call({ method: "surface.read_text", params: {} }),
    ]);

    expect([first.isOk(), second.isOk()]).toEqual([true, true]);
    expect(opensCount()).toBe(2);
    expect(closed()).toEqual([true, false]);
  });

  it("never retries a non-transient failure — a real reply from a live connection, not a dead transport", async () => {
    const { opensCount, socket, waits } = scriptedSocket({ results: [err(CALL_REJECTED), ok("never reached")] });

    const result = await socket.call({ method: "workspace.action", params: {} });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CALL_FAILED");
    expect(opensCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("never retries an access refusal — a fresh connection from the same process is refused the same way", async () => {
    const denied = CmuxErrors.accessDenied({
      refusal: "Access denied - only processes started inside cmux can connect",
      socketPath: "/tmp/cmux.sock",
    });
    const { opensCount, socket, waits } = scriptedSocket({ results: [err(denied), ok("never reached")] });

    const result = await socket.call({ method: "workspace.list", params: {} });

    expect(unwrapErr(result)).toEqual(denied);
    expect(opensCount()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("close() closes only the current connection, after a reconnect moved past the dead one", async () => {
    const { closed, socket } = scriptedSocket({ results: [err(SOCKET_DOWN), ok("booted")] });

    await socket.call({ method: "workspace.list", params: {} });
    socket.close();

    expect(closed()).toEqual([true, true]);
  });
});

/** cmux's rate-limit answer to a screen read, with a hint, as `./socketFrames.ts` decodes the measured frame. */
const READ_PACED = CmuxErrors.rateLimited({
  message: "Polling rate limited for this connection",
  method: "surface.read_text",
  retryAfterMs: 92,
});

/**
 * ONE live connection answering each send with the next scripted answer, wrapped in {@link withSocketRetry}: the
 * shape a rate limit has, where the connection is fine and only the pacing refused.
 */
function pacedSocket({ answers }: { answers: readonly Result<unknown, CmuxError>[] }): {
  socket: CmuxSocket;
  waits: number[];
  sends: () => number;
  opensCount: () => number;
  closed: () => boolean;
} {
  const waits: number[] = [];
  let sends = 0;
  let opens = 0;
  let closed = false;
  const socket = withSocketRetry({
    openFresh: () => {
      opens += 1;
      return {
        call: () => {
          const answer = answers[sends];
          sends += 1;
          return Promise.resolve(answer!);
        },
        close: () => {
          closed = true;
        },
      };
    },
    wait: ({ delayMs }) => {
      waits.push(delayMs);
      return Promise.resolve();
    },
  });
  return { closed: () => closed, opensCount: () => opens, sends: () => sends, socket, waits };
}

describe("withSocketRetry on a rate-limited screen read", () => {
  it("waits cmux's own hint and asks the same connection again, retiring nothing", async () => {
    const { closed, opensCount, sends, socket, waits } = pacedSocket({ answers: [err(READ_PACED), ok("screen")] });

    const result = await socket.call({ method: "surface.read_text", params: {} });

    expect(result.isOk()).toBe(true);
    expect(sends()).toBe(2);
    expect(waits).toEqual([92]);
    expect(opensCount()).toBe(1);
    expect(closed()).toBe(false);
  });

  it("stops after three sends in all, returning the rate limit as it came", async () => {
    const { sends, socket, waits } = pacedSocket({
      answers: [err(READ_PACED), err(READ_PACED), err(READ_PACED), ok("never reached")],
    });

    const result = await socket.call({ method: "surface.read_text", params: {} });

    expect(unwrapErr(result)).toEqual(READ_PACED);
    expect(sends()).toBe(3);
    expect(waits).toEqual([92, 92]);
  });

  it("returns a rate limit with no hint, or a hint over the cap, without waiting", async () => {
    const noHint = CmuxErrors.rateLimited({ message: "m", method: "surface.read_text", retryAfterMs: undefined });
    const longHint = CmuxErrors.rateLimited({ message: "m", method: "surface.read_text", retryAfterMs: 1_001 });

    for (const paced of [noHint, longHint]) {
      const { sends, socket, waits } = pacedSocket({ answers: [err(paced), ok("never reached")] });
      expect(unwrapErr(await socket.call({ method: "surface.read_text", params: {} }))).toEqual(paced);
      expect(sends()).toBe(1);
      expect(waits).toEqual([]);
    }
  });

  it("resends the process tree and inventory reads the same way, each after its own hint", async () => {
    const sent = ["system.top", "workspace.list"].map(async (method) => {
      const paced = CmuxErrors.rateLimited({ message: "m", method, retryAfterMs: 40 });
      const { sends, socket, waits } = pacedSocket({ answers: [err(paced), ok("read")] });
      const result = await socket.call({ method, params: {} });
      return { ok: result.isOk(), sends: sends(), waits };
    });

    expect(await Promise.all(sent)).toEqual([
      { ok: true, sends: 2, waits: [40] },
      { ok: true, sends: 2, waits: [40] },
    ]);
  });

  it("never resends a rate-limited keystroke, which no measurement says cmux refused before running", async () => {
    const paced = CmuxErrors.rateLimited({ message: "m", method: "surface.send_key", retryAfterMs: 92 });
    const { sends, socket, waits } = pacedSocket({ answers: [err(paced), ok("typed twice")] });

    const result = await socket.call({ method: "surface.send_key", params: {} });

    expect(unwrapErr(result)).toEqual(paced);
    expect(sends()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("spends no reconnect on a rate limit: a dead transport after one still gets its full reconnect budget", async () => {
    const { closed, sends, socket, waits } = pacedSocket({
      answers: [err(READ_PACED), err(SOCKET_DOWN), err(SOCKET_DOWN), ok("screen")],
    });

    const result = await socket.call({ method: "surface.read_text", params: {} });

    expect(result.isOk()).toBe(true);
    expect(sends()).toBe(4);
    expect(waits).toEqual([92, 250, 750]);
    expect(closed()).toBe(true);
  });
});
