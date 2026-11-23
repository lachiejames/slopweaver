/**
 * The fleet-wide depth advisory's runner.
 *
 * `readDepth` and the two writers are plain injected functions, never mocks — same shape as
 * `cmuxSendSupervisorGuardRunner.test.ts`. The two properties under test are the ones the owner's ruling
 * created: the runner NEVER returns a blocking exit code, and it is scoped to nobody, so an ordinary worker
 * session gets the advisory that the retired gate only ever gave the pinned supervisor.
 */
import { describe, expect, it } from "vitest";
import { runSessionDepthWarning } from "../../../admit/sessionDepthWarningRunner.js";

const DEEP = 750_000;
const SHALLOW = 120_000;

/**
 * One `PreToolUse` payload, as Claude Code pipes it in.
 *
 * `omitSessionId` is a flag rather than an `undefined` session id, because a defaulted destructure treats a
 * passed `undefined` as absent and hands back the default — which silently made this helper unable to build
 * the one payload the fail-open case needs.
 */
function payload({
  tool = "Bash",
  sessionId = "sess-1",
  omitSessionId = false,
}: {
  tool?: string;
  sessionId?: string;
  omitSessionId?: boolean;
}): string {
  const identity = omitSessionId ? {} : { session_id: sessionId };
  return JSON.stringify({
    ...identity,
    tool_input: { command: "yarn validate" },
    tool_name: tool,
    transcript_path: "/tmp/does-not-matter.jsonl",
  });
}

/** A run that captures whatever the runner wrote, with the depth it should measure injected. */
async function run({ raw, depthTokens }: { raw: string; depthTokens: number | undefined }): Promise<{
  code: number;
  out: readonly string[];
}> {
  const out: string[] = [];
  const code = await runSessionDepthWarning({
    readDepth: () => depthTokens,
    readStdin: () => Promise.resolve(raw),
    writeOut: (line) => {
      out.push(line);
    },
  });
  return { code, out };
}

describe("it advises and never refuses", () => {
  it("exits 0 for a session far past the retired block line", async () => {
    const { code } = await run({ depthTokens: 988_396, raw: payload({}) });
    expect(code).toBe(0);
  });

  it("exits 0 for a shallow session", async () => {
    const { code } = await run({ depthTokens: SHALLOW, raw: payload({}) });
    expect(code).toBe(0);
  });

  it("writes nothing at all below the line", async () => {
    const { out } = await run({ depthTokens: SHALLOW, raw: payload({}) });
    expect(out).toEqual([]);
  });
});

describe("it is scoped to nobody", () => {
  it("advises an ordinary session that holds no supervisor pin", async () => {
    const { out } = await run({ depthTokens: DEEP, raw: payload({ sessionId: "some-worker" }) });
    expect(out.length).toBe(1);
  });

  it("injects the advisory as PreToolUse additionalContext", async () => {
    const { out } = await run({ depthTokens: DEEP, raw: payload({}) });
    const written: unknown = JSON.parse(out[0]!);
    expect(written).toEqual({
      hookSpecificOutput: {
        additionalContext: expect.stringContaining("Context depth: 750k"),
        hookEventName: "PreToolUse",
      },
    });
  });

  it("tells that session not to act on the warning itself", async () => {
    const { out } = await run({ depthTokens: DEEP, raw: payload({}) });
    expect(out[0]!).toContain("Continue the current task");
  });
});

describe("failing open", () => {
  it("allows a payload that is not JSON at all", async () => {
    const { code, out } = await run({ depthTokens: DEEP, raw: "not json" });
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });

  it("allows a JSON array payload", async () => {
    const { code, out } = await run({ depthTokens: DEEP, raw: "[]" });
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });

  it("ignores a non-Bash tool call", async () => {
    const { out } = await run({ depthTokens: DEEP, raw: payload({ tool: "Read" }) });
    expect(out).toEqual([]);
  });

  it("ignores a payload carrying no session id", async () => {
    const { out } = await run({ depthTokens: DEEP, raw: payload({ omitSessionId: true }) });
    expect(out).toEqual([]);
  });

  it("stays silent when the depth could not be measured", async () => {
    const { code, out } = await run({ depthTokens: undefined, raw: payload({}) });
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });
});
