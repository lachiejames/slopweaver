/**
 * The harness's own `matcher` rules, which folding ten entries into one made this repository's job.
 *
 * Every case here is one the fold would have got wrong under the obvious `new RegExp(matcher).test(name)`:
 * that spelling hands `admit` every `BashOutput`, the memory gate every `TodoWrite` and the sub-agent ban
 * every `TaskOutput` — calls none of the ten entries ever saw.
 */
import { describe, expect, it } from "vitest";

import { hookMatcherSelects } from "../../../admit/hookMatcher.js";

describe("the exact-name path", () => {
  it("matches a single name and nothing it is a prefix of", () => {
    expect(hookMatcherSelects({ matcher: "Bash", toolName: "Bash" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "Bash", toolName: "BashOutput" })).toBe(false);
  });

  it("treats a pipe as a list of exact names, NOT as regex alternation", () => {
    expect(hookMatcherSelects({ matcher: "Edit|Write", toolName: "Edit" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "Edit|Write", toolName: "Write" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "Edit|Write", toolName: "TodoWrite" })).toBe(false);
    expect(hookMatcherSelects({ matcher: "Edit|Write", toolName: "NotebookEdit" })).toBe(false);
  });

  it("does not let Agent|Task reach TaskOutput", () => {
    expect(hookMatcherSelects({ matcher: "Agent|Task", toolName: "Task" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "Agent|Task", toolName: "TaskOutput" })).toBe(false);
  });

  it("accepts a comma list and surrounding whitespace", () => {
    expect(hookMatcherSelects({ matcher: "Edit, Write", toolName: "Write" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "Edit , Write", toolName: "Edit" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "Edit, Write", toolName: "Bash" })).toBe(false);
  });
});

describe("the regex path", () => {
  it("takes any other character as a regex, tested unanchored", () => {
    expect(hookMatcherSelects({ matcher: "mcp__claude-in-chrome__.*", toolName: "mcp__claude-in-chrome__tab" })).toBe(
      true,
    );
    expect(hookMatcherSelects({ matcher: "mcp__claude-in-chrome__.*", toolName: "mcp__other__tab" })).toBe(false);
    expect(hookMatcherSelects({ matcher: "^Notebook", toolName: "NotebookEdit" })).toBe(true);
  });

  it("is unanchored, which is why the folded union anchors each of its own names", () => {
    expect(hookMatcherSelects({ matcher: "Edit|mcp__x.*", toolName: "NotebookEdit" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "^(?:Edit)$|^mcp__x", toolName: "NotebookEdit" })).toBe(false);
  });
});

describe("the match-everything path", () => {
  it("matches every tool for the wildcard and the empty string", () => {
    expect(hookMatcherSelects({ matcher: "*", toolName: "Read" })).toBe(true);
    expect(hookMatcherSelects({ matcher: "", toolName: "Read" })).toBe(true);
  });
});
