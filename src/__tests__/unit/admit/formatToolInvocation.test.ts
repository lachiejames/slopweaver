/**
 * `formatToolInvocation.ts`: what a `prettier` or `knip` run covers, read from its own words.
 */
import { describe, expect, it } from "vitest";

import { knipScope, prettierScope } from "../../../admit/formatToolInvocation.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** Judge one literal `prettier` tail. */
function prettier({ text }: { text: string }): ReturnType<typeof prettierScope> {
  return prettierScope({ args: shellWords({ text }).words });
}

/** Judge one literal `knip` tail. */
function knip({ text }: { text: string }): ReturnType<typeof knipScope> {
  return knipScope({ args: shellWords({ text }).words });
}

describe("prettierScope", () => {
  it("names a directory, a glob or the root as the whole run, in check, list or stdout mode", () => {
    expect(prettier({ text: "--check ." })).toEqual({ kind: "whole", over: "." });
    expect(prettier({ text: "-c src docs/a.md" })).toEqual({ kind: "whole", over: "src docs/a.md" });
    expect(prettier({ text: "--list-different '**/*.md'" })).toEqual({ kind: "whole", over: "**/*.md" });
    expect(prettier({ text: "src" })).toEqual({ kind: "whole", over: "src" });
    // A dotfile with no extension reads as the directory it looks like: a false refusal, stated in the module.
    expect(prettier({ text: "--check .claude" })).toEqual({ kind: "whole", over: ".claude" });
    expect(prettier({ text: "--check .claude/worktrees.noindex" })).toEqual({
      kind: "whole",
      over: ".claude/worktrees.noindex",
    });
    // After `--` a write flag is a path, so this checks the tree.
    expect(prettier({ text: "--check -- --write ." })).toEqual({ kind: "whole", over: "--write ." });
    expect(prettier({ text: "--check -- src/a.ts ." })).toEqual({ kind: "whole", over: "src/a.ts ." });
  });

  it("reads the gate's own spelling, a value flag's value skipped", () => {
    expect(prettier({ text: "--experimental-cli --no-cache --parallel-workers 4 --check ." })).toEqual({
      kind: "whole",
      over: ".",
    });
    expect(prettier({ text: "--check --log-level warn src/a.ts" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check --print-width=120 src/a.ts" })).toEqual({ kind: "local" });
  });

  it("keeps files, a computed list, write mode, a printing run, stdin and no operand local", () => {
    expect(prettier({ text: "--check src/a.ts docs/b.md .oxlintrc.jsonc" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check $(git diff --name-only)" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check 'site/app/api/act/[verb]/route.ts'" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check {} +" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check src/__tests__/integration/__recordings__/a/recording.har" })).toEqual({
      kind: "local",
    });
    expect(prettier({ text: "--write ." })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check -w ." })).toEqual({ kind: "local" });
    expect(prettier({ text: "--help check" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--file-info src/a.ts" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--stdin-filepath src/a.ts" })).toEqual({ kind: "local" });
    expect(prettier({ text: "--check" })).toEqual({ kind: "local" });
  });
});

describe("knipScope", () => {
  it("names every run the whole project unless it only prints", () => {
    expect(knip({ text: "" })).toBe("whole");
    expect(knip({ text: "--exclude exports,nsExports,types,nsTypes" })).toBe("whole");
    expect(knip({ text: "--help" })).toBe("local");
    expect(knip({ text: "-V" })).toBe("local");
  });
});
