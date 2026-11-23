// The store-backed port's cases are in signInRecordStore.test.ts.
import { describe, expect, it } from "vitest";

import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import {
  type CodexAuthStamp,
  type CodexSignInRecord,
  decodeCodexSignInRecord,
  nextCodexSignInRecord,
} from "../../../codex/signInRecord.js";

const HOME_ONE = "/Users/owner/.codex-one";
const FIRST_ISO = "2026-09-25T12:30:00.000Z";
const LATER_ISO = "2026-09-25T12:35:00.000Z";
const ABSENT: CodexAuthStamp = { kind: "absent" };
const STAMP: CodexAuthStamp = { ctimeMs: 10, kind: "present", mtimeMs: 10, size: 900 };

const signedOut: CodexAccountLive = { codexHome: HOME_ONE, kind: "signed-out", readAtIso: LATER_ISO };

const signedIn: CodexAccountLive = {
  accountId: "acct",
  codexHome: HOME_ONE,
  email: "codex-1@example.org",
  gauges: [],
  kind: "signed-in",
  ordinaryUsageAllowed: true,
  planType: "plus",
  readAtIso: LATER_ISO,
  resetCreditsAvailable: 0,
};

const filed: CodexSignInRecord = {
  alias: "codex-one",
  authStamp: STAMP,
  codexHome: HOME_ONE,
  failingSinceIso: FIRST_ISO,
  readAtIso: FIRST_ISO,
  state: "signed-out",
};

/** The next record for codex-one when the auth file did not move during the read. */
function next({ live, previous }: { live: CodexAccountLive; previous: CodexSignInRecord | undefined }) {
  return nextCodexSignInRecord({ alias: "codex-one", authAfter: STAMP, authBefore: STAMP, live, previous });
}

/** Decode a value as codex-one's observation. */
function decode({ value }: { value: unknown }) {
  return decodeCodexSignInRecord({ alias: "codex-one", value });
}

describe("nextCodexSignInRecord", () => {
  it("files a first refusal dated by the read that saw it, stamped with the auth file it judged", () => {
    expect(next({ live: signedOut, previous: undefined })).toEqual({
      kind: "write",
      record: { ...filed, failingSinceIso: LATER_ISO, readAtIso: LATER_ISO },
    });
  });

  it("keeps the first instant across an unbroken run of the same failure on the same store", () => {
    expect(next({ live: signedOut, previous: filed })).toEqual({
      kind: "write",
      record: { ...filed, readAtIso: LATER_ISO },
    });
  });

  it("restarts the run when the failure changes kind or the alias now names another store", () => {
    const missing: CodexAccountLive = { codexHome: HOME_ONE, kind: "store-missing", readAtIso: LATER_ISO };
    const moved = { ...filed, codexHome: "/Users/owner/.codex-old" };
    expect([next({ live: missing, previous: filed }), next({ live: signedOut, previous: moved })]).toEqual([
      { kind: "write", record: { ...filed, failingSinceIso: LATER_ISO, readAtIso: LATER_ISO, state: "store-missing" } },
      { kind: "write", record: { ...filed, failingSinceIso: LATER_ISO, readAtIso: LATER_ISO } },
    ]);
  });

  it("files signed-in once the store answers, ending the run", () => {
    expect(next({ live: signedIn, previous: filed })).toEqual({
      kind: "write",
      record: { ...filed, failingSinceIso: undefined, readAtIso: LATER_ISO, state: "signed-in" },
    });
  });

  it("keeps what is filed when the read itself failed, which says nothing about the sign-in", () => {
    const unreadable: CodexAccountLive = {
      codexHome: HOME_ONE,
      kind: "unreadable",
      readAtIso: LATER_ISO,
      reason: "deadline",
    };
    expect(next({ live: unreadable, previous: filed })).toEqual({
      kind: "keep",
      why: "the live read was unreadable: deadline",
    });
  });

  it("files a refusal even when the filed signed-in read is dated later — a clock set back never hides a card", () => {
    const later = {
      ...filed,
      failingSinceIso: undefined,
      readAtIso: "2026-09-28T10:00:00.000Z",
      state: "signed-in" as const,
    };
    expect(next({ live: signedOut, previous: later })).toEqual({
      kind: "write",
      record: { ...filed, failingSinceIso: LATER_ISO, readAtIso: LATER_ISO },
    });
  });

  it("never lets an older signed-in read undo a newer refusal a concurrent pass filed", () => {
    const newer = { ...filed, readAtIso: "2026-09-25T12:40:00.000Z" };
    expect(next({ live: signedIn, previous: newer })).toEqual({
      kind: "keep",
      why: "a read no older (2026-09-25T12:40:00.000Z) is already filed",
    });
  });

  it("orders reads by instant, not by text, so a filed refusal stamped with an offset still outranks an older read", () => {
    // The -01:00 offset reading is five minutes AFTER the live read, though it sorts before it as a string.
    const newerWithOffset = { ...filed, readAtIso: "2026-09-25T11:40:00-01:00" };
    expect(next({ live: signedIn, previous: newerWithOffset })).toEqual({
      kind: "keep",
      why: "a read no older (2026-09-25T11:40:00-01:00) is already filed",
    });
  });

  it("keeps a filed refusal on a tie within one millisecond — a card one read longer, never one hidden", () => {
    const sameMillisecond = { ...filed, readAtIso: "2026-09-25T12:35:00.0009Z" };
    const earlierWithinIt: CodexAccountLive = { ...signedIn, readAtIso: "2026-09-25T12:35:00.0001Z" };
    expect(next({ live: earlierWithinIt, previous: sameMillisecond })).toEqual({
      kind: "keep",
      why: "a read no older (2026-09-25T12:35:00.0009Z) is already filed",
    });
  });

  it("files no refusal read while auth.json changed under it — the answer may describe the file the owner replaced", () => {
    const change = nextCodexSignInRecord({
      alias: "codex-one",
      authAfter: STAMP,
      authBefore: ABSENT,
      live: signedOut,
      previous: undefined,
    });
    expect(change).toEqual({ kind: "keep", why: "auth.json changed while the live read was in flight" });
  });
});

