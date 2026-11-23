/**
 * Every generation failure, raised through its factory: the code a caller branches on and the exact lines
 * it prints. A projection refusal must come back as its separate lines — the kind outcome keeps only the
 * first few of them, so a single joined line would change what a gap publishes.
 */
import { describe, expect, it } from "vitest";

import { OnepasswordSyncErrors, onepasswordSyncErrorLines } from "../../../../atlas/onepassword/syncErrors.js";

describe("OnepasswordSyncErrors — the generation", () => {
  it("names an untrusted generation, `none` standing for an empty side", () => {
    const error = OnepasswordSyncErrors.generationUntrusted({ mismatched: ["user"], missing: [] });

    expect(error.code).toBe("GENERATION_UNTRUSTED");
    expect(onepasswordSyncErrorLines({ error })).toEqual([
      "the current 1Password atlas generation disagrees with itself (mismatched: user; missing: none)",
      "refusing to merge against a generation this reader cannot trust",
      "run: slopweaver onepassword reset --confirm archive, then sync again",
    ]);
  });

  it("lists several kinds on each side", () => {
    const error = OnepasswordSyncErrors.generationUntrusted({
      mismatched: ["user", "vault"],
      missing: ["group", "event"],
    });

    expect(onepasswordSyncErrorLines({ error })[0]).toBe(
      "the current 1Password atlas generation disagrees with itself (mismatched: user, vault; missing: group, event)",
    );
  });

  it("names an unreadable denylist by path and error code", () => {
    const error = OnepasswordSyncErrors.denylistUnreadable({ path: "/tmp/h/hygiene-denylist.txt", reason: "EISDIR" });

    expect(error.code).toBe("DENYLIST_UNREADABLE");
    expect(onepasswordSyncErrorLines({ error })).toEqual([
      "the private hygiene denylist at /tmp/h/hygiene-denylist.txt exists but could not be read (EISDIR)",
      "refusing to sync rather than running the sensitivity gate with a denylist it never loaded",
    ]);
  });

  it("names a held lock with the lock's own words", () => {
    const error = OnepasswordSyncErrors.syncLockHeld({ holder: "held by pid 42" });

    expect(error.code).toBe("SYNC_LOCK_HELD");
    expect(onepasswordSyncErrorLines({ error })).toEqual([
      "could not acquire the 1Password atlas sync lock: held by pid 42",
    ]);
  });

  it("names a README that could not be written", () => {
    const error = OnepasswordSyncErrors.readmeUnwritable({ cause: new Error("EACCES: permission denied") });

    expect(error.code).toBe("README_UNWRITABLE");
    expect(error.message).toBe(
      "the generation was published but its README could not be written: EACCES: permission denied",
    );
  });

  it("names an entity observed without its channel", () => {
    const error = OnepasswordSyncErrors.channelEmpty({ channel: "admin-cli", entityId: "onepassword:user:abc" });

    expect(error.code).toBe("CHANNEL_EMPTY");
    expect(error.message).toBe("entity onepassword:user:abc was observed this run with no admin-cli channel populated");
  });
});

describe("OnepasswordSyncErrors — refusals that are lists", () => {
  it("refuses a record, one indented line per schema issue, `<root>` for the record itself", () => {
    const error = OnepasswordSyncErrors.recordRefused({
      issues: [
        { message: "Invalid input: expected string, received number", path: ["channels", 0, "id"] },
        { message: 'Unrecognized key: "x"', path: [] },
      ],
      kind: "user",
    });

    expect(error.code).toBe("RECORD_REFUSED");
    expect(onepasswordSyncErrorLines({ error })).toEqual([
      "a user record from 1Password does not match this atlas's allowlist schema",
      "  channels.0.id: Invalid input: expected string, received number",
      '  <root>: Unrecognized key: "x"',
      "refusing to project it rather than storing a half-understood record",
    ]);
  });

  it("keeps at most six issues, still as separate lines", () => {
    const issues = ["a", "b", "c", "d", "e", "f", "g"].map((key) => ({ message: "Required", path: [key] }));
    const lines = onepasswordSyncErrorLines({ error: OnepasswordSyncErrors.recordRefused({ issues, kind: "vault" }) });

    expect(lines).toEqual([
      "a vault record from 1Password does not match this atlas's allowlist schema",
      "  a: Required",
      "  b: Required",
      "  c: Required",
      "  d: Required",
      "  e: Required",
      "  f: Required",
      "refusing to project it rather than storing a half-understood record",
    ]);
  });

  it("refuses a document by path, reason and witness, never the value", () => {
    const error = OnepasswordSyncErrors.documentRefused({
      label: "events.json",
      refusals: [
        {
          path: "<document>",
          reason: "a value matching the onepassword-service-account-token shape reached the document",
          witness: "cc5110d6aee182fd",
        },
      ],
    });

    expect(error.code).toBe("DOCUMENT_REFUSED");
    expect(onepasswordSyncErrorLines({ error })).toEqual([
      "refusing to write events.json: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  <document>: a value matching the onepassword-service-account-token shape reached the document [witness cc5110d6aee182fd]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });
});
