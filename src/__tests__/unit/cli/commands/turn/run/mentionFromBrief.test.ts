/*
 * `mentionFromBrief`: the mention the transport would have parsed, rebuilt from a brief — its own `messageTs` over
 * the thread root, and a dm surface carried through.
 */
import { describe, expect, it } from "vitest";

import { mentionFromBrief } from "../../../../../../cli/commands/turn/run.js";
import { BRIEF } from "./harness.js";

describe("mentionFromBrief", () => {
  it("rebuilds the mention the transport would have parsed", () => {
    expect(mentionFromBrief({ brief: BRIEF })).toEqual({
      channel: "C1",
      messageTs: "1.1",
      surface: "channel",
      text: "what did we decide?",
      threadTs: "1.1",
      userId: "U_ASKER",
    });
  });

  it("uses the brief's own messageTs, never the thread root, when they differ", () => {
    expect(mentionFromBrief({ brief: { ...BRIEF, messageTs: "2.2" } }).messageTs).toBe("2.2");
  });

  it("carries a dm surface through, which is what makes the turn name the agent thread", () => {
    expect(mentionFromBrief({ brief: { ...BRIEF, channel: "D1", surface: "dm" } }).surface).toBe("dm");
  });
});
