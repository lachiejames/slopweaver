/**
 * The dispatcher's shell: what it does with a payload no check could possibly decide.
 *
 * This is the one judgement the dispatcher makes for itself, and it is STRICTER than eight of the ten
 * entries it replaced — see the file's own header for why one process cannot be both policies at once.
 * Asserted here rather than left to the subprocess lane because it is pure given an injected registry.
 */
import { describe, expect, it } from "vitest";

import { denyDocument, EXIT_ALLOW, EXIT_BLOCK, type PreToolUseCheck } from "../../../admit/preToolUseDispatch.js";
import { runPreToolUseDispatch } from "../../../admit/preToolUseDispatchRunner.js";

/** A check that records the payload it was handed, so "was the registry reached at all" is falsifiable. */
function recorder({ seen }: { seen: string[] }): PreToolUseCheck {
  return {
    appliesTo: () => true,
    id: "recorder",
    onUnhandledError: EXIT_ALLOW,
    run: ({ raw }) => {
      seen.push(raw);
      return Promise.resolve(EXIT_ALLOW);
    },
  };
}

async function run({ raw, checks }: { raw: string; checks: readonly PreToolUseCheck[] }) {
  const errors: string[] = [];
  const outs: string[] = [];
  const code = await runPreToolUseDispatch({
    checks,
    env: {},
    readStdin: () => Promise.resolve(raw),
    writeError: (line) => errors.push(line),
    writeOut: (line) => outs.push(line),
  });
  return { code, stderr: errors.join(""), stdout: outs.join("") };
}

/** A check that refuses and queues one effect behind its refusal, as `profile-held` queues its delivery marker. */
function heldWithMarker({ events }: { events: string[] }): PreToolUseCheck {
  return {
    appliesTo: () => true,
    id: "held",
    onUnhandledError: EXIT_BLOCK,
    run: ({ afterEmit, writeError }) => {
      writeError("held, profile below\n");
      afterEmit(() => events.push("marker"));
      return Promise.resolve(EXIT_BLOCK);
    },
  };
}

describe("an afterEmit effect follows the printed refusal", () => {
  it("runs only once the refusal's write has returned", async () => {
    const events: string[] = [];
    const code = await runPreToolUseDispatch({
      checks: [heldWithMarker({ events })],
      env: {},
      readStdin: () => Promise.resolve(JSON.stringify({ session_id: "t", tool_name: "Edit" })),
      writeError: (line) => events.push(`stderr:${line}`),
      writeOut: (line) => events.push(`stdout:${line}`),
    });
    expect([code, events]).toEqual([
      EXIT_BLOCK,
      [
        `stdout:${denyDocument({ checkId: "held", reason: "held, profile below\n" })}`,
        "stderr:held, profile below\n",
        "marker",
      ],
    ]);
  });

  it("never runs when the stderr write throws, though the deny document written first already left", async () => {
    const events: string[] = [];
    const attempt = runPreToolUseDispatch({
      checks: [heldWithMarker({ events })],
      env: {},
      readStdin: () => Promise.resolve(JSON.stringify({ session_id: "t", tool_name: "Edit" })),
      writeError: () => {
        throw new Error("EPIPE");
      },
      writeOut: (line) => events.push(`stdout:${line}`),
    });
    await expect(attempt).rejects.toThrow("EPIPE");
    expect(events).toEqual([`stdout:${denyDocument({ checkId: "held", reason: "held, profile below\n" })}`]);
  });
});

describe("a stderr sink that throws", () => {
  it("cannot suppress the deny document for a payload the dispatcher cannot read", async () => {
    const outs: string[] = [];
    const attempt = runPreToolUseDispatch({
      checks: [],
      env: {},
      readStdin: () => Promise.resolve("{not json"),
      writeError: () => {
        throw new Error("EPIPE");
      },
      writeOut: (line) => outs.push(line),
    });
    await expect(attempt).rejects.toThrow("EPIPE");
    expect(outs.length).toBe(1);
    expect(outs[0]).toContain('"permissionDecision":"deny"');
    expect(outs[0]).toContain("malformed PreToolUse JSON payload");
  });
});

