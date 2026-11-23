/**
 * `questionPostOf` picks channel, ts and a PRESENT permalink — nothing else rides along, and an absent or
 * undefined permalink leaves no own key behind.
 */
import { describe, expect, it } from "vitest";

import { questionPostOf } from "../../../handover/questionPost.js";

describe("questionPostOf", () => {
  it("keeps channel, ts and permalink and drops every other field the event carries", () => {
    const event = {
      atIso: "2026-09-20T10:00:00.000Z",
      channel: "D0SYN000002",
      kind: "question-posted",
      permalink: "https://example.slack.com/archives/D0SYN000002/p1789800000000100",
      question: "merge #403 tonight?",
      ts: "1789800000.000100",
    };

    expect(questionPostOf({ event })).toEqual({
      channel: "D0SYN000002",
      permalink: "https://example.slack.com/archives/D0SYN000002/p1789800000000100",
      ts: "1789800000.000100",
    });
  });

  it("answers channel and ts only when the event has no permalink", () => {
    const handle = questionPostOf({ event: { channel: "D0SYN000002", ts: "1789800000.000100" } });

    expect(Object.keys(handle)).toEqual(["channel", "ts"]);
    expect(handle).toEqual({ channel: "D0SYN000002", ts: "1789800000.000100" });
  });

  it("leaves no own permalink key when the event carries one explicitly undefined", () => {
    const event: { channel: string; ts: string; permalink?: string } = {
      channel: "D0SYN000002",
      ts: "1789800000.000100",
    };
    Object.assign(event, { permalink: undefined });

    expect(Object.keys(event)).toEqual(["channel", "ts", "permalink"]);
    expect(Object.keys(questionPostOf({ event }))).toEqual(["channel", "ts"]);
  });
});
