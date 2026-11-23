/*
 * Whether one utterance of the owner's owes the walk turn (`site/lib/talkPlanWalkWatch.ts`): the owner's next-card ask with no turn
 * started during it or running at its `done`. The voice usually hands off before the owner's words are final, so a start inside the utterance — even one ended by its `done` — answers it.
 */
import { describe, expect, it } from "vitest";

import { WalkAskWatch } from "../../lib/talkPlanWalkWatch";

const ASK = "All right, next card please";

describe("WalkAskWatch", () => {
  // A turn started before the owner's first delta and ended before the owner's done was handed none of these words.
  it("owes the walk turn when the owner's ask had no turn start during it and none runs, a turn ended mid-words included", () => {
    const watch = new WalkAskWatch();
    watch.turnStarted({ turnId: "t-before" });
    watch.heard();
    watch.heard();
    expect(watch.done({ running: 0, text: ASK })).toBe(true);
  });

  it("owes nothing when a turn started during the owner's words, even one that already ended", () => {
    const watch = new WalkAskWatch();
    watch.heard();
    watch.turnStarted({ turnId: "t-voice" });
    expect(watch.done({ running: 0, text: ASK })).toBe(false);
  });

  it("owes nothing while a turn runs, for words that are not the ask, or for no text", () => {
    const watch = new WalkAskWatch();
    watch.heard();
    expect(watch.done({ running: 1, text: ASK })).toBe(false);
    watch.heard();
    expect(watch.done({ running: 0, text: "the next card asks about backups" })).toBe(false);
    watch.heard();
    expect(watch.done({ running: 0, text: undefined })).toBe(false);
  });

  it("judges each utterance against its own first delta, so a start in an earlier one never holds a later ask", () => {
    const watch = new WalkAskWatch();
    watch.heard();
    watch.turnStarted({ turnId: "t-1" });
    expect(watch.done({ running: 0, text: "that sounds right" })).toBe(false);
    watch.heard();
    expect(watch.done({ running: 0, text: ASK })).toBe(true);
  });

  it("counts a replayed start of one turn once, and reads a lone done against the count at the done", () => {
    const watch = new WalkAskWatch();
    watch.turnStarted({ turnId: "t-1" });
    watch.heard();
    watch.turnStarted({ turnId: "t-1" });
    expect(watch.done({ running: 0, text: ASK })).toBe(true);
    watch.turnStarted({ turnId: "t-2" });
    expect(watch.done({ running: 0, text: ASK })).toBe(true);
  });
});
