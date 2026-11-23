/**
 * `decodeAskLifecycleEvent` — one decoded log record to its typed event, or `undefined` for a shape that does
 * not match. The `first-answered` kind is the witness this branch added; the older kinds hold the posture that
 * an unreadable record is refused rather than folded in with a guess.
 */
import { describe, expect, it } from "vitest";

import { decodeAskLifecycleEvent } from "../../../../live/ask/lifecycleDecode.js";

const BASE = {
  channel: "C0SYN000010",
  messageTs: "1790924298.202269",
  threadTs: "1790924298.202269",
  tsIso: "2026-10-02T07:34:58.645Z",
};

const FIRST_ANSWERED = {
  ...BASE,
  answerDigest: "digest-of-the-plan",
  answerTs: "1790926498.645000",
  kind: "first-answered",
  leaseExpiresAt: "2026-10-02T09:34:58.645Z",
  owes: "pull-requests",
  what: "open the two pull requests the plan names",
};

/**
 * A copy of `record` with `field` removed — `it.each` hands the field over as a plain `string`, which a
 * computed destructure cannot index.
 *
 * @param field the key to drop
 * @param record the complete record it is dropped from
 * @returns the record without that one key
 */
function withoutField({ field, record }: { field: string; record: Record<string, string> }): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

describe("decodeAskLifecycleEvent — identity fields", () => {
  it.each(["channel", "messageTs", "threadTs", "tsIso"])("refuses a record whose %s is missing", (field) => {
    const rest = withoutField({ field, record: { ...BASE, kind: "lease-expired" } });

    expect(decodeAskLifecycleEvent({ value: rest })).toBeUndefined();
  });

  it("refuses a record whose identity field is an empty string", () => {
    expect(decodeAskLifecycleEvent({ value: { ...BASE, channel: "", kind: "lease-expired" } })).toBeUndefined();
  });

  it("refuses a kind nothing declares", () => {
    expect(decodeAskLifecycleEvent({ value: { ...BASE, kind: "teleported" } })).toBeUndefined();
  });
});

describe("decodeAskLifecycleEvent — first-answered", () => {
  it("decodes a complete record into exactly the typed event", () => {
    expect(decodeAskLifecycleEvent({ value: FIRST_ANSWERED })).toEqual(FIRST_ANSWERED);
  });

  it.each(["answerTs", "answerDigest", "what", "leaseExpiresAt", "owes"])("refuses a record missing %s", (field) => {
    const rest = withoutField({ field, record: FIRST_ANSWERED });

    expect(decodeAskLifecycleEvent({ value: rest })).toBeUndefined();
  });

  it("refuses an owes value outside the closed set", () => {
    expect(decodeAskLifecycleEvent({ value: { ...FIRST_ANSWERED, owes: "progress-posts" } })).toBeUndefined();
  });
});

