import { describe, expect, it } from "vitest";

import { runTurn } from "../../../../../live/turn/run.js";
import { MENTION, PROVENANCE } from "./fixtures.js";
import {
  drive,
  fakeQuery,
  NULL_COMPLETE,
  NULL_HOLD,
  NULL_SUPERSESSION,
  type Recorded,
  recordingPoster,
} from "./harness.js";

/**
 * MEASURED DEFECT: `beginTurn`'s own step-0 detail — built once the tier is known, correcting
 * capture's neutral placeholder to the real steps — quoted `mention.text` whole, with no cap. Unlike
 * `progressChecklistSteps` (already clamped) and the capture-time checklist (clamped alongside this fix),
 * this is the seam EVERY real turn's card goes through, captured or not — so an uncapped write here rode
 * straight into the card regardless of what either of those other two seams did.
 */
describe("runTurn's step-0 question text never rides into the card whole", () => {
  it("clamps a long question in the posted working message's step 0, rather than quoting it whole", async () => {
    const log: Recorded[] = [];
    const long = "why did the deploy fail? ".repeat(20);

    await drive({
      mention: { ...MENTION, text: long },
      poster: recordingPoster({ log }),
      query: fakeQuery({ phases: [] }),
    });

    const posted = log.find((entry) => entry.kind === "post-working")!;
    const detail = posted.details![0]!;
    expect(detail.length).toBeLessThanOrEqual(120);
    expect(long.length).toBeGreaterThan(120);
  });

  it("clamps the same way in the finalisation card when correcting a capture-time card throws", async () => {
    // With a capture-time checklist already posted (`started` set), `beginTurn` corrects it via
    // `advanceWorking` rather than posting fresh. A throw there that is NOT the message being gone escapes
    // `beginTurn` uncaught, so `posted` IS known and `settleChecklist` has a real card to finalise — unlike
    // the no-card-ever-posted case, where there is nothing to correct.
    const log: Recorded[] = [];
    const long = "why did the deploy fail? ".repeat(20);
    const started = { turnId: "turn-1", workingTs: "1712345678.000900" };

    await expect(
      runTurn({
        documents: [],
        earlierCards: [],
        supersession: NULL_SUPERSESSION,
        complete: NULL_COMPLETE,
        hold: NULL_HOLD,
        mention: { ...MENTION, text: long },
        poster: recordingPoster({ advanceThrows: new Error("chat.update: not_in_channel"), log }),
        provenance: PROVENANCE,
        query: fakeQuery({ phases: [] }),
        started,
        turnId: "turn-test",
        uploads: [],
      }),
    ).rejects.toThrow("chat.update: not_in_channel");

    const finalized = log.find((entry) => entry.kind === "finalize")!;
    const detail = finalized.details![0]!;
    expect(detail.length).toBeLessThanOrEqual(120);
  });

  /**
   * `src/live/listen/mention.ts` normalises `<@…>` and `<!…>` only, and it UNESCAPES `&lt;`/`&gt;`
   * afterwards — so a channel ref, a linked URL and a re-escaped user tag all reach `beginTurn` intact. A
   * `TodoStep.detail` is a field Slack PARSES, so each of those is a live link or a live mention on a card
   * that meant only to quote the question back.
   */
  it("renders the markup mention.ts does NOT normalise as prose, rather than quoting it live", async () => {
    const log: Recorded[] = [];

    await drive({
      mention: { ...MENTION, text: "@(U_KNOWN) is <#C9|deploys> broken? see <https://example.com|the run>" },
      poster: recordingPoster({ log }),
      query: fakeQuery({ phases: [] }),
    });

    expect(log.find((entry) => entry.kind === "post-working")!.details![0]!).toBe('"is #deploys broken? see the run"');
  });
});
