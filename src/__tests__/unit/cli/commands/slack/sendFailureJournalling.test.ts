/*
 * Which as-me drip is journalled as a failed send: one of which this run landed nothing. And which release that could
 * not reach Slack is held `slack-refused`, so the owner's Queue card says why their yes did not go out.
 */
import { describe, expect, it } from "vitest";

import type { SlackDraftReleaseOptions } from "../../../../../cli/commands/slack/coreTypes.js";
import {
  firstFailureOfUnsentDrip,
  holdTokenlessRelease,
} from "../../../../../cli/commands/slack/sendFailureJournalling.js";
import { ok } from "../../../../../lib/result.js";
import type { SlackDraftEvent } from "../../../../../outbound/slack/draftRegister.js";

describe("holdTokenlessRelease", () => {
  const OPTIONS: SlackDraftReleaseOptions = {
    actor: "me",
    dryRun: false,
    home: "/tmp/no-home",
    json: false,
    release: { approve: "0123456789abcdef0123456789abcdef", draftId: "sd-c57b4ade" },
    resendUnconfirmed: false,
    verb: "reply",
  };
  const TARGET = { channel: "C0123456789", threadTs: "1790000000.000100" };

  /** Every hold appended, its clock-read instant set aside. */
  const holds = ({
    options,
    target,
  }: {
    options: SlackDraftReleaseOptions;
    target: typeof TARGET | undefined;
  }): readonly Omit<SlackDraftEvent, "tsIso">[] => {
    const appended: SlackDraftEvent[] = [];
    holdTokenlessRelease({
      deps: {
        appendDraftEvent: ({ event }) => {
          appended.push(event);
          return ok(true as const);
        },
      },
      options,
      target,
      why: "no user token in $SLOPWEAVER_HOME/secrets",
    });
    return appended.map(({ tsIso: _tsIso, ...event }) => event);
  };

  it("holds a still-held row slack-refused, naming the token", () => {
    expect(holds({ options: OPTIONS, target: TARGET })).toEqual([
      {
        id: "sd-c57b4ade",
        kind: "held",
        reason: "slack-refused",
        why: "no Slack token the send could go out under: no user token in $SLOPWEAVER_HOME/secrets",
      },
    ]);
  });

  it("holds nothing on a dry run or for a row that is no longer held", () => {
    expect([
      holds({ options: { ...OPTIONS, dryRun: true }, target: TARGET }),
      holds({ options: OPTIONS, target: undefined }),
    ]).toEqual([[], []]);
  });
});

describe("firstFailureOfUnsentDrip", () => {
  it("is the first failure's words when nothing landed", () => {
    expect(
      firstFailureOfUnsentDrip({
        outcomes: [
          { error: "channel_not_found", index: 0, state: "failed" },
          { index: 1, reason: "earlier-failure", state: "not-attempted" },
        ],
      }),
    ).toBe("channel_not_found");
  });

  it("names a retry held back by an earlier unconfirmed reservation, which this run did not send", () => {
    expect(
      firstFailureOfUnsentDrip({
        outcomes: [
          { index: 0, reservedIso: "2026-10-07T05:53:00.000Z", state: "unconfirmed" },
          { index: 1, reason: "unconfirmed-prior", state: "not-attempted" },
        ],
      }),
    ).toBe(
      "not sent: an earlier attempt reserved this message at 2026-10-07T05:53:00.000Z and never confirmed it, so it " +
        "was held back rather than risk posting it twice",
    );
  });

  it("names a resumed drip's failure when only an earlier run's message is in Slack", () => {
    expect(
      firstFailureOfUnsentDrip({
        outcomes: [
          { index: 0, state: "already-sent", ts: "1791351500.000100" },
          { error: "channel_not_found", index: 1, state: "failed" },
        ],
      }),
    ).toBe("channel_not_found");
  });

  it("says a drip an earlier run already sent whole was not posted again", () => {
    expect(firstFailureOfUnsentDrip({ outcomes: [{ index: 0, state: "already-sent", ts: "1791351500.000100" }] })).toBe(
      "not sent again: this exact message is already in Slack from an earlier send, so it was not posted twice",
    );
  });

  it("is nothing once this run lands a message, and nothing when no message had a fate", () => {
    const failed = { error: "rate_limited", index: 1, state: "failed" } as const;
    expect([
      firstFailureOfUnsentDrip({
        outcomes: [{ fileIds: [], index: 0, state: "sent", ts: "1791351500.000100" }, failed],
      }),
      firstFailureOfUnsentDrip({ outcomes: [{ index: 0, reason: "unconfirmed-prior", state: "not-attempted" }] }),
      firstFailureOfUnsentDrip({ outcomes: [] }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
