/**
 * `openCmuxEventStream` against a real Unix domain socket connection — the ack-then-push behaviour
 * `src/cmux/eventStream.ts`'s own header documents as measured live, proven here against a real socket
 * rather than only asserted in prose. Companion to `socketProtocol.test.ts`; same fake-server rationale,
 * cmux Option C.
 */
import { afterEach, describe, expect, it } from "vitest";

import { drainUntil, openCmuxEventStream } from "../../../cmux/eventStream.js";
import { deferred } from "../../../lib/deferred.js";
import { unwrap } from "../../../lib/result.js";
import { type FakeCmuxServer, startFakeCmuxServer } from "./fakeCmuxServer.js";

const ACK_FRAME = {
  filters: { categories: [], names: [] },
  protocol: "cmux-events",
  replay_count: 2,
  resume: { after_seq: 1, gap: false, latest_seq: 3, next_seq: 4, oldest_seq: 1 },
  subscription_id: "sub-1",
  type: "ack",
  version: 1,
} as const;

function eventFrame({ seq }: { seq: number }): Record<string, unknown> {
  return {
    category: "agent",
    id: `boot-${String(seq)}`,
    name: "agent.hook.Stop",
    occurred_at: "2026-09-01T00:00:00.000Z",
    payload: {},
    seq,
    type: "event",
  };
}

/** Every fake server this file has started, so `afterEach` can shut each one down. */
const servers: FakeCmuxServer[] = [];

async function server(options: Parameters<typeof startFakeCmuxServer>[0] = {}): Promise<FakeCmuxServer> {
  const started = await startFakeCmuxServer(options);
  servers.push(started);
  return started;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((one) => one.close()));
});

