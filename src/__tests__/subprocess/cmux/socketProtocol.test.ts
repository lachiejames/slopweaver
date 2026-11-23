/**
 * `openCmuxSocket` against a real Unix domain socket connection — the framing, multiplexing, timeout and
 * disconnect behaviour that `src/__tests__/unit/cmux/socket.test.ts` cannot reach, because that suite proves
 * `withSocketRetry`'s reconnect POLICY against a hand-written fake `CmuxSocket`, never the real `node:net`
 * plumbing underneath. This is the missing leg: real bytes, over a real socket, framed and multiplexed the
 * way `src/cmux/socket.ts` actually does it.
 *
 * Built for the cmux lane's Option C: a free,
 * deterministic double (`fakeCmuxServer.ts`) rather than a real running cmux app, because only a double can
 * be told on purpose to split a reply across two writes, glue two replies into one, or never answer at all —
 * exactly the conditions a real app cannot reliably be made to produce on demand.
 */
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openCmuxSocket } from "../../../cmux/socket.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type FakeCmuxConnection, type FakeCmuxServer, startFakeCmuxServer, wait } from "./fakeCmuxServer.js";

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

describe("openCmuxSocket — a real call over a real socket", () => {
  it("round-trips a request and its reply", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { id: string } = JSON.parse(line);
        connection.writeFrame({ value: { id: request.id, ok: true, result: { pong: true } } });
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const result = await socket.call({ method: "system.ping" });

    expect(unwrap(result)).toEqual({ pong: true });
    socket.close();
  });

  it("carries an error frame back as a typed CALL_FAILED", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { id: string } = JSON.parse(line);
        connection.writeFrame({
          value: { error: { code: "not_found", message: "Workspace not found" }, id: request.id, ok: false },
        });
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const result = await socket.call({ method: "workspace.close" });

    expect(unwrapErr(result).code).toBe("CALL_FAILED");
    socket.close();
  });
});

