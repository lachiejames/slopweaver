/**
 * The seat gate's runner: the exit code it returns for one `PreToolUse` payload, and the fact that its
 * refusal names the hatch and where CI's verdict arrives instead.
 *
 * Every seam is a plain injected function, never a mock: the payload is a string this test writes.
 */
import { describe, expect, it } from "vitest";

import { runWholeTreeCheckGuard } from "../../../admit/wholeTreeCheckGuardRunner.js";

/** Run the guard over one payload, collecting whatever it wrote to stderr. */
async function judge({
  payload,
  env = {},
}: {
  payload: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly code: number; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const code = await runWholeTreeCheckGuard({
    env,
    readStdin: () => Promise.resolve(payload),
    writeError: (line) => {
      errors.push(line);
    },
  });
  return { code, errors };
}

/** A `PreToolUse` payload for one Bash command. */
function bashPayload({ command }: { command: string }): string {
  return JSON.stringify({ cwd: "/dev/slopweaver", session_id: "s1", tool_input: { command }, tool_name: "Bash" });
}

describe("runWholeTreeCheckGuard", () => {
  it("refuses the whole lint lap with exit 2", async () => {
    const { code } = await judge({ payload: bashPayload({ command: "timeout 900 yarn lint" }) });
    expect(code).toBe(2);
  });

  it("names the run, the hatch, CI's jobs and the local alternatives in the refusal", async () => {
    const { errors } = await judge({ payload: bashPayload({ command: "yarn typecheck" }) });
    expect(errors.length).toBe(1);
    const refusal = errors[0]!;
    expect(refusal.split("\n")[0]).toBe(
      "a whole-tree lint lap, type-aware oxlint, tsc, a whole test lane, a whole-tree prettier check or knip " +
        "blocked because this re-proves the whole tree — it builds the TypeScript type checker over it, runs a " +
        "whole test lane, or re-checks the whole tree's format or dependency graph, and tsgolint, tsc, vitest, " +
        "prettier and knip each hold several cores for minutes — and that is CI's lane, never a seat's: a gate " +
        "runs on this machine only when CI cannot see its subject (yarn typecheck (tsc over the whole " +
        "project)).",
    );
    expect(refusal).toContain("SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1");
    expect(refusal).toContain("slopweaver github checks --number <n> --wait");
    expect(refusal).toContain("slopweaver dev lint --only <gate>");
    expect(refusal).toContain("yarn oxlint <changed files>");
    expect(refusal).toContain("yarn prettier --check <changed files>");
    expect(refusal).toContain("yarn vitest run --config config/vitest/unit.ts <test files>");
    expect(refusal).toContain("Use good judgement");
  });

  it("refuses the finding's own lap, which named prettier and knip beside oxlint", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({ command: "slopweaver dev lint --only prettier,oxlint,knip,constraints,hygiene" }),
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain(
      "(slopweaver dev lint --only oxlint,prettier,knip (a whole-tree type-checker gate; a whole-tree CI gate)).",
    );
  });

  it("allows a single cheap gate and writes nothing", async () => {
    const { code, errors } = await judge({
      payload: bashPayload({ command: "slopweaver dev lint --only jsdoc-tags" }),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });

  it("is opened by the ambient hatch", async () => {
    const { code, errors } = await judge({
      env: { SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK: "1" },
      payload: bashPayload({ command: "yarn lint" }),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });

  it("fails OPEN on a payload it cannot read", async () => {
    expect((await judge({ payload: "not json" })).code).toBe(0);
    expect((await judge({ payload: "[]" })).code).toBe(0);
    expect((await judge({ payload: JSON.stringify({ tool_name: "Read" }) })).code).toBe(0);
    expect((await judge({ payload: JSON.stringify({ tool_input: {}, tool_name: "Bash" }) })).code).toBe(0);
  });
});
