/**
 * The production transport over a real Unix socket in a throwaway directory: a stand-in control plane answers,
 * refuses, hangs up, holds or floods, and the transport maps each into the seam's failure kinds. No app is involved —
 * the socket is a filesystem fixture in a throwaway directory each test removes.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  APP_HARNESS_MAX_LINE_BYTES,
  APP_HARNESS_PROTOCOL_VERSION,
  appHarnessSocketPath,
} from "../../../sessionHarness/appProtocol.js";
import { socketAppTransport } from "../../../sessionHarness/appSocketTransport.js";

/** What the stand-in control plane does with the one request line it reads. */
type Behaviour =
  | { readonly kind: "answer"; readonly envelope: (options: { requestId: string }) => unknown }
  | { readonly kind: "hang-up" }
  | { readonly kind: "hold" }
  | { readonly kind: "flood" };

let root = "";
let server: Server | undefined;

// Under `/tmp`, as the installed app's own root is, and not the per-file `$TMPDIR` sandbox: on darwin that sandbox
// already sits under `/var/folders/…`, and a socket path past 104 bytes fails to bind with EINVAL.
beforeEach(() => {
  root = mkdtempSync(join("/tmp", "sat-"));
});

afterEach(async () => {
  const open = server;
  server = undefined;
  await new Promise<void>((resolve) => {
    if (open === undefined) {
      resolve();
      return;
    }
    open.close(() => {
      resolve();
    });
  });
  rmSync(root, { force: true, recursive: true });
});

function act({ behaviour, line, reply }: { behaviour: Behaviour; line: string; reply: (text: string) => void }): void {
  switch (behaviour.kind) {
    case "answer": {
      const { requestId } = JSON.parse(line) as { requestId: string };
      reply(`${JSON.stringify(behaviour.envelope({ requestId }))}\n`);
      return;
    }
    case "flood": {
      reply("x".repeat(APP_HARNESS_MAX_LINE_BYTES + 1));
      return;
    }
    case "hang-up":
    case "hold": {
      return;
    }
    default: {
      const never: never = behaviour;
      return never;
    }
  }
}

async function serve({ behaviour }: { behaviour: Behaviour }): Promise<void> {
  const { directory, socket } = appHarnessSocketPath({ root, uid: process.getuid!() });
  mkdirSync(directory, { mode: 0o700 });
  const listening = createServer((connection) => {
    connection.setEncoding("utf8");
    let buffered = "";
    connection.on("data", (chunk: string) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline === -1) {
        return;
      }
      if (behaviour.kind === "hang-up") {
        connection.end();
        return;
      }
      act({ behaviour, line: buffered.slice(0, newline), reply: (text) => connection.write(text) });
    });
  });
  server = listening;
  await new Promise<void>((resolve) => {
    listening.listen(socket, () => {
      resolve();
    });
  });
}

describe("socketAppTransport", () => {
  it("returns the answer the control plane gave to this request", async () => {
    await serve({
      behaviour: {
        envelope: ({ requestId }) => ({
          outcome: "answered",
          protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
          requestId,
          response: { kind: "interrupted" },
        }),
        kind: "answer",
      },
    });
    const answered = await socketAppTransport({ root })({
      request: { kind: "interrupt", sessionId: "0b5e" },
      timeoutMs: 5000,
    });
    expect(unwrap(answered)).toEqual({ kind: "interrupted" });
  });

  it("carries a refusal's code and message", async () => {
    await serve({
      behaviour: {
        envelope: ({ requestId }) => ({
          code: "SESSION_NOT_FOUND",
          message: "no app session app:0b5e",
          outcome: "refused",
          protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
          requestId,
        }),
        kind: "answer",
      },
    });
    const refused = await socketAppTransport({ root })({
      request: { handle: "app:0b5e", kind: "resolve" },
      timeoutMs: 5000,
    });
    expect(unwrapErr(refused)).toEqual({
      code: "SESSION_NOT_FOUND",
      kind: "refused",
      message: "no app session app:0b5e",
    });
  });

  it("names the app as not serving when no socket is there", async () => {
    const { socket } = appHarnessSocketPath({ root, uid: process.getuid!() });
    const failed = unwrapErr(await socketAppTransport({ root })({ request: { kind: "ping" }, timeoutMs: 5000 }));
    expect(failed).toEqual({
      causeCode: "ENOENT",
      kind: "unreachable",
      message: `the Slopweaver desktop app is not serving sessions at ${socket} (ENOENT) — open the app, or use --harness cmux`,
    });
  });

  it("calls a connection closed without an answer malformed", async () => {
    await serve({ behaviour: { kind: "hang-up" } });
    const failed = unwrapErr(await socketAppTransport({ root })({ request: { kind: "list" }, timeoutMs: 5000 }));
    expect(failed).toEqual({ kind: "malformed", message: "the desktop app closed the connection without answering" });
  });

  it("gives up on a control plane that holds the request past its timeout", async () => {
    await serve({ behaviour: { kind: "hold" } });
    const failed = unwrapErr(await socketAppTransport({ root })({ request: { kind: "list" }, timeoutMs: 50 }));
    expect(failed).toEqual({
      causeCode: "TIMEOUT",
      kind: "unreachable",
      message: "the desktop app did not answer list within 0.05s",
    });
  });

  it("refuses an answer line past the protocol's limit", async () => {
    await serve({ behaviour: { kind: "flood" } });
    const failed = unwrapErr(await socketAppTransport({ root })({ request: { kind: "list" }, timeoutMs: 5000 }));
    expect(failed).toEqual({
      kind: "malformed",
      message: "the desktop app answered a line past the protocol's limit",
    });
  });
});
