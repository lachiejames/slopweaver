import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { SlackNeighbourhoodErrors } from "../../../live/slack/neighbourhoodErrors.js";
import type { SlackSearchMatch } from "../../../live/slack/searchMessages.js";
import {
  historyCandidates,
  linkingCandidates,
  NEIGHBOURHOOD_CHANNEL_CAP,
  neighbourhoodAnchors,
  neighbourhoodChannels,
  threadsActiveInWindow,
  workspaceOfPermalink,
} from "../../../review/slackNeighbourhood.js";

/** One live search hit, with the fields a test cares about overridden. */
const match = (over: Partial<SlackSearchMatch> = {}): SlackSearchMatch => ({
  channelId: "C1",
  channelName: "dev-team",
  permalink: "https://acme.slack.com/archives/C1/p1787942086747699",
  text: "please review https://github.com/o/r/pull/1",
  ts: "1787942086.747699",
  tsIso: "2026-08-28T18:34:46.000Z",
  userId: "U1",
  ...over,
});

/** One raw `conversations.history` row. */
const row = (over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> => ({
  text: "hello",
  ts: "1787942086.747699",
  user: "U1",
  ...over,
});

describe("workspaceOfPermalink", () => {
  it("reads the origin the provider itself built the link on", () => {
    expect(workspaceOfPermalink({ permalink: "https://acme.slack.com/archives/C1/p1787942086747699" })).toBe(
      "https://acme.slack.com",
    );
  });

  it("answers empty for a link that names no archive, so nothing invents an origin", () => {
    expect(workspaceOfPermalink({ permalink: "https://acme.slack.com/team/U1" })).toBe("");
  });
});

describe("neighbourhoodAnchors", () => {
  it("anchors a top-level hit on its own timestamp", () => {
    const anchors = neighbourhoodAnchors({ matches: [match()] });
    expect(anchors).toEqual([
      {
        atIso: "2026-08-28T18:34:46.000Z",
        channelId: "C1",
        channelName: "dev-team",
        threadTs: "1787942086.747699",
        workspace: "https://acme.slack.com",
      },
    ]);
  });

  it("anchors a REPLY hit on the thread root only its permalink names", () => {
    const anchors = neighbourhoodAnchors({
      matches: [
        match({
          permalink: "https://acme.slack.com/archives/C1/p1787942086747699?thread_ts=1787900000.111111&cid=C1",
        }),
      ],
    });
    expect(anchors[0]!.threadTs).toBe("1787900000.111111");
  });

  it("drops a hit carrying no conversation id, which names nowhere to go and look", () => {
    expect(neighbourhoodAnchors({ matches: [match({ channelId: "" })] })).toEqual([]);
  });
});

describe("neighbourhoodChannels", () => {
  it("reads one conversation once however many hits named it, keeping the newest anchor", () => {
    const plan = neighbourhoodChannels({
      anchors: neighbourhoodAnchors({
        matches: [
          match({ ts: "1787942086.000001", tsIso: "2026-08-30T11:14:46.000Z" }),
          match({ ts: "1787999999.000002", tsIso: "2026-08-31T03:19:59.000Z" }),
        ],
      }),
      cap: NEIGHBOURHOOD_CHANNEL_CAP,
    });
    expect(plan.channels).toEqual([
      {
        channelId: "C1",
        channelName: "dev-team",
        newestAnchorIso: "2026-08-31T03:19:59.000Z",
        workspace: "https://acme.slack.com",
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("sheds the OLDEST evidence when the cap bites, and names what it shed", () => {
    const plan = neighbourhoodChannels({
      anchors: neighbourhoodAnchors({
        matches: [
          match({ channelId: "C1", channelName: "dev-team", tsIso: "2026-08-28T00:00:00.000Z" }),
          match({ channelId: "C2", channelName: "product", tsIso: "2026-08-31T00:00:00.000Z" }),
        ],
      }),
      cap: 1,
    });
    expect(plan.channels.map((channel) => channel.channelId)).toEqual(["C2"]);
    expect(plan.skipped).toEqual(["#dev-team"]);
  });

  it("keeps the origin from whichever hit could name one, even when the newest could not", () => {
    const plan = neighbourhoodChannels({
      anchors: neighbourhoodAnchors({
        matches: [
          match({ tsIso: "2026-08-28T00:00:00.000Z" }),
          match({ permalink: "https://acme.slack.com/team/U1", tsIso: "2026-08-31T00:00:00.000Z" }),
        ],
      }),
      cap: NEIGHBOURHOOD_CHANNEL_CAP,
    });
    expect(plan.channels[0]!.newestAnchorIso).toBe("2026-08-31T00:00:00.000Z");
    expect(plan.channels[0]!.workspace).toBe("https://acme.slack.com");
  });

  it("names a shed direct message as a direct message rather than as a channel", () => {
    const plan = neighbourhoodChannels({
      anchors: neighbourhoodAnchors({ matches: [match({ channelId: "D9", channelName: "U7" })] }),
      cap: 0,
    });
    expect(plan.channels).toEqual([]);
    expect(plan.skipped).toEqual(["dm:U7"]);
  });
});

describe("threadsActiveInWindow", () => {
  it("opens a thread whose newest reply lands inside the window", () => {
    const plan = threadsActiveInWindow({
      cap: 24,
      oldestTs: "1787900000.000000",
      rawMessages: [row({ latest_reply: "1787950000.000000", reply_count: 3, ts: "1787800000.000000" })],
    });
    expect(plan).toEqual({ exceededCap: false, roots: ["1787800000.000000"] });
  });

  it("leaves a thread whose replies are all older than the window alone", () => {
    const plan = threadsActiveInWindow({
      cap: 24,
      oldestTs: "1787900000.000000",
      rawMessages: [row({ latest_reply: "1787850000.000000", reply_count: 3, ts: "1787800000.000000" })],
    });
    expect(plan.roots).toEqual([]);
  });

  it("leaves a top-level message with no replies alone", () => {
    const plan = threadsActiveInWindow({
      cap: 24,
      oldestTs: "1787900000.000000",
      rawMessages: [row({ ts: "1787950000.000000" })],
    });
    expect(plan.roots).toEqual([]);
  });

  it("reports the cap exceeded, so the caller withholds the window rather than shortening it", () => {
    const plan = threadsActiveInWindow({
      cap: 1,
      oldestTs: "1787900000.000000",
      rawMessages: [
        row({ latest_reply: "1787950000.000000", reply_count: 1, ts: "1787910000.000000" }),
        row({ latest_reply: "1787960000.000000", reply_count: 1, ts: "1787920000.000000" }),
      ],
    });
    expect(plan.exceededCap).toBe(true);
    expect(plan.roots).toEqual(["1787910000.000000"]);
  });

  it("orders by the instant a timestamp names, not by the string, so a short fraction sorts correctly", () => {
    const plan = threadsActiveInWindow({
      cap: 24,
      oldestTs: "1787900000.000000",
      rawMessages: [row({ latest_reply: "1787900000.9", reply_count: 1, ts: "1787800000.000000" })],
    });
    expect(plan.roots).toEqual(["1787800000.000000"]);
  });
});

describe("linkingCandidates", () => {
  it("keeps only the messages whose own words reach some pull request", () => {
    const kept = linkingCandidates({
      candidates: [
        { ...match(), text: "morning all" },
        { ...match(), text: "please review https://github.com/o/r/pull/1" },
      ],
    });
    expect(kept.map((candidate) => candidate.text)).toEqual(["please review https://github.com/o/r/pull/1"]);
  });

  it("does not care WHICH pull request a survivor reaches, which stays the matcher's decision", () => {
    const kept = linkingCandidates({
      candidates: [{ ...match(), text: "https://github.com/someone/else/pull/999" }],
    });
    expect(kept.length).toBe(1);
  });
});

describe("historyCandidates", () => {
  it("carries the row's WHOLE text, so the exact matcher sees a link past any preview cut", () => {
    const long = `${"x".repeat(400)} https://github.com/o/r/pull/1`;
    const candidates = unwrap(
      historyCandidates({
        channelId: "C1",
        channelName: "dev-team",
        rawMessages: [row({ text: long })],
        workspace: "https://acme.slack.com",
      }),
    );
    expect(candidates[0]!.text).toBe(long);
  });

  it("builds Slack's own stable permalink for a neighbour the search never returned", () => {
    const candidates = unwrap(
      historyCandidates({
        channelId: "C1",
        channelName: "dev-team",
        rawMessages: [row()],
        workspace: "https://acme.slack.com",
      }),
    );
    expect(candidates[0]!.permalink).toBe("https://acme.slack.com/archives/C1/p1787942086747699");
    expect(candidates[0]!.tsIso).toBe("2026-08-28T18:34:46.000Z");
  });

  it("counts one message once when a thread walk returns a root the history walk already carried", () => {
    const candidates = unwrap(
      historyCandidates({
        channelId: "C1",
        channelName: "dev-team",
        rawMessages: [row(), row()],
        workspace: "https://acme.slack.com",
      }),
    );
    expect(candidates.length).toBe(1);
  });

  it("returns the messages oldest first", () => {
    const candidates = unwrap(
      historyCandidates({
        channelId: "C1",
        channelName: "dev-team",
        rawMessages: [row({ ts: "1787999999.000000" }), row({ ts: "1787900000.000000" })],
        workspace: "https://acme.slack.com",
      }),
    );
    expect(candidates.map((candidate) => candidate.ts)).toEqual(["1787900000.000000", "1787999999.000000"]);
  });

  it("reads an app row with no user id as an empty author rather than refusing it", () => {
    const candidates = unwrap(
      historyCandidates({
        channelId: "C1",
        channelName: "dev-team",
        rawMessages: [row({ bot_id: "B1", user: undefined })],
        workspace: "https://acme.slack.com",
      }),
    );
    expect(candidates[0]!.userId).toBe("");
  });

  it("REFUSES the whole set on a row that is not an object, because a dropped row is the one being hunted", () => {
    const refused = historyCandidates({
      channelId: "C1",
      channelName: "dev-team",
      rawMessages: [row(), "not a row"],
      workspace: "https://acme.slack.com",
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("MALFORMED_ROW");
  });

  it("REFUSES the whole set on a row with no ts", () => {
    const refused = historyCandidates({
      channelId: "C1",
      channelName: "dev-team",
      rawMessages: [row({ ts: undefined })],
      workspace: "https://acme.slack.com",
    });
    expect(unwrapErr(refused).code).toBe("MISSING_TS");
  });

  it("REFUSES the whole set on a ts no instant can be read off", () => {
    const refused = historyCandidates({
      channelId: "C1",
      channelName: "dev-team",
      rawMessages: [row({ ts: "yesterday" })],
      workspace: "https://acme.slack.com",
    });
    expect(unwrapErr(refused).code).toBe("UNREADABLE_TS");
  });
});

describe("SlackNeighbourhoodErrors", () => {
  it("names the unreadable timestamp in the message a reader sees, not just the code", () => {
    const error = SlackNeighbourhoodErrors.unreadableTs({ ts: "yesterday" });
    expect(error.code).toBe("UNREADABLE_TS");
    expect(error.message).toBe("channel history carried `yesterday`, which is not a Slack timestamp");
  });

  it("says which message the history returned twice", () => {
    expect(SlackNeighbourhoodErrors.duplicateMessage({ ts: "1787942086.747699" }).message).toBe(
      "channel history returned duplicate message 1787942086.747699",
    );
  });
});
