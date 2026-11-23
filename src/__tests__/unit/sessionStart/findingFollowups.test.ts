/**
 * Whether a shared finding comes back to the owner: a full business day of team silence, an untimed acknowledgement with
 * nothing after it for a full business day, or a claimed fix — and the lexical tests behind the last two.
 */
import { describe, expect, it } from "vitest";

import { BUSINESS_DAY_MS } from "../../../review/businessTime.js";
import {
  acknowledgementKindOf,
  type FindingThreadMessage,
  findingFollowupVerdictOf,
  isFixedClaim,
} from "../../../sessionStart/findingFollowups.js";

/** A Wednesday, 11:00 Melbourne time (AEDT, UTC+11). */
const POSTED = "2026-10-14T00:00:00.000Z";
const FINDING_TS = "1792000000.000100";
const HOUR_MS = 60 * 60 * 1000;

/** One message in the finding's thread. */
function message({
  ts,
  tsIso,
  role,
  text,
}: {
  ts: string;
  tsIso: string;
  role: FindingThreadMessage["role"];
  text: string;
}): FindingThreadMessage {
  return { authorId: `U0${role.toUpperCase()}`, permalink: `https://example.slack.com/p${ts}`, role, text, ts, tsIso };
}

/** The verdict for `messages` at `nowIso`. */
function verdict({ messages, nowIso }: { messages: readonly FindingThreadMessage[]; nowIso: string }) {
  return findingFollowupVerdictOf({ messageTs: FINDING_TS, messages, nowIso, postedAtIso: POSTED });
}

