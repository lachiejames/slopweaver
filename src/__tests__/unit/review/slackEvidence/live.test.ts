import { describe, expect, it } from "vitest";

import { conversationOf, judgeLiveCandidates } from "../../../../review/slackEvidenceLive.js";
import type { LiveCandidate } from "../../../../review/slackEvidenceTypes.js";
import { IDENTITY, REF } from "./harness.js";

/** A live search candidate, with the fields a test cares about overridden. */
const candidate = (over: Partial<LiveCandidate> = {}): LiveCandidate => ({
  channelId: "C1",
  channelName: "a-channel",
  permalink: "https://example.slack.com/archives/C1/p1",
  text: "review https://github.com/owner/repo/pull/16349 please",
  ts: "1787942086.747699",
  tsIso: "2026-08-29T06:10:22.000Z",
  userId: "U1",
  ...over,
});

describe("conversationOf", () => {
  it("prefixes a channel with a hash and names no counterpart", () => {
    expect(conversationOf({ candidate: candidate() })).toEqual({
      channel: "#a-channel",
      counterpartId: "",
      isDirectMessage: false,
    });
  });

  it("reads a D-prefixed conversation as a direct message and takes its counterpart", () => {
    expect(conversationOf({ candidate: candidate({ channelId: "D1", channelName: "U2" }) })).toEqual({
      channel: "dm:U2",
      counterpartId: "U2",
      isDirectMessage: true,
    });
  });

  it("names no counterpart when a direct message's channel name is not a user id", () => {
    expect(conversationOf({ candidate: candidate({ channelId: "D1", channelName: "someone" }) })).toEqual({
      channel: "dm:someone",
      counterpartId: "",
      isDirectMessage: true,
    });
  });
});

describe("judgeLiveCandidates", () => {
  it("places a direct message with the owner's own bot in the owner-only conversation, where nobody can be asked", () => {
    const judged = judgeLiveCandidates({
      candidates: [
        candidate({ channelId: "D1", channelName: "UBOT" }),
        candidate({ channelId: "D2", channelName: "U7" }),
      ],
      identity: IDENTITY,
      ref: REF,
    });
    expect(judged.map((m) => m.conversation)).toEqual(["owner-only", "direct-message"]);
  });

  it("never reads an authorless hit as the owner when no owner id is configured", () => {
    const judged = judgeLiveCandidates({
      candidates: [candidate({ userId: "" })],
      identity: { ownerSlackUserId: "", selfUserIds: [] },
      ref: REF,
    });
    expect(judged.map((m) => m.authorRole)).toEqual(["other-human"]);
  });

  it("keeps a candidate whose own text links the exact pull request", () => {
    const judged = judgeLiveCandidates({ candidates: [candidate()], identity: IDENTITY, ref: REF });
    expect(judged.length).toBe(1);
    expect(judged[0]!.prKey).toBe("owner/repo#16349");
    expect(judged[0]!.leg).toBe("live");
  });

  it("drops a candidate Slack's token search matched but whose text links nothing", () => {
    expect(
      judgeLiveCandidates({ candidates: [candidate({ text: "16349 is the ticket" })], identity: IDENTITY, ref: REF }),
    ).toEqual([]);
  });

  it("drops a candidate linking a neighbouring pull-request number", () => {
    const text = "https://github.com/owner/repo/pull/163490";
    expect(judgeLiveCandidates({ candidates: [candidate({ text })], identity: IDENTITY, ref: REF })).toEqual([]);
  });

  it("carries the mention runs a candidate's own text holds", () => {
    const text = "<@U9> review https://github.com/owner/repo/pull/16349";
    expect(judgeLiveCandidates({ candidates: [candidate({ text })], identity: IDENTITY, ref: REF })[0]!.tagged).toEqual(
      ["U9"],
    );
  });
});