describe("openCmuxSocket — multiplexing", () => {
  it("resolves each in-flight call to its own reply, even when replies arrive in reverse order", async () => {
    const requests: { id: string; method: string }[] = [];
    let connectionRef: FakeCmuxConnection | undefined;
    const fake = await server({
      onLine: ({ connection, line }) => {
        connectionRef = connection;
        requests.push(JSON.parse(line));
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const listCall = socket.call({ method: "workspace.list" });
    const openCall = socket.call({ method: "workspace.open" });
    while (requests.length < 2) {
      await wait({ ms: 5 });
    }
    const openRequest = requests.find((request) => request.method === "workspace.open")!;
    const listRequest = requests.find((request) => request.method === "workspace.list")!;
    // Reply to the SECOND call sent, first — proving correlation is by id, not by send/reply order.
    connectionRef!.writeFrame({ value: { id: openRequest.id, ok: true, result: { which: "open" } } });
    connectionRef!.writeFrame({ value: { id: listRequest.id, ok: true, result: { which: "list" } } });

    expect(unwrap(await openCall)).toEqual({ which: "open" });
    expect(unwrap(await listCall)).toEqual({ which: "list" });
    socket.close();
  });
});

describe("openCmuxSocket — framing across chunk boundaries", () => {
  it("reassembles a reply split across two separate writes", async () => {
    const fake = await server({
      onLine: ({ connection, line }) => {
        const request: { id: string } = JSON.parse(line);
        const frame = `${JSON.stringify({ id: request.id, ok: true, result: { split: true } })}\n`;
        const cut = Math.floor(frame.length / 2);
        connection.writeRaw({ chunk: frame.slice(0, cut) });
        setTimeout(() => connection.writeRaw({ chunk: frame.slice(cut) }), 10);
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const result = await socket.call({ method: "system.ping" });

    expect(unwrap(result)).toEqual({ split: true });
    socket.close();
  });

  it("delivers two replies glued into one write as two independent results", async () => {
    const requests: { id: string; method: string }[] = [];
    const fake = await server({
      onLine: ({ connection, line }) => {
        requests.push(JSON.parse(line));
        if (requests.length === 2) {
          const glued = requests
            .map((request) => JSON.stringify({ id: request.id, ok: true, result: { echo: request.method } }))
            .join("\n");
          connection.writeRaw({ chunk: `${glued}\n` });
        }
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const [first, second] = await Promise.all([socket.call({ method: "a.one" }), socket.call({ method: "a.two" })]);

    expect(unwrap(first)).toEqual({ echo: "a.one" });
    expect(unwrap(second)).toEqual({ echo: "a.two" });
    socket.close();
  });
});

describe("openCmuxSocket — timeouts and disconnects", () => {
  it("times out a call that never gets a reply", async () => {
    const fake = await server(); // never replies to anything
    const socket = openCmuxSocket({ socketPath: fake.socketPath, timeoutMs: 30 });

    const result = await socket.call({ method: "system.ping" });

    const error = unwrapErr(result);
    expect(error.code).toBe("TIMEOUT");
    socket.close();
  });

  it("fails every pending call once the connection drops mid-call", async () => {
    const fake = await server({
      onLine: ({ connection }) => {
        connection.destroy();
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const result = await socket.call({ method: "system.ping" });

    expect(unwrapErr(result).code).toBe("SOCKET_UNAVAILABLE");
  });

  it("fails a call made after the connection already dropped, with no new connection attempt", async () => {
    const fake = await server({
      onLine: ({ connection }) => connection.destroy(),
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });
    unwrapErr(await socket.call({ method: "first" }));

    const second = await socket.call({ method: "second" });

    expect(unwrapErr(second).code).toBe("SOCKET_UNAVAILABLE");
  });

  it("reports SOCKET_UNAVAILABLE when nothing is listening on the socket path at all", async () => {
    const fake = await server();
    const deadPath = join(fake.socketPath, "..", "nothing-listens-here.sock");
    const socket = openCmuxSocket({ socketPath: deadPath });

    const result = await socket.call({ method: "system.ping" });

    expect(unwrapErr(result).code).toBe("SOCKET_UNAVAILABLE");
    socket.close();
  });
});

describe("openCmuxSocket — cmuxOnly access", () => {
  const DENIED = "ERROR: Access denied - only processes started inside cmux can connect";

  it("presents a named capability on every multiplexed frame, and the JSON after it is untouched", async () => {
    const seen: { capability: string | undefined; method: string }[] = [];
    const fake = await server({
      onLine: ({ capability, connection, line }) => {
        const request: { id: string; method: string } = JSON.parse(line);
        seen.push({ capability, method: request.method });
        connection.writeFrame({ value: { id: request.id, ok: true, result: null } });
      },
    });
    const socket = openCmuxSocket({ capability: "v1.sentinel", socketPath: fake.socketPath });

    await Promise.all([socket.call({ method: "system.ping" }), socket.call({ method: "workspace.list" })]);

    expect(seen).toEqual([
      { capability: "v1.sentinel", method: "system.ping" },
      { capability: "v1.sentinel", method: "workspace.list" },
    ]);
    socket.close();
  });

  it("presents no capability to a named socket unless one is given", async () => {
    const seen: (string | undefined)[] = [];
    const fake = await server({
      onLine: ({ capability, connection, line }) => {
        const request: { id: string } = JSON.parse(line);
        seen.push(capability);
        connection.writeFrame({ value: { id: request.id, ok: true, result: null } });
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    await socket.call({ method: "system.ping" });

    expect(seen).toEqual([undefined]);
    socket.close();
  });

  it("fails the call with cmux's own refusal, never a bare 'the connection closed'", async () => {
    const fake = await server({
      onLine: ({ connection }) => {
        connection.writeRaw({ chunk: `${DENIED}\n` });
        connection.end();
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const failure = unwrapErr(await socket.call({ method: "workspace.list" }));
    const later = unwrapErr(await socket.call({ method: "system.ping" }));

    expect(failure.code).toBe("SOCKET_UNAVAILABLE");
    expect(failure.message).toContain(
      "cmux refused the connection: Access denied - only processes started inside cmux can connect",
    );
    expect(later.message).toBe(failure.message);
  });

  it("reads a refusal written with no final newline off the buffer when the connection closes", async () => {
    const fake = await server({
      onLine: ({ connection }) => {
        connection.writeRaw({ chunk: DENIED });
        connection.end();
      },
    });
    const socket = openCmuxSocket({ socketPath: fake.socketPath });

    const failure = unwrapErr(await socket.call({ method: "workspace.list" }));

    expect(failure.message).toContain("cmux refused the connection: Access denied");
  });
});
