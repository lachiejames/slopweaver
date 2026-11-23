import { describe, expect, it } from "vitest";

import { CAPACITY_CAVEAT, codexLoginCommand, codexLoginInstruction } from "../../../plans/login.js";

describe("codexLoginCommand", () => {
  it("creates the home before signing into it, so the line works the first time", () => {
    expect(codexLoginCommand({ codexHome: "/Users/owner/.codex-work" })).toBe(
      "mkdir -p /Users/owner/.codex-work && CODEX_HOME=/Users/owner/.codex-work codex login",
    );
  });

  it("keeps a path holding a space as one token, in both places it appears", () => {
    expect(codexLoginCommand({ codexHome: "/Users/owner/Codex Homes/work" })).toBe(
      "mkdir -p '/Users/owner/Codex Homes/work' && CODEX_HOME='/Users/owner/Codex Homes/work' codex login",
    );
  });

  it("keeps a path holding an apostrophe as one token, closing and reopening the quote", () => {
    expect(codexLoginCommand({ codexHome: "/Users/owner/ada's codex" })).toBe(
      `mkdir -p '/Users/owner/ada'\\''s codex' && CODEX_HOME='/Users/owner/ada'\\''s codex' codex login`,
    );
  });

  it("quotes shell metacharacters rather than letting them run", () => {
    expect(codexLoginCommand({ codexHome: "/tmp/a; rm -rf $HOME" })).toBe(
      "mkdir -p '/tmp/a; rm -rf $HOME' && CODEX_HOME='/tmp/a; rm -rf $HOME' codex login",
    );
  });
});

describe("codexLoginInstruction", () => {
  it("offers Settings → Models, hands the owner the exact command, and prints the capacity caveat", () => {
    expect(codexLoginInstruction({ codexHome: "/Users/owner/.codex-work" })).toBe(
      "Sign this destination in from Settings → Models in the console, or from your own terminal:\n" +
        "  mkdir -p /Users/owner/.codex-work && CODEX_HOME=/Users/owner/.codex-work codex login\n" +
        "Two homes signed into the same account add no capacity.",
    );
    expect(CAPACITY_CAVEAT).toBe("Two homes signed into the same account add no capacity.");
  });
});
