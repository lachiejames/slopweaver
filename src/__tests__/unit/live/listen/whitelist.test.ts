/**
 * The pure decision: exact membership, fail-closed by default, and the one named break-glass. No socket,
 * no filesystem — see `whitelistStore.test.ts` for the effectful edge.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  admitResponder,
  ownerWaitText,
  parseResponderWhitelist,
  type ResponderWhitelist,
  responderRefusalText,
  whitelistSummary,
} from "../../../../live/listen/whitelist.js";

const LIST: ResponderWhitelist = { identities: ["U0OWNER", "U0BOT"], kind: "list" };
const ABSENT: ResponderWhitelist = { kind: "absent" };
const EMPTY: ResponderWhitelist = { identities: [], kind: "list" };
const UNREADABLE: ResponderWhitelist = { kind: "unreadable", why: "responders.json is not valid JSON" };

describe("parseResponderWhitelist", () => {
  it("accepts a well-formed array of ids", () => {
    expect(unwrap(parseResponderWhitelist({ value: ["U0OWNER", "U0BOT"] }))).toEqual(["U0OWNER", "U0BOT"]);
  });

  it("collapses duplicates, preserving first-seen order", () => {
    expect(unwrap(parseResponderWhitelist({ value: ["U0OWNER", "U0BOT", "U0OWNER"] }))).toEqual(["U0OWNER", "U0BOT"]);
  });

  it("accepts an empty array", () => {
    expect(unwrap(parseResponderWhitelist({ value: [] }))).toEqual([]);
  });

  it("refuses a non-array value", () => {
    expect(unwrapErr(parseResponderWhitelist({ value: { U0OWNER: true } }))).toEqual([
      "responders.json must be a JSON array of Slack user id strings",
    ]);
  });

  it("refuses a non-string entry", () => {
    expect(unwrapErr(parseResponderWhitelist({ value: ["U0OWNER", 123] }))).toEqual([
      "responders.json must be a JSON array of Slack user id strings",
    ]);
  });

  it("refuses an entry containing whitespace", () => {
    expect(unwrapErr(parseResponderWhitelist({ value: ["U0 OWNER"] }))).toEqual([
      "every entry in responders.json must be a non-empty Slack user id with no whitespace",
    ]);
  });

  it("refuses an empty-string entry", () => {
    expect(unwrapErr(parseResponderWhitelist({ value: [""] }))).toEqual([
      "every entry in responders.json must be a non-empty Slack user id with no whitespace",
    ]);
  });
});

describe("admitResponder", () => {
  it("admits an exact member", () => {
    expect(admitResponder({ openOverride: false, userId: "U0OWNER", whitelist: LIST })).toEqual({
      admitted: true,
    });
  });

  it("refuses a case-variant of a member — exact match only", () => {
    const decision = admitResponder({ openOverride: false, userId: "u0owner", whitelist: LIST });
    expect(decision.admitted).toBe(false);
  });

  it("refuses a nonmember, naming the count", () => {
    const decision = admitResponder({ openOverride: false, userId: "U0OTHER", whitelist: LIST });
    expect(decision).toEqual({
      admitted: false,
      why: "`U0OTHER` is not on the responder whitelist (2 configured identities)",
    });
  });

  it("refuses everyone, including a member, when the list is absent", () => {
    const decision = admitResponder({ openOverride: false, userId: "U0OWNER", whitelist: ABSENT });
    expect(decision).toEqual({
      admitted: false,
      why: "responders.json is absent under $SLOPWEAVER_HOME — refusing every identity",
    });
  });

  it("refuses everyone when the list is empty", () => {
    const decision = admitResponder({ openOverride: false, userId: "U0OWNER", whitelist: EMPTY });
    expect(decision).toEqual({
      admitted: false,
      why: "the responder whitelist is empty — refusing every identity",
    });
  });

  it("refuses everyone when the list is unreadable", () => {
    const decision = admitResponder({ openOverride: false, userId: "U0OWNER", whitelist: UNREADABLE });
    expect(decision).toEqual({
      admitted: false,
      why: "the responder whitelist could not be read (responders.json is not valid JSON) — refusing every identity",
    });
  });

  it("admits a nonmember via the break-glass override, flagging that it did", () => {
    expect(admitResponder({ openOverride: true, userId: "U0OTHER", whitelist: LIST })).toEqual({
      admitted: true,
      openOverride: true,
    });
  });

  it("admits everyone via the break-glass override when the list is absent", () => {
    expect(admitResponder({ openOverride: true, userId: "U0OTHER", whitelist: ABSENT })).toEqual({
      admitted: true,
      openOverride: true,
    });
  });

  it("does not flag an ordinary member admission as an override, even when the override is set", () => {
    expect(admitResponder({ openOverride: true, userId: "U0OWNER", whitelist: LIST })).toEqual({
      admitted: true,
    });
  });
});

describe("whitelistSummary", () => {
  it("states the plural count for two or more identities", () => {
    expect(whitelistSummary({ openOverride: false, whitelist: LIST })).toBe(
      "2 identities are whitelisted to command the bot",
    );
  });

  it("states the singular count for exactly one identity", () => {
    expect(whitelistSummary({ openOverride: false, whitelist: { identities: ["U0OWNER"], kind: "list" } })).toBe(
      "1 identity is whitelisted to command the bot",
    );
  });

  it("states ABSENT, never an identity", () => {
    expect(whitelistSummary({ openOverride: false, whitelist: ABSENT })).toBe(
      "the responder whitelist is ABSENT — every identity is refused",
    );
  });

  it("states EMPTY, never an identity", () => {
    expect(whitelistSummary({ openOverride: false, whitelist: EMPTY })).toBe(
      "the responder whitelist is EMPTY — every identity is refused",
    );
  });

  it("states UNREADABLE with the reason, never an identity", () => {
    expect(whitelistSummary({ openOverride: false, whitelist: UNREADABLE })).toBe(
      "the responder whitelist is UNREADABLE (responders.json is not valid JSON) — every identity is refused",
    );
  });

  it("names the break-glass override when it is active, even over a healthy list", () => {
    expect(whitelistSummary({ openOverride: true, whitelist: LIST })).toBe(
      "2 identities are whitelisted to command the bot — the responder-allow-open grant is OPEN for this session, so every identity is admitted regardless",
    );
  });

  it("names the break-glass override over an absent list", () => {
    expect(whitelistSummary({ openOverride: true, whitelist: ABSENT })).toBe(
      "the responder whitelist is ABSENT — every identity is refused — the responder-allow-open grant is OPEN for this session, so every identity is admitted regardless",
    );
  });
});

describe("responderRefusalText", () => {
  it("waits on the owner by exact tag over a populated list, in the owner's own words", () => {
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: "U0OWNER", whitelist: LIST })).toBe(
      "hey! <@U0OWNER> hasn't made a general ruling on this yet, bringing them in to approve this one.",
    );
  });

  it("waits on an unresolved owner rather than posting a broken mention", () => {
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: null, whitelist: LIST })).toBe(
      "hey! its owner hasn't made a general ruling on this yet, so this one waits on their approval.",
    );
  });

  it("is never a refusal over a populated list — rulings 21 and 22 retired the allow-list copy", () => {
    for (const ownerUserId of ["U0OWNER", null]) {
      const text = responderRefusalText({ botLabel: "the bot", ownerUserId, whitelist: LIST });
      expect(text).not.toContain("allow-list");
      expect(text).not.toContain("not on it");
      expect(text).not.toContain("can add you");
    }
  });

  it("treats an owner id not shaped like a Slack user id as unresolved, never posting a mention that tags nobody", () => {
    for (const ownerUserId of ["", "  ", "U0 OWNER", "ada", "<!channel>", "u0owner", "C0SYNCHANNEL", "U_", "U_OWNER"]) {
      expect(responderRefusalText({ botLabel: "the bot", ownerUserId, whitelist: LIST })).toBe(
        "hey! its owner hasn't made a general ruling on this yet, so this one waits on their approval.",
      );
      expect(responderRefusalText({ botLabel: "the bot", ownerUserId, whitelist: ABSENT })).toBe(
        "hey! the bot isn't answering anyone right now. its owner can add you, just ask them.",
      );
    }
  });

  it("is ownerWaitText's line over a populated list", () => {
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: "U0OWNER", whitelist: LIST })).toBe(
      ownerWaitText({ ownerUserId: "U0OWNER" }),
    );
  });

  it("says nobody, never a false 'you're not on it', when the gate is closed with no identities at all", () => {
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: "U0OWNER", whitelist: ABSENT })).toBe(
      "hey! the bot isn't answering anyone right now. <@U0OWNER> can add you, just ask them.",
    );
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: "U0OWNER", whitelist: EMPTY })).toBe(
      "hey! the bot isn't answering anyone right now. <@U0OWNER> can add you, just ask them.",
    );
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: "U0OWNER", whitelist: UNREADABLE })).toBe(
      "hey! the bot isn't answering anyone right now. <@U0OWNER> can add you, just ask them.",
    );
  });

  it("says nobody AND keeps the unresolved-owner phrase when the gate is closed and the id does not resolve", () => {
    expect(responderRefusalText({ botLabel: "the bot", ownerUserId: null, whitelist: ABSENT })).toBe(
      "hey! the bot isn't answering anyone right now. its owner can add you, just ask them.",
    );
  });

  it("reads as a door, never a telling-off — a refused colleague once called the old copy rude", () => {
    for (const whitelist of [LIST, ABSENT, EMPTY, UNREADABLE]) {
      for (const ownerUserId of ["U0OWNER", null]) {
        const text = responderRefusalText({ botLabel: "the bot", ownerUserId, whitelist });
        expect(text).not.toContain("taking direction");
        expect(text).not.toContain("flagged");
        expect(text).not.toContain("—");
      }
    }
  });

  it("keeps a closed gate's copy to two short sentences", () => {
    for (const whitelist of [ABSENT, EMPTY, UNREADABLE]) {
      expect(responderRefusalText({ botLabel: "the bot", ownerUserId: "U0OWNER", whitelist }).split(". ").length).toBe(
        2,
      );
    }
  });

  it("never contains the refusal reason or the whitelist's size, even for the empty/absent states", () => {
    for (const whitelist of [LIST, ABSENT, EMPTY, UNREADABLE]) {
      for (const ownerUserId of ["U0OWNER", null]) {
        const text = responderRefusalText({ botLabel: "the bot", ownerUserId, whitelist });
        expect(text).not.toContain("configured identities");
      }
    }
  });
});
