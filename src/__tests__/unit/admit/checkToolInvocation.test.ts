/**
 * The check programs' leaf judgement, apart from the walk that finds them: each program is named the way a
 * refusal names it, and a program that is no check is never one.
 */
import { describe, expect, it } from "vitest";

import { checkToolLane, tscLane } from "../../../admit/checkToolInvocation.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** A Slopweaver seat's working directory. */
const SEAT = "/Users/someone/dev/personal/slopweaver/.claude/worktrees.noindex/some-seat";

/** The leaf verdict for one program's argument text, run in {@link SEAT} with no `xargs` feeding it. */
function leaf({ program, text, fed = false }: { program: string; text: string; fed?: boolean }): string | undefined {
  return checkToolLane({ args: shellWords({ text }).words, cwd: SEAT, fed, program });
}

describe("checkToolLane", () => {
  it("names each check program's whole-tree run", () => {
    expect(leaf({ program: "tsc", text: "--noEmit -p ." })).toBe("tsc --noEmit -p . (tsc over the whole project)");
    expect(leaf({ program: "oxlint", text: "--type-aware ." })).toBe("oxlint --type-aware over . (tsgolint)");
    expect(leaf({ program: "vitest", text: "run --config config/vitest/unit.ts" })).toBe(
      "vitest (a whole test lane, no file named)",
    );
    expect(leaf({ program: "prettier", text: "--check ." })).toBe(
      "prettier over . (a whole-tree format check, CI's lint job)",
    );
    expect(leaf({ program: "knip", text: "--production" })).toBe(
      "knip (whole-project dependency resolution, CI's lint job)",
    );
  });

  it("leaves a targeted run, an xargs-fed one and a program that is no check alone", () => {
    expect(leaf({ program: "tsc", text: "--noEmit src/a.ts" })).toBe(undefined);
    expect(leaf({ program: "oxlint", text: "." })).toBe(undefined);
    expect(leaf({ program: "vitest", text: "run --config config/vitest/unit.ts", fed: true })).toBe(undefined);
    expect(leaf({ program: "prettier", text: "--check src/a.ts docs/b.md" })).toBe(undefined);
    expect(leaf({ program: "prettier", text: "--check", fed: true })).toBe(undefined);
    expect(leaf({ program: "knip", text: "--help" })).toBe(undefined);
    expect(leaf({ program: "jq", text: "." })).toBe(undefined);
  });
});

describe("tscLane", () => {
  it("names a project check, and leaves a check over named source files local", () => {
    expect(tscLane({ args: ["--noEmit", "-p", "."] })).toBe("tsc --noEmit -p . (tsc over the whole project)");
    expect(tscLane({ args: ["--noEmit", "src/a.ts"] })).toBe(undefined);
  });
});