describe("findingFollowupVerdictOf — nobody from the team replied", () => {
  it("holds the first business day and comes back at a full one", () => {
    expect(verdict({ messages: [], nowIso: "2026-10-14T23:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      reason: "inside-first-day",
    });
    expect(verdict({ messages: [], nowIso: "2026-10-15T00:00:00.000Z" })).toStrictEqual({
      businessMs: BUSINESS_DAY_MS,
      kind: "quiet",
    });
  });

  it("does not count a Melbourne weekend as working time", () => {
    const friday = "2026-10-16T00:00:00.000Z";
    const run = ({ nowIso }: { nowIso: string }) =>
      findingFollowupVerdictOf({ messageTs: FINDING_TS, messages: [], nowIso, postedAtIso: friday });
    expect(run({ nowIso: "2026-10-18T12:00:00.000Z" })).toStrictEqual({ kind: "in-hand", reason: "inside-first-day" });
    expect(run({ nowIso: "2026-10-19T00:00:00.000Z" })).toStrictEqual({ businessMs: BUSINESS_DAY_MS, kind: "quiet" });
  });

  it("reads a bot's word, and the finding itself, as no reply", () => {
    const messages = [
      message({ role: "other", text: "on it, fixed", ts: "1792000100.000100", tsIso: "2026-10-14T01:00:00.000Z" }),
      message({ role: "person", text: "deployed the fix", ts: FINDING_TS, tsIso: POSTED }),
    ];
    expect(verdict({ messages, nowIso: "2026-10-15T00:00:00.000Z" })).toStrictEqual({
      businessMs: BUSINESS_DAY_MS,
      kind: "quiet",
    });
  });

  it("answers undated when the post's instant does not parse", () => {
    expect(
      findingFollowupVerdictOf({
        messageTs: FINDING_TS,
        messages: [],
        nowIso: "2026-10-15T00:00:00.000Z",
        postedAtIso: "",
      }),
    ).toStrictEqual({ kind: "in-hand", reason: "undated" });
  });
});

describe("findingFollowupVerdictOf — the team replied", () => {
  const ack = message({
    role: "person",
    text: "<@U0OWNER> thanks, looking into it",
    ts: "1792000100.000100",
    tsIso: "2026-10-14T02:00:00.000Z",
  });

  it("brings back an untimed acknowledgement a full business day after it, and not before", () => {
    expect(verdict({ messages: [ack], nowIso: "2026-10-15T01:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      latest: ack,
      reason: "inside-first-day",
    });
    expect(verdict({ messages: [ack], nowIso: "2026-10-15T04:00:00.000Z" })).toStrictEqual({
      acknowledgement: ack,
      businessMs: BUSINESS_DAY_MS + 2 * HOUR_MS,
      kind: "stalled",
    });
  });

  it("holds a timed promise, and a real answer, however long ago", () => {
    const timed = { ...ack, text: "looking into it, will update by eod" };
    const answer = { ...ack, text: "yeah that's the nightly sync, it retries" };
    expect(verdict({ messages: [timed], nowIso: "2026-10-20T00:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      latest: timed,
      reason: "timed-promise",
    });
    expect(verdict({ messages: [answer], nowIso: "2026-10-20T00:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      latest: answer,
      reason: "answered",
    });
  });

  it("reads only the team's LATEST word: an update after an acknowledgement is an answer", () => {
    const update = message({
      role: "person",
      text: "it's the third-party provider token expiring, rotating it",
      ts: "1792000200.000100",
      tsIso: "2026-10-14T03:00:00.000Z",
    });
    expect(verdict({ messages: [update, ack], nowIso: "2026-10-20T00:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      latest: update,
      reason: "answered",
    });
  });

  it("leaves a thread where the owner spoke after the team's last word to `slack awaiting`", () => {
    const ownerWord = message({
      role: "owner",
      text: "any update?",
      ts: "1792000300.000100",
      tsIso: "2026-10-14T04:00:00.000Z",
    });
    expect(verdict({ messages: [ack, ownerWord], nowIso: "2026-10-20T00:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      latest: ownerWord,
      reason: "owner-spoke",
    });
    expect(verdict({ messages: [ownerWord], nowIso: "2026-10-20T00:00:00.000Z" })).toStrictEqual({
      kind: "in-hand",
      latest: ownerWord,
      reason: "owner-spoke",
    });
  });

  it("brings a claimed fix back at once, even inside the first day and after the owner's own word", () => {
    const ownerWord = message({
      role: "owner",
      text: "any update?",
      ts: "1792000150.000100",
      tsIso: "2026-10-14T03:00:00.000Z",
    });
    const fixed = message({
      role: "person",
      text: "fixed, deploying after lunch",
      ts: "1792000200.000100",
      tsIso: "2026-10-14T04:00:00.000Z",
    });
    expect(verdict({ messages: [ack, ownerWord, fixed], nowIso: "2026-10-14T05:00:00.000Z" })).toStrictEqual({
      claim: fixed,
      kind: "claimed-fixed",
    });
  });

  it("keeps a claimed fix ahead of the owner's own later thanks, which checks nothing (deliberate)", () => {
    const fixed = message({
      role: "person",
      text: "fixed",
      ts: "1792000100.000100",
      tsIso: "2026-10-14T02:00:00.000Z",
    });
    const thanks = message({
      role: "owner",
      text: "thanks",
      ts: "1792000200.000100",
      tsIso: "2026-10-14T03:00:00.000Z",
    });
    expect(verdict({ messages: [fixed, thanks], nowIso: "2026-10-14T05:00:00.000Z" })).toStrictEqual({
      claim: fixed,
      kind: "claimed-fixed",
    });
  });
});

describe("acknowledgementKindOf", () => {
  it.each([
    ["looking into it", "untimed"],
    ["thanks <@U0OWNER>, taking a look", "untimed"],
    ["on it", "untimed"],
    ["Will check and get back to you", "untimed"],
    ["I’ll check it out soon", "untimed"],
    ["looking into it today", "timed"],
    ["will take a look tomorrow morning", "timed"],
    ["investigating, update by 3pm", "timed"],
    ["digging into it, back in 2 hours", "timed"],
    ["will check after standup", "timed"],
  ] as const)("reads %j as %s", (text, kind) => {
    expect(acknowledgementKindOf({ text })).toBe(kind);
  });

  it.each([
    "looking into it — which env did you see this on?",
    "looking into it, looks like the token expired",
    "yep, known issue",
    "looking into it now and I think the problem might sit in how the sync job pages through the site list overnight",
    "`looking into it`",
  ])("does not read %j as an acknowledgement", (text) => {
    expect(acknowledgementKindOf({ text })).toBe(undefined);
  });
});

describe("isFixedClaim", () => {
  it.each([
    "fixed",
    "Fixed, deploying after lunch",
    "this is resolved now",
    "all sorted",
    "hotfix deployed to prod",
    "merged the fix in <https://github.com/org/repo/pull/12|#12>",
    "fix is live",
    "should be fixed now",
    "should now be working",
    "thanks for flagging! fixed.",
  ])("reads %j as a claim", (text) => {
    expect(isFixedClaim({ text })).toBe(true);
  });

  it.each([
    "not fixed yet",
    "will be fixed tomorrow",
    "should be fixed once the deploy goes out",
    "once it's resolved I'll let you know",
    "is this fixed?",
    "hasn't been patched",
    "I don't think it's resolved",
    "not sure if it's fixed",
    "`fixed`",
    "looking into it",
  ])("does not read %j as a claim", (text) => {
    expect(isFixedClaim({ text })).toBe(false);
  });
});
