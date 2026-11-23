import { describe, expect, it } from "vitest";

import { FINDING_KIND } from "../../../../outbound/artifact/finding.js";
import {
  fleetTopLevelPostsWithin,
  HIGH_STAKES_WINDOW_MS,
  highStakesChannelOf,
  secondPostRefusal,
  threadAnchorOf,
  topLevelPostsOf,
  undefendedPostRefusal,
} from "../../../../outbound/slack/highStakesChannel.js";

const BUGS = { id: "C0SYN000003", name: "#defects" };
const CHANNELS = [BUGS, { id: "C0SYN000023", name: "#urgent-defects" }];
const WORKSPACE = "https://example.slack.com/";
// A fixed instant inside the day the window covers.
const NOW_MS = Date.UTC(2026, 8, 28, 18, 30, 0);

/** A Slack `ts` for an instant `hoursAgo` before {@link NOW_MS}. */
function tsHoursAgo({ hoursAgo }: { hoursAgo: number }): string {
  return `${String(Math.floor((NOW_MS - hoursAgo * 3_600_000) / 1000))}.000100`;
}

describe("topLevelPostsOf", () => {
  it.each([
    { expected: 3, messageCount: 3, shape: "top-level" as const },
    { expected: 1, messageCount: 3, shape: "thread" as const },
    { expected: 1, messageCount: 1, shape: "top-level" as const },
  ])("counts $expected top-level posts for $messageCount $shape message(s)", ({ expected, messageCount, shape }) => {
    expect(topLevelPostsOf({ messageCount, shape })).toBe(expected);
  });
});

describe("highStakesChannelOf", () => {
  it("matches the channel by id, by name, and by name with its #", () => {
    expect(highStakesChannelOf({ channel: "C0SYN000003", channels: CHANNELS })).toEqual(BUGS);
    expect(highStakesChannelOf({ channel: "defects", channels: CHANNELS })).toEqual(BUGS);
    expect(highStakesChannelOf({ channel: "#defects", channels: CHANNELS })).toEqual(BUGS);
  });

  it("answers undefined for a channel nobody named, and for an install that named none", () => {
    expect(highStakesChannelOf({ channel: "C0SYNAAAAAAAAA", channels: CHANNELS })).toBe(undefined);
    expect(highStakesChannelOf({ channel: "C0SYN000003", channels: [] })).toBe(undefined);
  });
});

describe("threadAnchorOf", () => {
  const PARENT_TS = "1790000000.000100";

  it("finds the exact top-level parent the reply names", () => {
    expect(threadAnchorOf({ rawMessages: [{ ts: PARENT_TS }], threadTs: PARENT_TS })).toEqual({ kind: "present" });
    expect(threadAnchorOf({ rawMessages: [{ thread_ts: PARENT_TS, ts: PARENT_TS }], threadTs: PARENT_TS })).toEqual({
      kind: "present",
    });
  });

  it("calls a nearest neighbour, a broadcast reply and an empty read absent", () => {
    expect(threadAnchorOf({ rawMessages: [{ ts: "1790000000.000099" }], threadTs: PARENT_TS })).toEqual({
      kind: "absent",
    });
    expect(
      threadAnchorOf({ rawMessages: [{ thread_ts: "1789999999.000001", ts: PARENT_TS }], threadTs: PARENT_TS }),
    ).toEqual({ kind: "absent" });
    expect(threadAnchorOf({ rawMessages: [], threadTs: PARENT_TS })).toEqual({ kind: "absent" });
  });
});

