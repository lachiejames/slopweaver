import { describe, expect, it } from "vitest";
import { ANSWER_DOOR_HATCHES } from "../../../hatch/answerDoorHatches.js";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";

/*
 * The split moved rows between files and was supposed to change nothing else. What a move can actually
 * break is exactly two things — a row dropping out of the one array the `escape-hatch` gate reads, and the
 * register's reading order silently changing — so those are what is asserted here, rather than the contents
 * of any one row, which `registry.test.ts` already governs for the whole set.
 */
describe("ANSWER_DOOR_HATCHES", () => {
  it("declares the outbound answer door's rows, in their register order", () => {
    expect(ANSWER_DOOR_HATCHES.length).toBeGreaterThan(0);
    expect(ANSWER_DOOR_HATCHES.map((hatch) => hatch.id)).toEqual([
      "answer-quality",
      "answer-image-observations",
      "asker-tag",
      "local-page-path",
      "markdown-first",
      "core-deliverable",
      "voice-profile",
      "invented-visual",
      "animated-gif",
      "unread-image",
      "real-artifact",
      "skill-load",
      "declined-atlas",
      "datadog-citation",
      "unshown-graphs",
      "withhold-reply",
      "door-demo",
      "slack-duplicate-send",
      "invalid-datadog-console-host",
      "repeat-send",
      "repeat-thread-reply",
    ]);
  });

  it("is spread into the one register the escape-hatch gate reads, contiguously and in order", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    const at = ids.indexOf("answer-quality");
    expect(at).toBeGreaterThan(0);
    expect(ids.slice(at, at + ANSWER_DOOR_HATCHES.length)).toEqual(ANSWER_DOOR_HATCHES.map((h) => h.id));
  });

  it("puts the door's rows after `stale-seat-finding`, exactly where they were typed", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    expect(ids[ids.indexOf("answer-quality") - 1]).toBe("stale-seat-finding");
    expect(ids[ids.indexOf("repeat-thread-reply") + 1]).toBe("responder-allow-open");
  });
});