describe("decodeCodexSignInRecord", () => {
  it("decodes a filed refusal, and a signed-in record whose failingSinceIso was dropped by JSON", () => {
    const signedInRecord = { ...filed, failingSinceIso: undefined, state: "signed-in" as const };
    expect([decode({ value: filed }), decode({ value: JSON.parse(JSON.stringify(signedInRecord)) })]).toEqual([
      { record: filed },
      { record: signedInRecord },
    ]);
  });

  it("refuses a value that is not an object, or names another alias", () => {
    expect([decode({ value: [] }), decode({ value: { ...filed, alias: "codex-two" } })]).toEqual([
      { why: "is not a JSON object" },
      { why: 'names alias "codex-two", not codex-one' },
    ]);
  });

  it("refuses a state no live read files", () => {
    expect(decode({ value: { ...filed, state: "capped" } })).toEqual({
      why: 'carries state "capped", not signed-in, signed-out or store-missing',
    });
  });

  it("refuses a readAtIso that is not an instant, so the ordering guard never reads it", () => {
    expect(decode({ value: { ...filed, readAtIso: "yesterday" } })).toEqual({
      why: 'carries readAtIso "yesterday", which is not an instant',
    });
  });

  it("refuses a readAtIso Date.parse would roll over, or one with an offset — only the written form is trusted", () => {
    expect([
      decode({ value: { ...filed, readAtIso: "2026-02-30T00:00:00.000Z" } }),
      decode({ value: { ...filed, readAtIso: "2026-09-25T11:40:00-01:00" } }),
    ]).toEqual([
      { why: 'carries readAtIso "2026-02-30T00:00:00.000Z", which is not an instant' },
      { why: 'carries readAtIso "2026-09-25T11:40:00-01:00", which is not an instant' },
    ]);
  });

  it("refuses a refusal whose failingSinceIso is not an instant, so no stray text reaches the card", () => {
    expect(decode({ value: { ...filed, failingSinceIso: HOME_ONE } })).toEqual({
      why: `carries failingSinceIso "${HOME_ONE}", which is not an instant`,
    });
  });

  it("refuses a signed-in record that carries a failingSinceIso, since none is ever written", () => {
    expect(decode({ value: { ...filed, failingSinceIso: "yesterday", state: "signed-in" } })).toEqual({
      why: "is signed-in yet carries a failingSinceIso",
    });
  });

  it("refuses a record with no readable auth stamp", () => {
    expect(decode({ value: { ...filed, authStamp: { kind: "present" } } })).toEqual({
      why: "carries no readable authStamp",
    });
  });
});
