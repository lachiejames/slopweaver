/* The whole administrator-merge command a refusal hint prints, rendered from what its caller holds. */
import { describe, expect, it } from "vitest";

import { adminMergeCommand, shellWord } from "../../../../outbound/github/adminMergeCommand.js";

describe("adminMergeCommand", () => {
  it("renders every flag the verb requires, from held values", () => {
    expect(adminMergeCommand({ base: "main", head: "feature", number: 9, repo: "acme/widget" })).toBe(
      "slopweaver github merge --repo acme/widget --base origin/main --head feature --description - " +
        "--admin --number 9 < body.md",
    );
  });

  it("carries a placeholder through bare where the caller holds no value", () => {
    expect(adminMergeCommand({ base: "<base>", head: "<branch>", number: 32, repo: "owner/name" })).toBe(
      "slopweaver github merge --repo owner/name --base origin/<base> --head <branch> --description - " +
        "--admin --number 32 < body.md",
    );
  });

  it("single-quotes a head carrying a shell character, so pasting it runs nothing", () => {
    expect(adminMergeCommand({ base: "main", head: "fix;x", number: 9, repo: "acme/widget" })).toBe(
      "slopweaver github merge --repo acme/widget --base origin/main --head 'fix;x' --description - " +
        "--admin --number 9 < body.md",
    );
  });

  it("quotes the repository and the base through the same path as the head", () => {
    expect(adminMergeCommand({ base: "rel;x", head: "feature", number: 9, repo: "acme/w$x" })).toBe(
      "slopweaver github merge --repo 'acme/w$x' --base origin/'rel;x' --head feature --description - " +
        "--admin --number 9 < body.md",
    );
  });
});

describe("shellWord", () => {
  it("leaves a plain value bare", () => {
    expect(shellWord({ value: "feature/a-b_c.1" })).toBe("feature/a-b_c.1");
  });

  it("leaves exactly one angle-bracket placeholder bare", () => {
    expect(shellWord({ value: "<owner/name>" })).toBe("<owner/name>");
  });

  it("quotes text around a placeholder, which is not one placeholder", () => {
    expect(shellWord({ value: "a<b>" })).toBe("'a<b>'");
  });

  it("single-quotes a dollar sign, so nothing expands", () => {
    expect(shellWord({ value: "x$HOME" })).toBe("'x$HOME'");
  });

  it("single-quotes a backtick, so nothing is substituted", () => {
    expect(shellWord({ value: "x`id`" })).toBe("'x`id`'");
  });

  it("closes, escapes and reopens an embedded single quote", () => {
    expect(shellWord({ value: "it's" })).toBe("'it'\\''s'");
  });
});
