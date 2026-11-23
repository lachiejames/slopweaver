/**
 * The poll gate's runner — the payload shapes it fails OPEN on, the record it consults and writes, the change
 * token it asks for, and the two exit codes. Every reader and writer is a plain injected function, never a mock.
 */
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runPollGate } from "../../../admit/pollGateRunner.js";
import type { PollObservation } from "../../../admit/pollGateStore.js";

const NOW = 2_000_000;
const LOG = "/private/tmp/claude-501/proj/0000/scratchpad/validate.log";
const TOKEN = `${LOG}\u0000120\u00001999000`;

/** What one run said and returned, every record it wrote, and every token it asked for. */
interface RunOutcome {
  readonly code: number;
  readonly errors: readonly string[];
  readonly recorded: readonly { sessionId: string; target: string; fingerprint: string | undefined }[];
  readonly asked: readonly { cwd: string; paths: readonly string[]; operands: readonly string[] }[];
}

/**
 * Run the gate over one payload with the record and the filesystem injected.
 *
 * @param payload the raw stdin text
 * @param seen the target → last observation map the reader answers from
 * @param env the hook environment
 * @param token what the injected fingerprinter answers for every ask
 * @returns the exit code, the refusals, the records written and the fingerprint asks
 */
async function run({
  payload,
  seen = new Map(),
  env = {},
  token,
}: {
  payload: string;
  seen?: ReadonlyMap<string, PollObservation>;
  env?: Readonly<Record<string, string | undefined>>;
  token?: string;
}): Promise<RunOutcome> {
  const errors: string[] = [];
  const recorded: { sessionId: string; target: string; fingerprint: string | undefined }[] = [];
  const asked: { cwd: string; paths: readonly string[]; operands: readonly string[] }[] = [];
  const code = await runPollGate({
    env,
    fingerprintOf: (input) => {
      asked.push(input);
      return token;
    },
    nowMs: NOW,
    readLastSeen: ({ target }) => seen.get(target),
    readStdin: async () => payload,
    recordSeen: (entry) => recorded.push(entry),
    writeError: (line) => errors.push(line),
  });
  return { asked, code, errors, recorded };
}

/** A well-formed PreToolUse payload. */
function preToolUsePayload({
  toolName,
  toolInput,
  sessionId = "sess-1",
  cwd = "/repo",
}: {
  toolName: string;
  toolInput: unknown;
  sessionId?: string;
  cwd?: string;
}): string {
  return JSON.stringify({
    cwd,
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: toolInput,
    tool_name: toolName,
  });
}

describe("failing open", () => {
  it("allows a payload that is not JSON", async () => {
    expect((await run({ payload: "{nope" })).code).toBe(0);
  });

  it("allows a payload that is not an object", async () => {
    expect((await run({ payload: "42" })).code).toBe(0);
  });

  it("allows a payload with no session id", async () => {
    const text = JSON.stringify({ tool_input: { command: `tail -1 ${LOG}` }, tool_name: "Bash" });
    expect((await run({ payload: text, seen: new Map([[LOG, { atMs: NOW - 1_000 }]]) })).code).toBe(0);
  });

  it("allows a tool it does not judge", async () => {
    expect((await run({ payload: preToolUsePayload({ toolInput: { file_path: LOG }, toolName: "Read" }) })).code).toBe(
      0,
    );
  });
});

describe("judging a poll on the clock", () => {
  it("allows the first poll of a target and records it, with its token, under the session", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `tail -c 400 ${LOG}` }, toolName: "Bash" }),
      token: TOKEN,
    });
    expect(outcome.code).toBe(0);
    expect(outcome.errors).toEqual([]);
    expect(outcome.recorded).toEqual([{ fingerprint: TOKEN, sessionId: "sess-1", target: LOG }]);
  });

  it("refuses the same target polled 13 seconds ago with no token either side, and records nothing", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `cat ${LOG}` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 13_000 }]]),
    });
    expect(outcome.code).toBe(2);
    expect(outcome.errors.length).toBe(1);
    expect(
      outcome.errors[0]!.startsWith(`poll-gate: refused a log read of ${LOG} — the same target was polled 13s ago,`),
    ).toBe(true);
    expect(outcome.recorded).toEqual([]);
  });

  it("allows the same target polled 61 seconds ago", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `cat ${LOG}` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 61_000 }]]),
    });
    expect(outcome.code).toBe(0);
    expect(outcome.recorded).toEqual([{ fingerprint: undefined, sessionId: "sess-1", target: LOG }]);
  });

  it("refuses a repeated TaskOutput of the same task", async () => {
    const outcome = await run({
      payload: preToolUsePayload({
        toolInput: { block: true, task_id: "bk66ue10d", timeout: 300_000 },
        toolName: "TaskOutput",
      }),
      seen: new Map([["task:bk66ue10d", { atMs: NOW - 20_000 }]]),
    });
    expect(outcome.code).toBe(2);
    expect(outcome.errors[0]!.startsWith("poll-gate: refused a task output of task:bk66ue10d")).toBe(true);
  });

  it("allows real work without touching the record", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `tail -1 ${LOG} && yarn validate` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 1_000 }]]),
    });
    expect(outcome.code).toBe(0);
    expect(outcome.recorded).toEqual([]);
  });

  it("allows under the break-glass and still records", async () => {
    const outcome = await run({
      env: { SLOPWEAVER_ALLOW_POLL: "1" },
      payload: preToolUsePayload({ toolInput: { command: `cat ${LOG}` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 1_000 }]]),
    });
    expect(outcome.code).toBe(0);
    expect(outcome.recorded).toEqual([{ fingerprint: undefined, sessionId: "sess-1", target: LOG }]);
  });
});

