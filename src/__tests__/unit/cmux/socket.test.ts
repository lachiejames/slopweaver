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
