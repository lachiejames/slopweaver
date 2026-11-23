/**
 * The cmux-send-supervisor guard's runner — the payload shapes it must fail OPEN on, and the two exit codes.
 *
 * `readPin` is a plain injected function, never a mock — same shape as `sessionDepthWarningRunner.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { runCmuxSendSupervisorGuard } from "../../../admit/cmuxSendSupervisorGuardRunner.js";
import type { SupervisorPinRecord } from "../../../sessions/supervisorPin.js";

const PIN: SupervisorPinRecord = {
  session: { host: "claude-code", id: "sess-super" },
  pinnedAtIso: "2026-09-02T04:47:00.000Z",
  workspaceId: "ws-super-id",
  workspaceRef: "workspace:936",
};

/** What one guard run said and returned. */
interface RunOutcome {
  readonly code: number;
  readonly errors: readonly string[];
}

/**
 * Run the guard over one payload.
 *
 * @param payload the raw stdin text
 * @param pin what the pin reader should report
 * @returns the exit code and everything written to stderr
 */
async function run({ payload, pin = PIN }: { payload: string; pin?: SupervisorPinRecord | null }): Promise<RunOutcome> {
  const errors: string[] = [];
  const code = await runCmuxSendSupervisorGuard({
    readPin: () => {
      if (pin === null) {
        return undefined;
      }
      return pin;
    },
    readStdin: async () => payload,
    writeError: (line) => errors.push(line),
  });
  return { code, errors };
}

/** A well-formed PreToolUse Bash payload. */
function bashPayload({ command, sessionId = "sess-worker" }: { command: string; sessionId?: string }): string {
  return JSON.stringify({
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: { command },
    tool_name: "Bash",
  });
}

describe("failing open", () => {
  it("allows a payload that is not JSON at all", async () => {
    expect((await run({ payload: "{not json" })).code).toBe(0);
  });

  it("allows a JSON array payload", async () => {
    expect((await run({ payload: "[]" })).code).toBe(0);
  });

  it("allows a non-Bash tool call", async () => {
    const payload = JSON.stringify({ session_id: "sess-worker", tool_input: { file_path: "x" }, tool_name: "Write" });
    expect((await run({ payload })).code).toBe(0);
  });

  it("allows a Bash payload with no command", async () => {
    const payload = JSON.stringify({ session_id: "sess-worker", tool_input: {}, tool_name: "Bash" });
    expect((await run({ payload })).code).toBe(0);
  });

  it("allows a Bash payload with no session id", async () => {
    const payload = JSON.stringify({
      tool_input: { command: "slopweaver cmux send --workspace workspace:936 hi" },
      tool_name: "Bash",
    });
    expect((await run({ payload })).code).toBe(0);
  });

  it("allows when nothing is registered at all", async () => {
    const outcome = await run({
      payload: bashPayload({ command: "slopweaver cmux send --workspace workspace:936 hi" }),
      pin: null,
    });
    expect(outcome.code).toBe(0);
  });
});

describe("blocking", () => {
  it("exits 2 for a cmux send aimed at the pinned supervisor from another session", async () => {
    const outcome = await run({
      payload: bashPayload({ command: "slopweaver cmux send --workspace workspace:936 hi" }),
    });
    expect(outcome.code).toBe(2);
  });

  it("writes the refusal to stderr, naming SendMessage", async () => {
    const outcome = await run({
      payload: bashPayload({ command: "slopweaver cmux send --workspace workspace:936 hi" }),
    });
    expect(outcome.errors.join("")).toContain("SendMessage");
  });

  it("allows the pinned supervisor sending to its own workspace", async () => {
    const outcome = await run({
      payload: bashPayload({ command: "slopweaver cmux send --workspace workspace:936 hi", sessionId: "sess-super" }),
    });
    expect(outcome.code).toBe(0);
  });

  it("allows an ordinary cmux send at a different workspace", async () => {
    const outcome = await run({ payload: bashPayload({ command: "slopweaver cmux send --workspace workspace:1 hi" }) });
    expect(outcome.code).toBe(0);
  });
});
