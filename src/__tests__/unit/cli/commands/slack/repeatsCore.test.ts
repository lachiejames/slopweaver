/**
 * `slack repeats`'s pure half: argument handling, and the three decisions made off what Slack returned.
 */
import { describe, expect, it } from "vitest";

import {
  auditMessagesOfRaw,
  parseSlackRepeatsOptions,
  placesOfSearch,
  threadRootsInWindow,
} from "../../../../../cli/commands/slack/repeatsCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const OWNER = "U0SYN000001";

describe("parseSlackRepeatsOptions", () => {
  it("defaults to seven days, both identities, text", () => {
    expect(unwrap(parseSlackRepeatsOptions({ defaultHome: "/h", rest: [] }))).toEqual({
      actors: ["me", "bot"],
      days: 7,
      home: "/h",
      json: false,
    });
  });

  it("narrows to one identity and reads --days", () => {
    expect(
      unwrap(parseSlackRepeatsOptions({ defaultHome: "/h", rest: ["--as", "bot", "--days", "3", "--json"] })),
    ).toEqual({
      actors: ["bot"],
      days: 3,
      home: "/h",
      json: true,
    });
  });

  it("refuses an unknown identity and a bad day count together", () => {
    const parsed = parseSlackRepeatsOptions({ defaultHome: "/h", rest: ["--as", "them", "--days", "0"] });
    expect(unwrapErr(parsed)).toEqual([
      "--days must be a positive whole number",
      '--as must be me, bot or both, got "them"',
    ]);
  });
});

describe("placesOfSearch", () => {
  it("names each conversation once and each thread a match sits in", () => {
    expect(
      placesOfSearch({
        matches: [
          { channelId: "C1", permalink: "https://a.slack.com/archives/C1/p1790604264247109" },
          {
            channelId: "C1",
            permalink: "https://a.slack.com/archives/C1/p1790604300000100?thread_ts=1790604264.247109&cid=C1",
          },
          { channelId: "D1", permalink: "https://a.slack.com/archives/D1/p1790604400000100" },
          { channelId: "", permalink: "https://a.slack.com/archives/x" },
        ],
      }),
    ).toEqual([{ channel: "C1" }, { channel: "D1" }, { channel: "C1", threadTs: "1790604264.247109" }]);
  });
});

describe("threadRootsInWindow", () => {
  const raw = [
    { latest_reply: "1790604300.000100", reply_users: [OWNER], ts: "1790604264.247109" },
    { latest_reply: "1790000000.000100", reply_users: [OWNER], ts: "1789990000.000100" },
    { latest_reply: "1790604500.000100", reply_users: ["U2"], ts: "1790604400.000100" },
    { ts: "1790604450.000100" },
  ];

  it("opens every root whose latest reply is in the window", () => {
    expect(threadRootsInWindow({ rawMessages: raw, sinceMs: 1790604000000 })).toEqual([
      "1790604264.247109",
      "1790604400.000100",
    ]);
  });

  it("narrows to threads the named user replied in", () => {
    expect(threadRootsInWindow({ joinedBy: OWNER, rawMessages: raw, sinceMs: 1790604000000 })).toEqual([
      "1790604264.247109",
    ]);
  });
});

describe("auditMessagesOfRaw", () => {
  it("keeps own messages in the window with their files and whether others replied", () => {
    const messages = auditMessagesOfRaw({
      actor: "me",
      channel: "C1",
      rawMessages: [
        { files: [{}, {}], reply_users: [OWNER, "U2"], text: "kept", ts: "1790604264.247109", user: OWNER },
        { text: "too old", ts: "1790000000.000100", user: OWNER },
        { text: "not theirs", ts: "1790604300.000100", user: "U2" },
      ],
      self: { userId: OWNER },
      sinceMs: 1790604000000,
      workspaceUrl: "https://a.slack.com/",
    });
    expect(messages.map((message) => [message.ts, message.fileCount, message.othersReplied])).toEqual([
      ["1790604264.247109", 2, true],
    ]);
  });
});
