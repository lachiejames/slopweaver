/**
 * `cmux send` with a relay the length of the one that lost its middle — the SHIPPED binary over a fake cmux
 * socket, so what is under test is what actually reaches `surface.send_text`.
 *
 * ## The incident it holds down
 *
 * A supervisor relay of 1,418 characters reached its seat as the first 96 and the last
 * 400, the 922 between them gone, and the verb answered `submitted`. `cmux/relayFile.ts` carries the
 * measurement. The failure is inside Claude Code's paste handling, which no fake can reproduce — so the
 * falsifiable property is the one the fix owns: a relay that long is never PASTED at all. It goes to a file
 * that reads back whole, and the only text typed is a short line naming that file.
 *
 * The relay is built as HEAD + MIDDLE + TAIL at the incident's own lengths, so the assertion that the file
 * carries the middle is an assertion about exactly the span the seat lost.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RELAY_INLINE_MAX_CHARS } from "../../../cmux/relayFile.js";
import { type FakeCmuxServer, startFakeCmuxServer } from "./fakeCmuxServer.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const WORKSPACE_REF = "workspace:23";
const WORKSPACE_ID = "5B3F7C1E-0000-4000-8000-000000000023";

/** A span of exactly `length` characters that says which span it is, so a lost one is identifiable. */
function span({ label, length }: { label: string; length: number }): string {
  const unit = `${label} `;
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

/** The incident's shape: the 96 characters the seat got, the 922 it lost, the 400 it got. */
const HEAD = span({ label: "head", length: 96 });
const MIDDLE = span({ label: "MIDDLE-THE-SEAT-LOST", length: 922 });
const TAIL = span({ label: "tail", length: 400 });
const FAILED_RELAY = `${HEAD}${MIDDLE}${TAIL}`;

let sandbox: string;
let home: string;
let server: FakeCmuxServer;
let typed: string[];
let keys: string[];

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), "slop-long-relay-"));
  home = join(sandbox, "home");
  typed = [];
  keys = [];
  server = await startFakeCmuxServer({ onLine: ({ connection, line }) => answer({ connection, line }) });
});

afterEach(async () => {
  await server.close();
  rmSync(sandbox, { force: true, recursive: true });
});

/**
 * Answer one request the way cmux does, recording every `surface.send_text` payload.
 *
 * The screen is an idle Claude Code prompt, and the styled grid is refused, so the composer reads
 * `unreadable` and no rescue Enter is pressed — the send path under test is the plain one.
 */
function answer({
  connection,
  line,
}: {
  connection: { writeFrame: (options: { value: unknown }) => void };
  line: string;
}): void {
  const { id, method, params } = JSON.parse(line) as {
    id: string;
    method: string;
    params: { key?: string; text?: string };
  };
  if (method === "surface.send_text") {
    typed.push(params.text!);
  }
  if (method === "surface.send_key") {
    keys.push(params.key!);
  }
  const results: Record<string, unknown> = {
    "surface.read_text": { text: "> \n  ? for shortcuts" },
    "surface.send_key": {},
    "surface.send_text": {},
    "window.list": { windows: [{ id: "window:1" }] },
    "workspace.list": {
      window_id: "window:1",
      workspaces: [
        {
          current_directory: sandbox,
          id: WORKSPACE_ID,
          pinned: false,
          ref: WORKSPACE_REF,
          selected: false,
          title: "a seat",
        },
      ],
    },
  };
  const result = results[method];
  if (result === undefined) {
    connection.writeFrame({ value: { error: { code: "method_not_found", message: method }, id, ok: false } });
    return;
  }
  connection.writeFrame({ value: { id, ok: true, result } });
}

/** Run the shipped verb against the fake socket and a throwaway home. */
async function runSend({
  extra = [],
  text,
}: {
  extra?: readonly string[];
  text: string;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(BIN, ["cmux", "send", "--workspace", WORKSPACE_REF, "--home", home, ...extra, text], {
      env: { ...process.env, CMUX_SOCKET_PATH: server.socketPath, CMUX_WORKSPACE_ID: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolveRun({ code, stderr, stdout });
    });
  });
}

describe("cmux send with a relay the length of the one that lost its middle", () => {
  it("never pastes it: the file holds all 1,418 characters and the line typed only names that file", async () => {
    expect(FAILED_RELAY.length).toBe(1418);

    const run = await runSend({ text: FAILED_RELAY });

    expect(run.code).toBe(0);
    expect(typed).toHaveLength(1);
    const pasted = typed[0]!;
    expect(pasted.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS);
    expect(pasted).not.toContain("MIDDLE-THE-SEAT-LOST");
    const path = /Read ALL of it before acting: (\S+) \(sha256 [0-9a-f]{12}\)/u.exec(pasted)![1]!;
    expect(path.startsWith(join(home, "cmux-relays"))).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(FAILED_RELAY);
    expect(readFileSync(path, "utf8")).toContain(MIDDLE);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(run.stdout).toContain(`relay: 1418 characters went as a file, read back byte for byte`);
  }, 30_000);

  it("still pastes the longest relay that fits, newline included, never touching the relay directory", async () => {
    const atLimit = span({ label: "short", length: RELAY_INLINE_MAX_CHARS - 1 });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "cmux-relays"), "a relay directory a short send must never touch");

    const run = await runSend({ text: atLimit });

    expect(run.code).toBe(0);
    expect(typed).toEqual([`${atLimit}\n`]);
    expect(typed[0]!.length).toBe(RELAY_INLINE_MAX_CHARS);
    expect(run.stdout).not.toContain("relay:");
  }, 30_000);

  it("REFUSES when the file cannot be written, typing nothing and pressing nothing, even with --interrupt", async () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "cmux-relays"), "a file where the relay directory should be");

    const run = await runSend({ extra: ["--interrupt"], text: FAILED_RELAY });

    expect(run.code).toBe(1);
    expect(typed).toEqual([]);
    expect(keys).toEqual([]);
    expect(run.stderr).toContain("cmux send: REFUSED — the relay file");
    expect(run.stderr).toContain("NOTHING was typed");
    expect(run.stderr).toContain("send one line naming its absolute path");
  }, 30_000);
});
