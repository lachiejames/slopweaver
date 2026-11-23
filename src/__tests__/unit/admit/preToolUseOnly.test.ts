/**
 * `--only <id>`: the compatibility path that keeps the ten old `scripts/pretooluse-*.sh` paths working
 * against a shared plugin mirror while `main`'s `hooks.json` still names them.
 *
 * The case that matters is the third one. Ten shims each running the WHOLE registry is the obvious spelling
 * and is a defect — the second poll-gate pass over one tool call refuses the call the first one recorded.
 */
import { describe, expect, it } from "vitest";

import { EXIT_ALLOW, EXIT_BLOCK, type PreToolUseCheck } from "../../../admit/preToolUseDispatch.js";
import { onlyChecksIn, runPreToolUseDispatch } from "../../../admit/preToolUseDispatchRunner.js";

const RAW = JSON.stringify({ session_id: "t", tool_input: { command: "echo hi" }, tool_name: "Bash" });

/** A check that records that it ran, then answers a fixed code. */
function check({ id, code = EXIT_ALLOW, ran }: { id: string; code?: number; ran: string[] }): PreToolUseCheck {
  return {
    appliesTo: () => true,
    id,
    onUnhandledError: EXIT_ALLOW,
    run: ({ writeError }) => {
      ran.push(id);
      writeError(`${id} refused\n`);
      return Promise.resolve(code);
    },
  };
}

async function run({ argv, checks }: { argv: readonly string[]; checks: readonly PreToolUseCheck[] }) {
  const errors: string[] = [];
  const code = await runPreToolUseDispatch({
    argv,
    checks,
    env: {},
    readStdin: () => Promise.resolve(RAW),
    writeError: (line) => errors.push(line),
    writeOut: () => undefined,
  });
  return { code, stderr: errors.join("") };
}

describe("reading --only off the command line", () => {
  it("answers null when the flag was never given, which is what runs the whole registry", () => {
    expect(onlyChecksIn({ argv: [] })).toBe(null);
    expect(onlyChecksIn({ argv: ["--verbose"] })).toBe(null);
  });

  it("collects the ids named", () => {
    expect(onlyChecksIn({ argv: ["--only", "poll-gate"] })).toEqual(["poll-gate"]);
    expect(onlyChecksIn({ argv: ["--only", "admit", "--only", "poll-gate"] })).toEqual(["admit", "poll-gate"]);
  });

  it("answers an EMPTY list for a flag with no value, so it selects nothing rather than everything", () => {
    expect(onlyChecksIn({ argv: ["--only"] })).toEqual([]);
    expect(onlyChecksIn({ argv: ["--only", "--other"] })).toEqual([]);
  });
});

describe("running one check and no other", () => {
  it("runs only the named check", async () => {
    const ran: string[] = [];
    await run({
      argv: ["--only", "poll-gate"],
      checks: [check({ id: "admit", ran }), check({ id: "poll-gate", ran })],
    });
    expect(ran).toEqual(["poll-gate"]);
  });

  it("gives that check's own refusal, not a sibling's", async () => {
    const ran: string[] = [];
    const result = await run({
      argv: ["--only", "poll-gate"],
      checks: [check({ code: EXIT_BLOCK, id: "admit", ran }), check({ code: EXIT_BLOCK, id: "poll-gate", ran })],
    });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toBe("poll-gate refused\n");
  });

  it("runs every check when the flag is absent", async () => {
    const ran: string[] = [];
    await run({ argv: [], checks: [check({ id: "admit", ran }), check({ id: "poll-gate", ran })] });
    expect(ran).toEqual(["admit", "poll-gate"]);
  });

  it("runs nothing, and allows, for an id the registry does not carry", async () => {
    const ran: string[] = [];
    const result = await run({ argv: ["--only", "retired-guard"], checks: [check({ id: "admit", ran })] });
    expect(ran).toEqual([]);
    expect(result.code).toBe(EXIT_ALLOW);
  });

  it("still fails CLOSED on a payload it cannot read, whichever check was named", async () => {
    const code = await runPreToolUseDispatch({
      argv: ["--only", "poll-gate"],
      checks: [],
      env: {},
      readStdin: () => Promise.resolve("{not json"),
      writeError: () => undefined,
      writeOut: () => undefined,
    });
    expect(code).toBe(EXIT_BLOCK);
  });
});