describe("judging a poll on the change token", () => {
  it("allows a re-read of an unchanged file inside the window, without moving the window", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `grep -n poll ${LOG}` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 5_000, fingerprint: TOKEN }]]),
      token: TOKEN,
    });
    expect(outcome.code).toBe(0);
    expect(outcome.errors).toEqual([]);
    expect(outcome.recorded).toEqual([]);
  });

  it("refuses a re-read of a file whose token moved inside the window", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `tail -5 ${LOG}` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 5_000, fingerprint: TOKEN }]]),
      token: `${LOG}\u0000480\u00001999900`,
    });
    expect(outcome.code).toBe(2);
    expect(outcome.recorded).toEqual([]);
  });

  it("lets `grep x A` through after `grep x A B C` over the same untouched files, and refuses `grep x A B` once B grew", async () => {
    // The sequence that refused this branch's own seat, over real files and the real fingerprint.
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "slopweaver-poll-run-")));
    try {
      const [a, b, c] = ["a.log", "b.log", "c.log"].map((name) => join(dir, name));
      [a, b, c].forEach((path) => writeFileSync(path!, "verdict: CLEAN\n", "utf8"));
      const store = new Map<string, PollObservation>();
      const gate = async ({ command, nowMs }: { command: string; nowMs: number }): Promise<number> =>
        runPollGate({
          env: {},
          nowMs,
          readLastSeen: ({ target }) => store.get(target),
          readStdin: async () => preToolUsePayload({ cwd: dir, toolInput: { command }, toolName: "Bash" }),
          recordSeen: ({ target, fingerprint }) => {
            store.set(target, fingerprint === undefined ? { atMs: nowMs } : { atMs: nowMs, fingerprint });
          },
          writeError: () => undefined,
        });
      const first = await gate({ command: `grep -h verdict ${a!} ${b!} ${c!}`, nowMs: NOW });
      const subset = await gate({ command: `grep verdict ${a!}`, nowMs: NOW + 6_000 });
      appendFileSync(b!, "more\n", "utf8");
      const grown = await gate({ command: `grep verdict ${a!} ${b!}`, nowMs: NOW + 9_000 });
      expect([first, subset, grown]).toEqual([0, 0, 2]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("asks for the token of the paths and operands the shape names, against the payload's cwd", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ cwd: "/work/tree", toolInput: { command: `tail -5 ${LOG}` }, toolName: "Bash" }),
    });
    expect(outcome.asked).toEqual([{ cwd: "/work/tree", operands: [], paths: [LOG] }]);
  });

  it("asks for no token when the payload carries no cwd, and keeps the clock rule", async () => {
    const text = JSON.stringify({
      session_id: "sess-1",
      tool_input: { command: `tail -5 ${LOG}` },
      tool_name: "Bash",
    });
    const outcome = await run({
      payload: text,
      seen: new Map([[LOG, { atMs: NOW - 5_000, fingerprint: TOKEN }]]),
      token: TOKEN,
    });
    expect(outcome.asked).toEqual([]);
    expect(outcome.code).toBe(2);
  });

  it("asks for no token when the payload's cwd is longer than any path a stat resolves, and keeps the clock rule", async () => {
    const at = ({ cwd }: { cwd: string }) =>
      run({
        payload: preToolUsePayload({ cwd, toolInput: { command: `tail -1 ${LOG}` }, toolName: "Bash" }),
        seen: new Map([[LOG, { atMs: NOW - 5_000, fingerprint: TOKEN }]]),
        token: TOKEN,
      });
    const longest = await at({ cwd: `/${"a".repeat(4095)}` });
    const over = await at({ cwd: `/${"a".repeat(4096)}` });
    expect([longest.asked.length, longest.code]).toEqual([1, 0]);
    expect([over.asked.length, over.code]).toEqual([0, 2]);
  });

  it("asks for no token when the call names more words than the cap, and keeps the clock rule", async () => {
    const naming = ({ operands }: { operands: number }) =>
      run({
        payload: preToolUsePayload({
          toolInput: { command: `grep x ${LOG} ${Array.from({ length: operands }, (_, i) => `a${i}`).join(" ")}` },
          toolName: "Bash",
        }),
        seen: new Map([[LOG, { atMs: NOW - 5_000, fingerprint: TOKEN }]]),
        token: TOKEN,
      });
    // The log, the pattern `x` and the extra operands: 64 words in all is the most a token stats.
    const most = await naming({ operands: 62 });
    const over = await naming({ operands: 63 });
    expect([most.asked.length, most.code]).toEqual([1, 0]);
    expect([over.asked.length, over.code]).toEqual([0, 2]);
  });

  it("asks for no token when the shape names no file, and keeps the clock rule", async () => {
    const outcome = await run({
      payload: preToolUsePayload({ toolInput: { command: `C=tail; "$C" -1 ${LOG}` }, toolName: "Bash" }),
      seen: new Map([[LOG, { atMs: NOW - 5_000, fingerprint: TOKEN }]]),
      token: TOKEN,
    });
    expect(outcome.asked).toEqual([]);
    expect(outcome.code).toBe(2);
  });
});
