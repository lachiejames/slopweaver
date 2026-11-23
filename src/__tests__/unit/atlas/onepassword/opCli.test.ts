/**
 * The `op` boundary's refusals, each of which returns BEFORE any subprocess is started. No case here may
 * pass the argv checks: one that did would spawn a real `op`.
 */
import { describe, expect, it } from "vitest";

import {
  classifyOpFailure,
  opCliOnlyEnv,
  parseOpSigninExport,
  redactOpSessions,
  runOpSurface,
  signinFailureLines,
} from "../../../../atlas/onepassword/opCli.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("runOpSurface refuses before spawning", () => {
  it("refuses a surface outside the closed command allowlist", () => {
    expect(unwrapErr(runOpSurface({ env: {}, surface: "item-get" }))).toEqual([
      'refusing to run `op` for the surface "item-get": it is not in the closed command allowlist',
      "every provider call this atlas may make is named in inventory.ts — adding one is a deliberate change, not a parameter",
    ]);
  });

  it("refuses a per-parent surface given no parent id", () => {
    expect(unwrapErr(runOpSurface({ env: {}, surface: "vault-detail" }))).toEqual([
      "the vault-detail surface is a per-parent call and was given no parent id",
    ]);
  });

  it("refuses a once-per-run surface given a parent id", () => {
    expect(unwrapErr(runOpSurface({ env: {}, id: "abc", surface: "users-list" }))).toEqual([
      "the users-list surface takes no parent id but was given one",
    ]);
  });

  it("refuses an id that is not shaped like a 1Password identifier", () => {
    expect(unwrapErr(runOpSurface({ env: {}, id: "a;b", surface: "vault-detail" }))).toEqual([
      'refusing to put "a;b" in an `op` argv: it is not shaped like a 1Password identifier',
    ]);
  });
});

describe("opCliOnlyEnv", () => {
  it("switches the desktop-app integration off whatever the caller had, keeping the rest", () => {
    expect(opCliOnlyEnv({ env: { OP_BIOMETRIC_UNLOCK_ENABLED: "true", OP_SESSION_ABC: "t" } })).toEqual({
      OP_BIOMETRIC_UNLOCK_ENABLED: "false",
      OP_SESSION_ABC: "t",
    });
  });
});

describe("parseOpSigninExport", () => {
  it("reads the one export line op signin prints", () => {
    const stdout =
      'export OP_SESSION_VGDC7SF6J5FFRIRJSM2NE4TTTU="abc_DEF-123"\n# This command is meant to be used with your shell\'s eval function.\n';
    expect(unwrap(parseOpSigninExport({ stdout }))).toEqual({
      name: "OP_SESSION_VGDC7SF6J5FFRIRJSM2NE4TTTU",
      token: "abc_DEF-123",
    });
  });

  it("refuses output with no export line, without quoting it", () => {
    const failure = unwrapErr(parseOpSigninExport({ stdout: "secret-looking-output" }));
    expect(failure.code).toBe("SIGNIN_OUTPUT_UNPARSEABLE");
    expect(failure.message).not.toContain("secret-looking-output");
  });

  it("refuses two export lines rather than guessing which account one belongs to", () => {
    const stdout = 'export OP_SESSION_A="x"\nexport OP_SESSION_B="y"\n';
    expect(unwrapErr(parseOpSigninExport({ stdout })).message).toBe(
      "op signin printed 2 `export OP_SESSION_…` line(s), not exactly one — the output is deliberately not printed, it carries a session token",
    );
  });
});

describe("classifyOpFailure", () => {
  it("reads op's expired-session sentence as not signed in", () => {
    expect(classifyOpFailure({ stderr: "[ERROR] no active session found for account atlas" })).toBe(
      "cli-not-signed-in",
    );
  });

  it("reads op's lapsed-token sentence, after a first sign-in, as not signed in", () => {
    expect(
      classifyOpFailure({ stderr: "[ERROR] 2026/09/28 14:23:59 could not find session token for account atlas" }),
    ).toBe("cli-not-signed-in");
  });
});

describe("signinFailureLines", () => {
  it("keeps only error sentences and redacts the password from them", () => {
    const output = 'Enter the password for a@b.c:\n[ERROR] rejected s3cret-pw here\nexport OP_SESSION_A="tok"\n';
    expect(signinFailureLines({ output, password: "s3cret-pw" })).toEqual(["[ERROR] rejected <redacted> here"]);
  });
});

describe("redactOpSessions", () => {
  it("redacts every session token the child was handed, leaving other values alone", () => {
    const env = { HOME: "/home/x", OP_SESSION_ABC: "tok-0123456789abcdefghij" };
    expect(redactOpSessions({ env, text: "[ERROR] tok-0123456789abcdefghij from /home/x" })).toBe(
      "[ERROR] <redacted> from /home/x",
    );
  });

  it("leaves op's own failure intact when a session value is too short to be a token", () => {
    const text = "[ERROR] no active session found for account atlas";
    expect(redactOpSessions({ env: { OP_SESSION_X: "a" }, text })).toBe(text);
  });
});