describe("openCmuxEventStream", () => {
  it("delivers the subscription ack", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { method: string } = JSON.parse(line);
        if (request.method === "events.stream") {
          connection.writeFrame({ value: ACK_FRAME });
        }
      },
    });
    const acked = deferred<{ subscriptionId: string; replayCount: number }>();
    const stream = openCmuxEventStream({
      handlers: {
        onAck: ({ ack }) =>
          acked.settle({ value: { replayCount: ack.replayCount, subscriptionId: ack.subscriptionId } }),
        onEnd: () => {},
        onEvent: () => {},
      },
      socketPath: fake.socketPath,
      subscription: {},
    });

    const ack = await acked.promise;

    expect(ack).toEqual({ replayCount: 2, subscriptionId: "sub-1" });
    stream.close();
  });

  it("delivers events pushed after the ack, in order, on the same connection", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { method: string } = JSON.parse(line);
        if (request.method !== "events.stream") {
          return;
        }
        connection.writeFrame({ value: ACK_FRAME });
        connection.writeFrame({ value: eventFrame({ seq: 2 }) });
        connection.writeFrame({ value: eventFrame({ seq: 3 }) });
      },
    });
    const seenSeqs: number[] = [];
    const done = deferred<void>();
    const stream = openCmuxEventStream({
      handlers: {
        onAck: () => {},
        onEnd: () => {},
        onEvent: ({ event }) => {
          seenSeqs.push(event.seq);
          if (seenSeqs.length === 2) {
            done.settle({ value: undefined });
          }
        },
      },
      socketPath: fake.socketPath,
      subscription: {},
    });

    await done.promise;

    expect(seenSeqs).toEqual([2, 3]);
    stream.close();
  });

  it("calls onEnd exactly once when the server closes the connection", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { method: string } = JSON.parse(line);
        if (request.method === "events.stream") {
          connection.writeFrame({ value: ACK_FRAME });
          connection.end();
        }
      },
    });
    const ends: (Error | undefined)[] = [];
    const done = deferred<void>();
    openCmuxEventStream({
      handlers: {
        onAck: () => {},
        onEnd: ({ error }) => {
          ends.push(error === undefined ? undefined : new Error(error.message));
          done.settle({ value: undefined });
        },
        onEvent: () => {},
      },
      socketPath: fake.socketPath,
      subscription: {},
    });

    await done.promise;

    expect(ends).toHaveLength(1);
  });

  it("presents a named capability on the subscribe frame and still reads the feed after it", async () => {
    const presented: (string | undefined)[] = [];
    const fake = await server({
      onLine: ({ capability, connection, line }) => {
        const request: { method: string } = JSON.parse(line);
        presented.push(capability);
        if (request.method === "events.stream") {
          connection.writeFrame({ value: ACK_FRAME });
          connection.writeFrame({ value: eventFrame({ seq: 2 }) });
        }
      },
    });
    const seen = deferred<number>();
    const stream = openCmuxEventStream({
      capability: "v1.sentinel",
      handlers: { onAck: () => {}, onEnd: () => {}, onEvent: ({ event }) => seen.settle({ value: event.seq }) },
      socketPath: fake.socketPath,
      subscription: {},
    });

    expect(await seen.promise).toBe(2);
    expect(presented).toEqual(["v1.sentinel"]);
    stream.close();
  });

  it.each([
    ["terminated", "ERROR: Access denied - only processes started inside cmux can connect\n"],
    ["unterminated", "ERROR: Access denied - only processes started inside cmux can connect"],
  ])("ends with SOCKET_UNAVAILABLE on a %s cmuxOnly refusal, never a clean end", async (_shape, chunk) => {
    const fake = await server({
      onLine: ({ connection }) => {
        connection.writeRaw({ chunk });
        connection.end();
      },
    });
    const ends: (string | undefined)[] = [];
    const done = deferred<void>();
    openCmuxEventStream({
      handlers: {
        onAck: () => {},
        onEnd: ({ error }) => {
          ends.push(error === undefined ? undefined : `${error.code}: ${error.message}`);
          done.settle({ value: undefined });
        },
        onEvent: () => {},
      },
      socketPath: fake.socketPath,
      subscription: {},
    });

    await done.promise;

    expect(ends).toHaveLength(1);
    expect(ends[0]).toContain("SOCKET_UNAVAILABLE: cmux control socket unavailable at");
    expect(ends[0]).toContain("cmux refused the connection: Access denied");
  });

  it("calling close() ends the stream itself, with no error", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { method: string } = JSON.parse(line);
        if (request.method === "events.stream") {
          connection.writeFrame({ value: ACK_FRAME });
        }
      },
    });
    const acked = deferred<void>();
    const ended = deferred<{ hadError: boolean }>();
    const stream = openCmuxEventStream({
      handlers: {
        onAck: () => acked.settle({ value: undefined }),
        onEnd: ({ error }) => ended.settle({ value: { hadError: error !== undefined } }),
        onEvent: () => {},
      },
      socketPath: fake.socketPath,
      subscription: {},
    });
    await acked.promise;

    stream.close();
    stream.close(); // safe to call twice — onEnd must still fire exactly once

    expect(await ended.promise).toEqual({ hadError: false });
  });

  it("drainUntil returns the matching event over a real socket, whose close() ends synchronously", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { method: string } = JSON.parse(line);
        if (request.method !== "events.stream") {
          return;
        }
        connection.writeFrame({ value: { ...ACK_FRAME, resume: { ...ACK_FRAME.resume, gap: true } } });
        connection.writeFrame({ value: eventFrame({ seq: 2 }) });
        connection.writeFrame({ value: eventFrame({ seq: 3 }) });
      },
    });

    const drained = await drainUntil({
      deadlineMs: 10_000,
      quietMs: 5_000,
      socketPath: fake.socketPath,
      stopWhen: ({ event }) => event.seq === 3,
      subscription: { afterSeq: 0 },
    });

    expect(unwrap(drained).gap).toBe(true);
    expect(unwrap(drained).match!.seq).toBe(3);
  });

  it("reports SOCKET_UNAVAILABLE through onEnd when nothing is listening", async () => {
    const fake = await server();
    await fake.close();
    const ended = deferred<{ code: string | undefined }>();
    openCmuxEventStream({
      handlers: {
        onAck: () => {},
        onEnd: ({ error }) => ended.settle({ value: { code: error?.code } }),
        onEvent: () => {},
      },
      socketPath: fake.socketPath,
      subscription: {},
    });

    expect(await ended.promise).toEqual({ code: "SOCKET_UNAVAILABLE" });
  });
});
