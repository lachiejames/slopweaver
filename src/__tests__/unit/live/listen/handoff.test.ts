/**
 * The emitted mention is a contract between two processes — this verb prints it and `/slopweaver:loop` parses it —
 * so its exact shape is asserted, including the pre-joined reply target and the optional capture-time checklist.
 */
import { describe, expect, it } from "vitest";

import { emittedMention } from "../../../../live/listen/handoff.js";
import type { Mention } from "../../../../live/listen/mention.js";

const MENTION: Mention = {
  channel: "C0123",
  messageTs: "1760000000.000200",
  surface: "channel",
  text: "@(U0BOT) why did the staging pool exhaust",
  threadTs: "1760000000.000100",
  userId: "U0ASKER",
};

describe("emittedMention", () => {
  it("shapes a mention with its reply target resolved to the channel and the THREAD, not the message", () => {
    expect(emittedMention({ mention: MENTION })).toEqual({
      channel: "C0123",
      messageTs: "1760000000.000200",
      replyTarget: { channel: "C0123", threadTs: "1760000000.000100" },
      surface: "channel",
      text: "@(U0BOT) why did the staging pool exhaust",
      threadTs: "1760000000.000100",
      userId: "U0ASKER",
    });
  });

  it("passes the capture-time checklist through when the listener posted one", () => {
    const started = { turnId: "turn-7", workingTs: "1760000001.000300" };

    expect(emittedMention({ mention: { ...MENTION, started } }).started).toEqual(started);
  });

  it("omits the key entirely when no checklist was posted, so the JSON carries no `started: undefined`", () => {
    const emitted = emittedMention({ mention: { ...MENTION, started: undefined } });

    expect(Object.keys(emitted).includes("started")).toBe(false);
  });
});