describe("undefendedPostRefusal", () => {
  it("refuses an as-me post, naming the channel, the finding form and the hatch", () => {
    const lines = undefendedPostRefusal({ allowUndefended: false, formKind: undefined, target: BUGS });
    expect(lines[0]).toContain("this is an as-me post to #defects");
    expect(lines.join(" ")).toContain('{"kind":"finding"}');
    expect(lines.join(" ")).toContain("slopweaver hatch open high-stakes-undefended");
    expect(lines.length).toBe(4);
  });

  it("refuses any other bot form, naming it", () => {
    expect(undefendedPostRefusal({ allowUndefended: false, formKind: "update", target: BUGS })[0]).toContain(
      "this is a `update` card to #defects",
    );
  });

  it("admits a finding card, an open hatch, and a send that is not gated", () => {
    expect(undefendedPostRefusal({ allowUndefended: false, formKind: FINDING_KIND, target: BUGS })).toEqual([]);
    expect(undefendedPostRefusal({ allowUndefended: true, formKind: undefined, target: BUGS })).toEqual([]);
    expect(undefendedPostRefusal({ allowUndefended: false, formKind: undefined, target: undefined })).toEqual([]);
  });
});

describe("secondPostRefusal", () => {
  const PRIOR = {
    permalink: "https://example.slack.com/archives/C0SYN000003/p1790603453723719",
    ts: "1790603453.723719",
  };

  it("refuses a second post, citing the latest earlier one", () => {
    const later = {
      permalink: "https://example.slack.com/archives/C0SYN000003/p1790604264247109",
      ts: "1790604264.247109",
    };
    const lines = secondPostRefusal({
      allowSecondPost: false,
      history: { kind: "read", priors: [PRIOR, later] },
      target: BUGS,
    });
    expect(lines[0]).toContain(`the fleet already posted at the top level of #defects at ${later.permalink}`);
    expect(lines.join(" ")).toContain("slopweaver hatch open high-stakes-second-post");
  });

  it("fails CLOSED on an unread history, carrying the reason", () => {
    const lines = secondPostRefusal({
      allowSecondPost: false,
      history: { kind: "unread", reason: "conversations.history: not_in_channel" },
      target: BUGS,
    });
    expect(lines[0]).toContain("could not be read (conversations.history: not_in_channel)");
  });

  it("admits the first post of the day, an open hatch, and a send that is not gated", () => {
    expect(secondPostRefusal({ allowSecondPost: false, history: { kind: "read", priors: [] }, target: BUGS })).toEqual(
      [],
    );
    expect(
      secondPostRefusal({ allowSecondPost: true, history: { kind: "read", priors: [PRIOR] }, target: BUGS }),
    ).toEqual([]);
    expect(
      secondPostRefusal({ allowSecondPost: false, history: { kind: "unread", reason: "x" }, target: undefined }),
    ).toEqual([]);
  });
});

describe("fleetTopLevelPostsWithin", () => {
  const FLEET = ["U0OWNER", "U0BOT"];

  it("keeps the fleet's own top-level posts inside the day, oldest first, with permalinks", () => {
    const newer = tsHoursAgo({ hoursAgo: 1 });
    const older = tsHoursAgo({ hoursAgo: 5 });
    const posts = fleetTopLevelPostsWithin({
      channel: "C0SYN000003",
      fleetUserIds: FLEET,
      nowMs: NOW_MS,
      rawMessages: [
        { ts: newer, user: "U0BOT" },
        { thread_ts: older, ts: older, user: "U0OWNER" },
      ],
      workspaceUrl: WORKSPACE,
    });
    expect(posts.map((post) => post.ts)).toEqual([older, newer]);
    expect(posts[0]!.permalink).toBe(`https://example.slack.com/archives/C0SYN000003/p${older.replace(".", "")}`);
  });

  it("drops a stranger's post, a reply broadcast into the channel, one outside the window, and junk", () => {
    const inside = tsHoursAgo({ hoursAgo: 2 });
    const outside = tsHoursAgo({ hoursAgo: HIGH_STAKES_WINDOW_MS / 3_600_000 + 1 });
    const posts = fleetTopLevelPostsWithin({
      channel: "C0SYN000003",
      fleetUserIds: FLEET,
      nowMs: NOW_MS,
      rawMessages: [
        { ts: inside, user: "U0SYNSTRANGER" },
        { thread_ts: tsHoursAgo({ hoursAgo: 3 }), ts: inside, user: "U0OWNER" },
        { ts: outside, user: "U0OWNER" },
        { user: "U0OWNER" },
        "not a message",
      ],
      workspaceUrl: WORKSPACE,
    });
    expect(posts).toEqual([]);
  });
});