describe("decodeAskLifecycleEvent — the older kinds", () => {
  it("decodes a captured event and carries the optional text when present", () => {
    const value = { ...BASE, kind: "captured", surface: "dm", text: "why did staging fail", userId: "U0AAA" };

    expect(decodeAskLifecycleEvent({ value })).toEqual(value);
  });

  it("decodes a captured event with no text — the legitimate old-log state", () => {
    const value = { ...BASE, kind: "captured", surface: "channel", userId: "U0AAA" };

    expect(decodeAskLifecycleEvent({ value })).toEqual(value);
  });

  it("refuses a captured event naming a surface that is neither channel nor dm", () => {
    const value = { ...BASE, kind: "captured", surface: "email", userId: "U0AAA" };

    expect(decodeAskLifecycleEvent({ value })).toBeUndefined();
  });

  it("decodes a reasoned kind, and refuses it without its reason", () => {
    const failed = { ...BASE, kind: "failed", reason: "worker died" };

    expect(decodeAskLifecycleEvent({ value: failed })).toEqual(failed);
    expect(decodeAskLifecycleEvent({ value: { ...BASE, kind: "failed" } })).toBeUndefined();
  });

  it("decodes left-for-a-human with its reason, and refuses it without one", () => {
    const left = { ...BASE, kind: "left-for-a-human", reason: "a lockout is IT's to answer" };

    expect(decodeAskLifecycleEvent({ value: left })).toEqual(left);
    expect(decodeAskLifecycleEvent({ value: { ...BASE, kind: "left-for-a-human" } })).toBeUndefined();
  });

  it("decodes an answered event and refuses it without answerTs", () => {
    const answered = { ...BASE, answerTs: "1790926498.645000", kind: "answered" };

    expect(decodeAskLifecycleEvent({ value: answered })).toEqual(answered);
    expect(decodeAskLifecycleEvent({ value: { ...BASE, kind: "answered" } })).toBeUndefined();
  });

  it("decodes lease-expired with no fields beyond the identity", () => {
    expect(decodeAskLifecycleEvent({ value: { ...BASE, kind: "lease-expired" } })).toEqual({
      ...BASE,
      kind: "lease-expired",
    });
  });

  it("requires satisfied-elsewhere to carry both its pointer and its reason", () => {
    const full = {
      ...BASE,
      answeredByTs: "1790926498.645000",
      kind: "satisfied-elsewhere",
      reason: "a person replied",
    };
    const { answeredByTs: _pointer, ...noPointer } = full;

    expect(decodeAskLifecycleEvent({ value: full })).toEqual(full);
    expect(decodeAskLifecycleEvent({ value: noPointer })).toBeUndefined();
  });

  it("decodes checklist-posted and refuses it without workingTs", () => {
    const posted = { ...BASE, kind: "checklist-posted", turnId: "t-1", workingTs: "1790924300.000100" };
    const { workingTs: _dropped, ...noTs } = posted;

    expect(decodeAskLifecycleEvent({ value: posted })).toEqual(posted);
    expect(decodeAskLifecycleEvent({ value: noTs })).toBeUndefined();
  });

  it("decodes withheld with its three fields and refuses one short", () => {
    const withheld = { ...BASE, code: "WARN", kind: "withheld", queueId: "q1", reason: "held for review" };
    const { code: _dropped, ...noCode } = withheld;

    expect(decodeAskLifecycleEvent({ value: withheld })).toEqual(withheld);
    expect(decodeAskLifecycleEvent({ value: noCode })).toBeUndefined();
  });

  it("validates redispatched's strandedAs against the three stranded kinds", () => {
    const redispatched = { ...BASE, kind: "redispatched", reason: "picked up", strandedAs: "lease-expired" };

    expect(decodeAskLifecycleEvent({ value: redispatched })).toEqual(redispatched);
    expect(decodeAskLifecycleEvent({ value: { ...redispatched, strandedAs: "answered" } })).toBeUndefined();
  });

  it("validates blocked-on-human's need against the closed set and keeps an optional tagTs", () => {
    const blocked = {
      ...BASE,
      kind: "blocked-on-human",
      need: "sign-in",
      stepText: "sign in",
      tagTs: "1.2",
      what: "a",
    };

    expect(decodeAskLifecycleEvent({ value: blocked })).toEqual(blocked);
    expect(decodeAskLifecycleEvent({ value: { ...blocked, need: "vibes" } })).toBeUndefined();
  });

  it("keeps a sign-in block's bare HTTPS origin, and refuses one on another need or anything but an origin", () => {
    const blocked = {
      ...BASE,
      kind: "blocked-on-human",
      need: "sign-in",
      signInOrigin: "https://admin.google.com",
      stepText: "log in",
      what: "a",
    };

    expect(decodeAskLifecycleEvent({ value: blocked })).toEqual(blocked);
    expect(decodeAskLifecycleEvent({ value: { ...blocked, need: "other" } })).toBeUndefined();
    expect(
      decodeAskLifecycleEvent({ value: { ...blocked, signInOrigin: "https://admin.google.com/ac" } }),
    ).toBeUndefined();
    expect(decodeAskLifecycleEvent({ value: { ...blocked, signInOrigin: "http://admin.google.com" } })).toBeUndefined();
    expect(decodeAskLifecycleEvent({ value: { ...blocked, signInOrigin: 7 } })).toBeUndefined();
  });

  it("decodes unblocked with its lifted block and refuses a malformed one", () => {
    const unblocked = { ...BASE, kind: "unblocked", lifted: { need: "other", what: "approval" }, note: "done" };

    expect(decodeAskLifecycleEvent({ value: unblocked })).toEqual(unblocked);
    expect(decodeAskLifecycleEvent({ value: { ...unblocked, lifted: "approval" } })).toBeUndefined();
  });

  it("decodes dispatched with a valid decision and refuses an unknown tier", () => {
    const decision = {
      confidence: "high",
      needs: [],
      rationale: "worth answering",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    };
    const dispatched = {
      ...BASE,
      decision,
      kind: "dispatched",
      leaseExpiresAt: "2026-10-02T08:59:55.295Z",
      tier: "fresh-visible-session",
    };

    expect(decodeAskLifecycleEvent({ value: dispatched })).toEqual(dispatched);
    expect(decodeAskLifecycleEvent({ value: { ...dispatched, tier: "headless" } })).toBeUndefined();
  });
});

describe("decodeAskLifecycleEvent — a dispatched row written before truthMode existed", () => {
  // The decision exactly as the live log's refused rows carry it: every field but `truthMode`.
  const PRE_TRUTH_MODE = {
    ...BASE,
    decision: {
      confidence: "high",
      needs: [],
      rationale: "a casual greeting in a 1:1 DM — no investigation needed",
      response: "respond",
      schemaVersion: 1,
      tier: "inline",
    },
    kind: "dispatched",
    leaseExpiresAt: "2026-08-12T23:18:38.532Z",
    tier: "inline",
  };

  // `toStrictEqual`, not `toEqual`: only the strict form fails on a `truthMode: undefined` key, so a decoder that
  // invented the field — even as `undefined` — reddens here.
  it("decodes it exactly as recorded, with no truthMode supplied for it", () => {
    expect(decodeAskLifecycleEvent({ value: PRE_TRUTH_MODE })).toStrictEqual(PRE_TRUTH_MODE);
  });

  it("still refuses a truthMode that is present but outside the closed set", () => {
    const value = { ...PRE_TRUTH_MODE, decision: { ...PRE_TRUTH_MODE.decision, truthMode: "vibes" } };

    expect(decodeAskLifecycleEvent({ value })).toBeUndefined();
  });

  it("still refuses a decision carrying a field the strict schema does not declare", () => {
    const value = { ...PRE_TRUTH_MODE, decision: { ...PRE_TRUTH_MODE.decision, guessedTruth: "current" } };

    expect(decodeAskLifecycleEvent({ value })).toBeUndefined();
  });
});
