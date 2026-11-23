/**
 * The pure rule that combines ten folded `PreToolUse` checks — the three decisions `preToolUseDispatch.ts`
 * owns, each asserted against a fake check rather than a real guard.
 *
 * A fake check here is a plain object satisfying the `PreToolUseCheck` contract, which is the seam the
 * dispatcher declares: no mock, and nothing that could pass if the contract changed under it.
 */
import { describe, expect, it } from "vitest";

import {
  denyDocument,
  dispatchPreToolUse,
  EXIT_ALLOW,
  EXIT_BLOCK,
  mergeHookStdout,
  type PreToolUseCheck,
} from "../../../admit/preToolUseDispatch.js";

/** Every check the tests build, so "which ones ran" is a list rather than a flag. */
const ran: string[] = [];

/** The checks whose queued `afterEmit` effect a test has run, in order. */
const committed: string[] = [];

/** A check that records that it ran and then answers a fixed code, writing the lines it was given. */
function check({
  id,
  applies = true,
  code = EXIT_ALLOW,
  err = "",
  out = "",
  onUnhandledError = EXIT_ALLOW,
  throws = false,
  commit = false,
}: {
  id: string;
  applies?: boolean;
  code?: number;
  err?: string;
  out?: string;
  onUnhandledError?: number;
  throws?: boolean;
  commit?: boolean;
}): PreToolUseCheck {
  return {
    appliesTo: () => applies,
    id,
    onUnhandledError,
    run: ({ afterEmit, writeError, writeOut }) => {
      ran.push(id);
      if (commit) {
        afterEmit(() => committed.push(id));
      }
      if (throws) {
        return Promise.reject(new Error(`${id} exploded`));
      }
      if (err !== "") {
        writeError(err);
      }
      if (out !== "") {
        writeOut(out);
      }
      return Promise.resolve(code);
    },
  };
}

/** One advisory line, in the shape a check really writes to stdout. */
function advisory({ text }: { text: string }): string {
  return `${JSON.stringify({
    hookSpecificOutput: { additionalContext: text, hookEventName: "PreToolUse" },
  })}\n`;
}

const RAW = JSON.stringify({ session_id: "t", tool_input: { command: "echo hi" }, tool_name: "Bash" });

async function dispatch({ checks }: { checks: readonly PreToolUseCheck[] }) {
  ran.length = 0;
  return dispatchPreToolUse({ checks, raw: RAW, toolName: "Bash" });
}

describe("afterEmit — an effect that may only follow the printed output", () => {
  /** Dispatch, then run what the result says to run once its output is printed. */
  async function dispatchAndCommit({ checks }: { checks: readonly PreToolUseCheck[] }): Promise<number> {
    committed.length = 0;
    const result = await dispatch({ checks });
    result.commits.forEach((commit) => commit());
    return result.code;
  }

  it("is handed back, never run, by the dispatcher — the refusing check's alone on a refusal", async () => {
    committed.length = 0;
    const result = await dispatch({
      checks: [check({ commit: true, id: "a" }), check({ code: EXIT_BLOCK, commit: true, err: "no.\n", id: "held" })],
    });
    expect([result.commits.length, committed]).toEqual([1, []]);
    result.commits.forEach((commit) => commit());
    expect(committed).toEqual(["held"]);
  });

  it("carries every allowing check's effect on an allowed call", async () => {
    const code = await dispatchAndCommit({
      checks: [check({ commit: true, id: "a" }), check({ commit: true, id: "b" })],
    });
    expect([code, committed]).toEqual([EXIT_ALLOW, ["a", "b"]]);
  });

  it("drops what a check queued before it threw", async () => {
    const code = await dispatchAndCommit({
      checks: [check({ commit: true, id: "boom", onUnhandledError: EXIT_BLOCK, throws: true })],
    });
    expect([code, committed]).toEqual([EXIT_BLOCK, []]);
  });
});

describe("the first refusal wins, and short-circuits", () => {
  it("returns the refusing check's code and message, and names the check", async () => {
    const result = await dispatch({
      checks: [check({ id: "first" }), check({ code: EXIT_BLOCK, err: "no.\n", id: "door" })],
    });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.stderr).toBe("no.\n");
    expect(result.refusedBy).toBe("door");
  });

  it("never runs a check registered AFTER the refusal — the behaviour change ten processes could not have", async () => {
    await dispatch({
      checks: [check({ code: EXIT_BLOCK, err: "no.\n", id: "door" }), check({ id: "poll-gate" })],
    });
    expect(ran).toEqual(["door"]);
  });

  it("drops a refused run's advisories, because the call it advised about is not happening", async () => {
    const result = await dispatch({
      checks: [
        check({ id: "advisor", out: advisory({ text: "you are deep" }) }),
        check({ code: EXIT_BLOCK, err: "no.\n", id: "door" }),
      ],
    });
    expect(result.stdout).toBe("");
  });

  it("skips a check whose matcher does not apply, without counting it as an allow", async () => {
    const result = await dispatch({
      checks: [check({ applies: false, code: EXIT_BLOCK, err: "unreachable\n", id: "browser" }), check({ id: "tail" })],
    });
    expect(ran).toEqual(["tail"]);
    expect(result.code).toBe(EXIT_ALLOW);
  });

  it("allows a call no check refuses", async () => {
    const result = await dispatch({ checks: [check({ id: "a" }), check({ id: "b" })] });
    expect(result).toEqual({ code: EXIT_ALLOW, commits: [], refusedBy: undefined, stderr: "", stdout: "" });
    expect(ran).toEqual(["a", "b"]);
  });

  it("allows a call when the registry is empty", async () => {
    const result = await dispatch({ checks: [] });
    expect(result.code).toBe(EXIT_ALLOW);
  });
});

