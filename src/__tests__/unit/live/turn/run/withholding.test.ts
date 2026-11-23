import { describe, expect, it } from "vitest";

import type { HeldReply } from "../../../../../admit/queue.js";
import { HELD_UPLOADS_KEY } from "../../../../../live/turn/heldUploads.js";
import { answered, failureReason, MENTION, noticeTs, withheldOf } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn withholding", () => {
  const HELD = { code: "withhold.reply", reason: "U_ASKER is not the owner" };

  it("posts a held notice instead of the answer, so the thread never goes silent", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log, withhold: HELD }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(log.map((entry) => entry.kind)).toEqual([
      "post-working",
      "begin-status",
      "advance",
      "advance",
      "post-answer",
      "post-notice",
      "end-status",
      "finalize",
      "settle-reaction",
    ]);
    expect(log.find((entry) => entry.kind === "post-notice")!.lead).toBe(
      "Held for review, not sent: what did we decide about the renderer?",
    );
  });

  it("files the draft BEFORE telling the thread it was queued, so the id always names a real entry", async () => {
    const log: Recorded[] = [];
    let filedBeforeNotice = false;
    await drive({
      hold: async () => {
        filedBeforeNotice = log.at(-1)!.kind === "post-answer";
        return { id: "q-abc12345" };
      },
      mention: MENTION,
      poster: recordingPoster({ log, withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(filedBeforeNotice).toBe(true);
  });

  it("files everything needed to act on the draft later, plus the locked (empty) upload list", async () => {
    const filed: HeldReply[] = [];
    await drive({
      hold: async ({ held }) => {
        filed.push(held);
        return { id: "q-abc12345" };
      },
      mention: MENTION,
      poster: recordingPoster({ log: [], withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(filed.length).toBe(1);
    expect(filed[0]!.channel).toBe("C1");
    expect(filed[0]!.threadTs).toBe("1712345678.000100");
    expect(filed[0]!.askedBy).toBe("U_ASKER");
    expect(filed[0]!.surface).toBe("channel");
    expect(filed[0]!.question).toBe("what did we decide about the renderer?");
    expect(filed[0]!.code).toBe("withhold.reply");
    expect(filed[0]!.reason).toBe("U_ASKER is not the owner");
    expect(filed[0]!.draft["lead"]).toBe("We render rich_text.");
    expect(filed[0]!.draft[HELD_UPLOADS_KEY]).toEqual([]);
  });

  it("reports the withhold as its own outcome, never as a failure", async () => {
    const outcome = await drive({
      hold: async () => ({ id: "q-abc12345" }),
      mention: MENTION,
      poster: recordingPoster({ log: [], withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(answered(outcome)).toBe(false);
    expect(failureReason(outcome)).toBe(undefined);
    expect(withheldOf(outcome)).toEqual({
      code: "withhold.reply",
      id: "q-abc12345",
      reason: "U_ASKER is not the owner",
    });
    expect(noticeTs(outcome)).toBe("1712345678.000500");
  });

  // The final step is marked FAILED, not done, and that is the correction rather than a regression. A
  // withheld turn composed an answer and then did not send one; ticking every step green said the work
  // finished, which is the class of untruth `live/turn/indicators.ts` exists to remove. The detail carries
  // what actually happened, so the card states the ending rather than implying a different one.
  it("marks the final step failed on a withheld turn, and says why, because nothing was sent", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log, withhold: HELD }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    const finalized = log.findLast((entry) => entry.kind === "finalize")!;
    expect(finalized.states).toEqual(["done", "failed"]);
  });

  it("does not put a word of the draft into the held notice", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log, withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(log.find((entry) => entry.kind === "post-notice")!.lead!.includes("rich_text")).toBe(false);
  });
});
