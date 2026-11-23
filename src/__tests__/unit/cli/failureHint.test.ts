/**
 * The pure failure-hint mapper: each signature class yields its exact one-line hint, the first matching
 * signature wins when a reason carries two, the auth hint names the env var only when the message spells
 * one, and anything unrecognised — including a run that carries no reason at all — answers null.
 */
import { describe, expect, it } from "vitest";

import { type FailureFacts, failureHint } from "../../../cli/failureHint.js";

/** A failed `github merge` run, with whatever thrown-error facts the case adds. */
function failedRun({ reason, errorClass }: { reason?: string; errorClass?: string }): FailureFacts {
  return {
    code: 1,
    noun: "github",
    verb: "merge",
    ...(reason === undefined ? {} : { reason }),
    ...(errorClass === undefined ? {} : { errorClass }),
  };
}

const CONTENTION = "likely contention — retry once; the referenced lock is held by another run";
const NOT_FOUND = "benign not-found — the referenced resource is absent, not a fault";
const AUTH_GENERIC = "missing auth — set the required token env var (the message names which), or run `gh auth login`";

describe("failureHint", () => {
  it("maps a held lock to the contention hint", () => {
    expect(failureHint(failedRun({ errorClass: "SqliteError", reason: "SQLITE_BUSY: database is locked" }))).toBe(
      CONTENTION,
    );
    expect(failureHint(failedRun({ reason: "could not acquire the advisory lock on run 7" }))).toBe(CONTENTION);
  });

  it("maps an API *_not_found to the benign not-found hint, but not a bare 'not found'", () => {
    expect(failureHint(failedRun({ reason: "slack said channel_not_found" }))).toBe(NOT_FOUND);
    expect(failureHint(failedRun({ reason: "channel not found" }))).toBe(null);
  });

  it("names the env var the auth message spells", () => {
    expect(failureHint(failedRun({ reason: "token missing: set GITHUB_TOKEN to a fine-grained token" }))).toBe(
      "missing auth — set GITHUB_TOKEN, or run `gh auth login`",
    );
  });

  it("falls back to the generic auth hint when the message names no underscored env var", () => {
    expect(failureHint(failedRun({ reason: "HttpError: Bad credentials (TOKEN)" }))).toBe(AUTH_GENERIC);
  });

  it("matches the thrown error's class as well as its message", () => {
    expect(failureHint(failedRun({ errorClass: "EBUSY", reason: "the write did not complete" }))).toBe(CONTENTION);
  });

  it("answers null for an unrecognised failure, and for a run that carries no reason or class", () => {
    expect(failureHint(failedRun({ errorClass: "TypeError", reason: "cannot read properties of undefined" }))).toBe(
      null,
    );
    expect(failureHint(failedRun({}))).toBe(null);
  });

  it("lets the first signature win when a reason carries both a lock and an auth failure", () => {
    expect(failureHint(failedRun({ reason: "invalid_auth after: database is locked" }))).toBe(CONTENTION);
    expect(failureHint(failedRun({ reason: "user_not_found, then not_authed" }))).toBe(NOT_FOUND);
  });
});
