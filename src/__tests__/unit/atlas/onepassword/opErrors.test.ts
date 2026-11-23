/**
 * Every `op` boundary failure, raised through its factory: the code a caller branches on and the exact
 * lines it prints, with a list-carrying failure kept as separate lines rather than one joined sentence.
 */
import { describe, expect, it } from "vitest";

import { OnepasswordOpErrors, onepasswordOpErrorLines } from "../../../../atlas/onepassword/opErrors.js";

describe("OnepasswordOpErrors", () => {
  it("names a malformed account by its variable only", () => {
    const error = OnepasswordOpErrors.accountMalformed({ name: "ONEPASSWORD_ACCOUNT" });

    expect(error.code).toBe("ACCOUNT_MALFORMED");
    expect(onepasswordOpErrorLines({ error })).toEqual([
      "ONEPASSWORD_ACCOUNT is not a plain account shorthand or sign-in address — refusing to put it in an argv",
    ]);
  });

  it("refuses a surface outside the allowlist as two lines, its message their join", () => {
    const error = OnepasswordOpErrors.surfaceNotAllowed({ surface: "item-get" });

    expect(error.code).toBe("SURFACE_NOT_ALLOWED");
    expect(onepasswordOpErrorLines({ error })).toEqual([
      'refusing to run `op` for the surface "item-get": it is not in the closed command allowlist',
      "every provider call this atlas may make is named in inventory.ts — adding one is a deliberate change, not a parameter",
    ]);
    expect(error.message).toBe(
      'refusing to run `op` for the surface "item-get": it is not in the closed command allowlist; every provider call this atlas may make is named in inventory.ts — adding one is a deliberate change, not a parameter',
    );
  });

  it("names each parent-id refusal", () => {
    const missing = OnepasswordOpErrors.parentIdMissing({ surface: "vault-detail" });
    const unexpected = OnepasswordOpErrors.parentIdUnexpected({ surface: "users-list" });
    const malformed = OnepasswordOpErrors.idMalformed({ id: "a;b" });

    expect([missing.code, unexpected.code, malformed.code]).toEqual([
      "PARENT_ID_MISSING",
      "PARENT_ID_UNEXPECTED",
      "ID_MALFORMED",
    ]);
    expect(missing.message).toBe("the vault-detail surface is a per-parent call and was given no parent id");
    expect(unexpected.message).toBe("the users-list surface takes no parent id but was given one");
    expect(malformed.message).toBe(
      'refusing to put "a;b" in an `op` argv: it is not shaped like a 1Password identifier',
    );
  });

  it("reports a failed call with its stderr on one indented line and the cause on the last", () => {
    const error = OnepasswordOpErrors.callFailed({
      argv: ["vault", "list"],
      cause: new Error("Command failed"),
      stderr: "[ERROR] not signed in\nsecond",
    });

    expect(error.code).toBe("CALL_FAILED");
    expect(onepasswordOpErrorLines({ error })).toEqual([
      "op vault list failed",
      "  [ERROR] not signed in / second",
      "  Command failed",
    ]);
  });

  it("omits the stderr line when stderr is blank", () => {
    const error = OnepasswordOpErrors.callFailed({
      argv: ["vault", "list"],
      cause: new Error("Command failed"),
      stderr: "   ",
    });

    expect(onepasswordOpErrorLines({ error })).toEqual(["op vault list failed", "  Command failed"]);
  });

  it("keeps only the first four stderr lines", () => {
    const error = OnepasswordOpErrors.callFailed({
      argv: ["user", "list"],
      cause: "spawn op ENOENT",
      stderr: "one\ntwo\nthree\nfour\nfive\nsix",
    });

    expect(onepasswordOpErrorLines({ error })).toEqual([
      "op user list failed",
      "  one / two / three / four",
      "  spawn op ENOENT",
    ]);
  });

  it("refuses unparseable output without printing it", () => {
    const error = OnepasswordOpErrors.outputUnparseable({ argv: ["user", "list"] });

    expect(error.code).toBe("OUTPUT_UNPARSEABLE");
    expect(onepasswordOpErrorLines({ error })).toEqual([
      "op user list returned output this atlas could not parse as JSON",
      "the output is deliberately not printed — it came from a credential store",
    ]);
  });
});
