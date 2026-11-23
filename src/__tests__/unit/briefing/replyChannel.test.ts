/**
 * `misroutedReplyChannel` and the refusal built from it: which tell words are caught (reply and react
 * inflections, `DM card`) exactly as the cell spelled them, which are not (`reactivate`, a bare `DM`), and the
 * over-broad escape — any mention of the supervisor clears the cell.
 */
import { describe, expect, it } from "vitest";

import { misroutedReplyChannel, REPLY_CHANNEL_ADVICE, replyChannelRefusal } from "../../../briefing/replyChannel.js";

describe("misroutedReplyChannel", () => {
  it("returns a capitalised reply exactly as the cell spelled it", () => {
    expect(misroutedReplyChannel({ text: "Reply on the card and the session lands #282" })).toBe("Reply");
  });

  it("returns the replying inflection whole", () => {
    expect(misroutedReplyChannel({ text: "keep replying in the thread" })).toBe("replying");
  });

  it("returns the replied inflection whole", () => {
    expect(misroutedReplyChannel({ text: "once you have replied it merges" })).toBe("replied");
  });

  it("returns a react inflection whole", () => {
    expect(misroutedReplyChannel({ text: "a thumbs-up reaction lands it" })).toBe("reaction");
  });

  it("returns the DM card phrase case-insensitively", () => {
    expect(misroutedReplyChannel({ text: "answer on the dm card" })).toBe("dm card");
  });

  it("returns the first tell when a cell carries two", () => {
    expect(misroutedReplyChannel({ text: "react, or reply with the word" })).toBe("react");
  });

  it("does not treat reactivate as a tell", () => {
    expect(misroutedReplyChannel({ text: "reactivate the paused recipe" })).toBe(undefined);
  });

  it("does not treat a bare DM as a tell", () => {
    expect(misroutedReplyChannel({ text: "the bot's DM shows the digest" })).toBe(undefined);
  });

  it("returns nothing for prose naming no channel", () => {
    expect(misroutedReplyChannel({ text: "merge #403 tonight" })).toBe(undefined);
  });

  it("returns nothing when the cell routes the owner to the supervisor", () => {
    expect(misroutedReplyChannel({ text: "tell the Supervisor reply-ship" })).toBe(undefined);
  });
});

describe("replyChannelRefusal", () => {
  it("the advice names the supervisor shape", () => {
    expect(REPLY_CHANNEL_ADVICE).toBe('The owner only ever answers there, so word it "tell the supervisor <word>".');
  });

  it("names the cell, the offending phrase and the advice in one line", () => {
    expect(replyChannelRefusal({ cell: "option A", phrase: "reply" })).toBe(
      'option A routes the owner to "reply" rather than the supervisor chat. The owner only ever answers there, so word it "tell the supervisor <word>".',
    );
  });
});
