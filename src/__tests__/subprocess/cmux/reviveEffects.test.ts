/**
 * `cmux revive`'s probe effects against a real Unix socket and the real `ps`: a reply of any kind is an answer
 * (cmux's own access refusal included), a socket that never replies is silence, and no listener is a refused
 * connect — the three readings a revive hang turns on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { knockOnSocket, listProcesses } from "../../../cmux/reviveEffects.js";
import { type FakeCmuxServer, startFakeCmuxServer } from "./fakeCmuxServer.js";

let servers: FakeCmuxServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe("knockOnSocket", () => {
  it("hears cmux's access refusal as a reply", async () => {
    const server = await startFakeCmuxServer({
      onLine: ({ connection }) => {
        connection.writeRaw({ chunk: "ERROR: Access denied - only processes started inside cmux can connect\n" });
      },
    });
    servers.push(server);
    const knock = await knockOnSocket({ socketPath: server.socketPath, timeoutMs: 2_000 });
    expect(knock).toEqual({
      connectRefused: false,
      detail: "ERROR: Access denied - only processes started inside cmux can connect",
      replied: true,
    });
  });

  it("reads a socket that accepts and never replies as silent", async () => {
    const server = await startFakeCmuxServer();
    servers.push(server);
    const knock = await knockOnSocket({ socketPath: server.socketPath, timeoutMs: 200 });
    expect(knock).toEqual({
      connectRefused: false,
      detail: `no reply within 200ms on ${server.socketPath}`,
      replied: false,
    });
  });

  it("reads no listener as a refused connect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knock-"));
    const socketPath = join(dir, "s.sock");
    try {
      const knock = await knockOnSocket({ socketPath, timeoutMs: 2_000 });
      expect(knock).toEqual({ connectRefused: true, detail: `ENOENT on ${socketPath}`, replied: false });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("listProcesses", () => {
  it("lists this process with its parent", () => {
    const rows = unwrap(listProcesses());
    const self = rows.find((row) => row.pid === process.pid)!;
    expect(self.ppid).toBe(process.ppid);
  });
});
