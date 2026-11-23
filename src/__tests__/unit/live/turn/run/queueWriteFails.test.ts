import { describe, expect, it } from "vitest";

import type { HoldSink } from "../../../../../live/turn/run.js";
import { answered, failureReason, MENTION, noticeTs, withheldOf } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn when the QUEUE write fails", () => {
  const HELD = { code: "withhold.reply", reason: "U_ASKER is not the owner" };
  const brokenHold: HoldSink = async () => {
    throw new Error("the queue is unwritable");
  };

  it("still posts a notice, so the person who asked is never left in silence", async () => {
    const log: Recorded[] = [];
    await drive({
      hold: brokenHold,
      mention: MENTION,
      poster: recordingPoster({ log, withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(log.some((entry) => entry.kind === "post-notice")).toBe(true);
  });

  it("says the draft could NOT be filed, rather than naming an id that does not exist", async () => {
    const log: Recorded[] = [];
    await drive({
      hold: brokenHold,
      mention: MENTION,
      poster: recordingPoster({ log, withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(log.find((entry) => entry.kind === "post-notice")!.lead).toBe(
      "Held for review, not sent: what did we decide about the renderer?",
    );
  });

  it("reports it as a FAILURE, not as a withhold — there is nothing to release", async () => {
    const outcome = await drive({
      hold: brokenHold,
      mention: MENTION,
      poster: recordingPoster({ log: [], withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(answered(outcome)).toBe(false);
    expect(withheldOf(outcome)).toBe(undefined);
    expect(failureReason(outcome)).toBe("the draft was held but not filed: the queue is unwritable");
  });

  it("does not reject — a listener that must catch to learn this would eventually swallow it", async () => {
    const outcome = await drive({
      hold: brokenHold,
      mention: MENTION,
      poster: recordingPoster({ log: [], withhold: HELD }),
      query: fakeQuery({ phases: [] }),
    });
    expect(noticeTs(outcome)).toBe("1712345678.000500");
  });
});