describe("one check's exception decides only its own verdict", () => {
  it("blocks on a throw from a check whose policy is block, and says which check died", async () => {
    const result = await dispatch({
      checks: [check({ id: "door", onUnhandledError: EXIT_BLOCK, throws: true }), check({ id: "after" })],
    });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.refusedBy).toBe("door");
    expect(result.stderr).toContain("door: guard failed to run (Error: door exploded)");
    expect(ran).toEqual(["door"]);
  });

  it("carries on past a throw from a check whose policy is allow, and reaches the door behind it", async () => {
    const result = await dispatch({
      checks: [
        check({ id: "tripwire", onUnhandledError: EXIT_ALLOW, throws: true }),
        check({ code: EXIT_BLOCK, err: "door said no\n", id: "door" }),
      ],
    });
    expect(result.code).toBe(EXIT_BLOCK);
    expect(result.refusedBy).toBe("door");
    expect(result.stderr).toBe("door said no\n");
    expect(ran).toEqual(["tripwire", "door"]);
  });

  it("keeps a thrown check's own refusal text when it wrote one before throwing", async () => {
    const wordy: PreToolUseCheck = {
      appliesTo: () => true,
      id: "wordy",
      onUnhandledError: EXIT_BLOCK,
      run: ({ writeError }) => {
        writeError("the real refusal, with a hatch\n");
        return Promise.reject(new Error("then it died"));
      },
    };
    const result = await dispatch({ checks: [wordy] });
    expect(result.stderr).toBe("the real refusal, with a hatch\n");
  });
});

describe("advisories merge into ONE document", () => {
  it("joins two checks' advisories into a single parseable hook document", async () => {
    const result = await dispatch({
      checks: [
        check({ id: "depth", out: advisory({ text: "you are at 500k" }) }),
        check({ id: "other", out: advisory({ text: "and the branch is stale" }) }),
      ],
    });
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        additionalContext: "you are at 500k\n\nand the branch is stale",
        hookEventName: "PreToolUse",
      },
    });
  });

  it("prints nothing at all when no check advised", () => {
    expect(mergeHookStdout({ lines: [] })).toBe("");
    expect(mergeHookStdout({ lines: ["", "   "] })).toBe("");
  });

  it("drops a line that is not a hook document rather than corrupting the channel", () => {
    expect(mergeHookStdout({ lines: ["not json at all\n", "[1,2,3]", '{"hookSpecificOutput":null}'] })).toBe("");
  });

  it("drops a document whose advisory is empty, and keeps the real one beside it", () => {
    const merged = mergeHookStdout({ lines: [advisory({ text: "" }), advisory({ text: "real" })] });
    expect(JSON.parse(merged)).toEqual({
      hookSpecificOutput: { additionalContext: "real", hookEventName: "PreToolUse" },
    });
  });

  it("ends the document with a newline, so a reader taking one line gets the whole thing", () => {
    expect(mergeHookStdout({ lines: [advisory({ text: "x" })] }).endsWith("}\n")).toBe(true);
  });
});

describe("denyDocument — the refusal Claude Code renders with no hook command in front of it", () => {
  it("puts the reason first and names the refusing check after it", () => {
    expect(JSON.parse(denyDocument({ checkId: "poll-gate", reason: "poll-gate: refused a log read\n" }))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "poll-gate: refused a log read\n\n(refused by the slopweaver poll-gate check)",
      },
    });
  });

  it("keeps a multi-line reason whole, dropping only its trailing whitespace", () => {
    const reason = "  blocked because x.\nLegitimate exceptions may include y.\n\n";
    expect(JSON.parse(denyDocument({ checkId: "door", reason })).hookSpecificOutput.permissionDecisionReason).toBe(
      "  blocked because x.\nLegitimate exceptions may include y.\n\n(refused by the slopweaver door check)",
    );
  });

  it("says a check gave no reason rather than printing an empty one", () => {
    expect(
      JSON.parse(denyDocument({ checkId: "door", reason: "  \n" })).hookSpecificOutput.permissionDecisionReason,
    ).toBe("refused with no reason given\n\n(refused by the slopweaver door check)");
  });

  it("is one newline-terminated line", () => {
    const document = denyDocument({ checkId: "door", reason: "a\nb" });
    expect(document.endsWith("}\n")).toBe(true);
    expect(document.split("\n").length).toBe(2);
  });
});
