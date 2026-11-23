/**
 * The two who-it-reaches holds `slack draft record` weighs before it parks, called directly: each reads only once
 * its own rule applies. A read that must not happen is a fake that throws, so a stray read fails the case. The
 * refusals themselves are driven end to end through `runSlackDraftWithDeps` in `./draftVerb/`.
 */
import { describe, expect, it } from "vitest";

import type { DraftRecordOptions } from "../../../../../cli/commands/slack/draftCore.js";
import {
  asMeIdentity,
  samePersonDayHold,
  whoItReachesHolds,
} from "../../../../../cli/commands/slack/draftRecordHolds.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";

const REVIEW_ASK: DraftRecordOptions = {
  act: "review-ask",
  actor: "me",
  askedBefore: { kind: "none" },
  channel: "U0JASPER",
  formSource: "{}",
  home: "/home",
  json: false,
  media: [],
  mode: "record",
  receipts: { kind: "undeclared" },
  supersedes: [],
  why: "a review ask under test",
};

const PAYLOAD: SlackDripMessagePayload = {
  form: "plain",
  text: "hey, could I grab a review on <https://github.com/acme/acme-admin/pull/18249|#18249>",
  unfurl_links: false,
  unfurl_media: false,
};

/** A read the case under test must never reach. */
function unreachable(): never {
  throw new Error("a hold read something its rule does not need");
}

const NO_READS = { conversationInfo: unreachable, nowIso: unreachable, readLog: unreachable };

describe("samePersonDayHold — one batch per person per day, read only when it applies", () => {
  it("reads nothing for a thread reply", async () => {
    const lines = await samePersonDayHold({
      deps: NO_READS,
      options: { ...REVIEW_ASK, threadTs: "1790914484.452979" },
      payload: PAYLOAD,
      readInfo: unreachable,
      token: "xoxp-test",
    });
    expect(lines).toEqual([]);
  });

  it("reads nothing for a recording that is not a review ask", async () => {
    const { act: _act, ...noAct } = REVIEW_ASK;
    const lines = await samePersonDayHold({
      deps: NO_READS,
      options: noAct,
      payload: PAYLOAD,
      readInfo: unreachable,
      token: "xoxp-test",
    });
    expect(lines).toEqual([]);
  });

  it("applies nothing, and reads no register, when Slack cannot say whose D… conversation it is", async () => {
    const lines = await samePersonDayHold({
      deps: NO_READS,
      options: { ...REVIEW_ASK, channel: "D0JASPER" },
      payload: PAYLOAD,
      readInfo: async () => ({ name: undefined, surface: "direct-message" }),
      token: "xoxp-test",
    });
    expect(lines).toEqual([]);
  });

  it("parks the first ask to a person on an empty register", async () => {
    const lines = await samePersonDayHold({
      deps: { conversationInfo: unreachable, nowIso: () => "2026-10-02T06:43:00.000Z", readLog: () => [] },
      options: REVIEW_ASK,
      payload: PAYLOAD,
      readInfo: unreachable,
      token: "xoxp-test",
    });
    expect(lines).toEqual([]);
  });
});

describe("whoItReachesHolds — every hold, the settled chase first", () => {
  it("refuses an ask on a closed pull request before the register is ever read", async () => {
    const identity = await whoItReachesHolds({
      deps: {
        botMembership: unreachable,
        botToken: unreachable,
        conversationInfo: unreachable,
        nowIso: unreachable,
        pullRequestState: async () => ({ kind: "settled", state: "CLOSED" }),
        readLog: unreachable,
      },
      options: REVIEW_ASK,
      payload: PAYLOAD,
      readInfo: unreachable,
      token: "xoxp-test",
    });
    expect(identity.isErr()).toBe(true);
    expect(unwrapErr(identity)[0]).toContain(
      "this review-ask links https://github.com/acme/acme-admin/pull/18249, which GitHub says is already closed",
    );
  });

  it("refuses a second single before the finding identity is ever asked", async () => {
    const sentToday = slackDraftEventLine({
      event: {
        draft: {
          act: "review-ask",
          advisory: [],
          channel: "U0JASPER",
          digest: "digest-sd-11112222",
          form: "{}",
          id: "sd-11112222",
          mentions: [],
          payload: PAYLOAD,
          shape: "top-level",
          tsIso: "2026-10-02T03:20:00.000Z",
          why: "the first ask today",
        },
        id: "sd-11112222",
        kind: "parked",
        tsIso: "2026-10-02T03:20:00.000Z",
      },
    });
    const released = slackDraftEventLine({
      event: {
        channel: "U0JASPER",
        id: "sd-11112222",
        kind: "released",
        ts: "1790914484.452979",
        tsIso: "2026-10-02T03:22:43.000Z",
      },
    });
    const identity = await whoItReachesHolds({
      deps: {
        botMembership: unreachable,
        botToken: unreachable,
        conversationInfo: unreachable,
        nowIso: () => "2026-10-02T06:43:00.000Z",
        pullRequestState: async () => ({ kind: "open" }),
        readLog: () => [sentToday, released],
      },
      options: REVIEW_ASK,
      payload: PAYLOAD,
      readInfo: unreachable,
      token: "xoxp-test",
    });
    expect(identity.isErr()).toBe(true);
    expect(unwrapErr(identity)[0]).toContain("REFUSING a single review ask to U0JASPER — sd-11112222 already went");
  });
});

describe("asMeIdentity — a finding as the owner only where the bot cannot post", () => {
  it("reads nothing for a DM recording that declares no kind", async () => {
    const identity = await asMeIdentity({
      deps: { botMembership: unreachable, botToken: unreachable },
      options: REVIEW_ASK,
      readSurface: unreachable,
    });
    expect(identity.isOk()).toBe(true);
    expect(unwrap(identity)).toBeUndefined();
  });
});