describe("a payload the dispatcher cannot read", () => {
  it("blocks on unparseable JSON rather than reporting a gate that never ran", async () => {
    const seen: string[] = [];
    const result = await run({ checks: [recorder({ seen })], raw: "{not json" });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain("malformed PreToolUse JSON payload");
    expect(result.stdout).toBe(denyDocument({ checkId: "pretooluse-dispatch", reason: result.stderr }));
    expect(seen).toEqual([]);
  });

  it("blocks on a payload that parses but is not an object", async () => {
    const result = await run({ checks: [], raw: "[1,2,3]" });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain("payload is not an object");
    expect(result.stdout).toBe(denyDocument({ checkId: "pretooluse-dispatch", reason: result.stderr }));
  });

  it("blocks on a payload naming no tool, because `appliesTo` has nothing to answer", async () => {
    const result = await run({ checks: [], raw: JSON.stringify({ session_id: "t" }) });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain("names no tool");
    expect(result.stdout).toBe(denyDocument({ checkId: "pretooluse-dispatch", reason: result.stderr }));
  });

  it("blocks on a tool name that is not a string", async () => {
    const result = await run({ checks: [], raw: JSON.stringify({ tool_name: 7 }) });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain("names no tool");
  });
});

describe("a payload it can read", () => {
  it("hands every check the raw payload VERBATIM, read once", async () => {
    const seen: string[] = [];
    const raw = JSON.stringify({ tool_input: { command: "echo hi" }, tool_name: "Bash" });
    const result = await run({ checks: [recorder({ seen }), recorder({ seen })], raw });
    expect(result.code).toBe(EXIT_ALLOW);
    expect(seen).toEqual([raw, raw]);
  });

  it("prints the refusing check's message on stderr, and the same reason first in a deny document on stdout", async () => {
    const door: PreToolUseCheck = {
      appliesTo: () => true,
      id: "door",
      onUnhandledError: EXIT_BLOCK,
      run: ({ writeError }) => {
        writeError("blocked because <why>\n");
        return Promise.resolve(EXIT_BLOCK);
      },
    };
    const result = await run({ checks: [door], raw: JSON.stringify({ tool_name: "Bash" }) });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toBe("blocked because <why>\n");
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "blocked because <why>\n\n(refused by the slopweaver door check)",
      },
    });
  });

  it("prints no deny document for a non-zero code that is not a refusal — the host reads it as a warning", async () => {
    const warner: PreToolUseCheck = {
      appliesTo: () => true,
      id: "warner",
      onUnhandledError: EXIT_ALLOW,
      run: ({ writeError, writeOut }) => {
        writeError("could not read the ledger\n");
        writeOut("ignored\n");
        return Promise.resolve(1);
      },
    };
    const result = await run({ checks: [warner], raw: JSON.stringify({ tool_name: "Bash" }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("could not read the ledger\n");
    expect(result.stdout).toBe("");
  });

  it("drops an allowed check's advisory once a later check refuses", async () => {
    const advisor: PreToolUseCheck = {
      appliesTo: () => true,
      id: "advisor",
      onUnhandledError: EXIT_ALLOW,
      run: ({ writeOut }) => {
        writeOut(
          `${JSON.stringify({ hookSpecificOutput: { additionalContext: "deep", hookEventName: "PreToolUse" } })}\n`,
        );
        return Promise.resolve(EXIT_ALLOW);
      },
    };
    const door: PreToolUseCheck = {
      appliesTo: () => true,
      id: "door",
      onUnhandledError: EXIT_BLOCK,
      run: ({ writeError }) => {
        writeError("no\n");
        return Promise.resolve(EXIT_BLOCK);
      },
    };
    const result = await run({ checks: [advisor, door], raw: JSON.stringify({ tool_name: "Bash" }) });
    expect(result.stdout).toBe(denyDocument({ checkId: "door", reason: "no\n" }));
  });

  it("prints an allowed run's merged advisory on stdout", async () => {
    const advisor: PreToolUseCheck = {
      appliesTo: () => true,
      id: "advisor",
      onUnhandledError: EXIT_ALLOW,
      run: ({ writeOut }) => {
        writeOut(
          `${JSON.stringify({ hookSpecificOutput: { additionalContext: "deep", hookEventName: "PreToolUse" } })}\n`,
        );
        return Promise.resolve(EXIT_ALLOW);
      },
    };
    const result = await run({ checks: [advisor], raw: JSON.stringify({ tool_name: "Bash" }) });
    expect(result.code).toBe(EXIT_ALLOW);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: { additionalContext: "deep", hookEventName: "PreToolUse" },
    });
  });
});
