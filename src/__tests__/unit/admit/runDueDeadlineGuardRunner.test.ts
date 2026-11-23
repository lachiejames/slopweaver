/**
 * The run-due deadline gate's runner: the exit code it returns for one `PreToolUse` payload, and the fact that
 * its refusal names the hatch and the background shape to submit instead.
 *
 * Every seam is a plain injected function, never a mock: the payload is a string this test writes.
 */
import { describe, expect, it } from "vitest";

import { runRunDueDeadlineGuard } from "../../../admit/runDueDeadlineGuardRunner.js";

/** Run the guard over one payload, collecting whatever it wrote to stderr. */
async function judge({
  payload,
  env = {},
}: {
  payload: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly code: number; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runRunDueDeadlineGuard({
    env,
    readStdin: () => Promise.resolve(payload),
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

/** A `PreToolUse` payload for one Bash command, backgrounded the way Claude Code marks it, with its `timeout`. */
function bashPayload({
  command,
  background,
  timeout,
}: {
  command: string;
  background: boolean;
  timeout?: number;
}): string {
  const input: Record<string, unknown> = background ? { command, run_in_background: true } : { command };
  if (timeout !== undefined) {
    input["timeout"] = timeout;
  }
  return JSON.stringify({ cwd: "/dev/slopweaver", session_id: "s1", tool_input: input, tool_name: "Bash" });
}

describe("runRunDueDeadlineGuard", () => {
  it("refuses a wrapped run-due with exit 2 and the four-line refusal", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({ background: true, command: "timeout 900 slopweaver automation run-due --recipe x" }),
    });
    expect(code).toBe(2);
    expect(errors.length).toBe(1);
    const lines = errors[0]!.split("\n");
    expect(lines[0]).toBe(
      "slopweaver automation run-due blocked because a deadline would kill this firing mid-effect — run-due performs " +
        "a verb-run row itself, in a verb child it awaits, and its destination takes no idempotency key, so a killed run dead-letters " +
        "OUTCOME_UNKNOWN and nobody can say whether its effect landed; two store-backup-daily slots were lost " +
        "this way, and three seated resyncs to the Bash tool's 30-minute " +
        "background default (`timeout` would kill `slopweaver automation run-due --recipe x`).",
    );
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_RUN_DUE_DEADLINE=1 slopweaver automation run-due.",
    );
    expect(errors[0]).toContain("`run_in_background: true` and `timeout: 7200000`");
    expect(errors[0]).toContain("`--limit <n>`");
  });

  it("names the foreground deadline when there is no wrapper", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({ background: false, command: "slopweaver automation run-due" }),
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain("(a foreground Bash call's deadline would kill `slopweaver automation run-due`)");
  });

  it("names the 30-minute default when a background run-due carries no timeout, the seats' spelling", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({ background: true, command: "slopweaver automation run-due --recipe x" }),
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain(
      "(the Bash tool's background limit of 1800000 ms would kill `slopweaver automation run-due --recipe x`)",
    );
  });

  it("allows a background run-due at the tool's maximum timeout and writes nothing", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({
        background: true,
        command: "slopweaver automation run-due --recipe x",
        timeout: 7_200_000,
      }),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });

  it("lets the ambient hatch through", async () => {
    const { code, errors } = await judge({
      env: { SLOPWEAVER_ALLOW_RUN_DUE_DEADLINE: "1" },
      payload: bashPayload({ background: false, command: "timeout 900 slopweaver automation run-due" }),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });

  it("fails open on a malformed payload and on another tool", async () => {
    expect((await judge({ payload: "{not json" })).code).toBe(0);
    const edit = JSON.stringify({
      tool_input: { command: "timeout 9 slopweaver automation run-due" },
      tool_name: "Edit",
    });
    expect((await judge({ payload: edit })).code).toBe(0);
  });
});
