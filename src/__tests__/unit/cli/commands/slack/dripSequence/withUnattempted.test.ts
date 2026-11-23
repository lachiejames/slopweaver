/*
 * `withUnattempted`: it fills exactly the messages a run never reached, numbered from where it stopped, carrying
 * the halt reason, and adds nothing past the stated total.
 */
import { describe, expect, it } from "vitest";
import type { DripOutcome } from "../../../../../../cli/commands/slack/dripCore.js";
import { withUnattempted } from "../../../../../../cli/commands/slack/dripCore.js";

describe("withUnattempted", () => {
  const reached: readonly DripOutcome[] = [
    { fileIds: [], index: 0, state: "sent", ts: "1.1" },
    { error: "boom", index: 1, state: "failed" },
  ];

  it("fills exactly the messages the run never reached, numbered from where it stopped", () => {
    expect(withUnattempted({ outcomes: reached, reason: "earlier-failure", total: 4 })).toEqual([
      { fileIds: [], index: 0, state: "sent", ts: "1.1" },
      { error: "boom", index: 1, state: "failed" },
      { index: 2, reason: "earlier-failure", state: "not-attempted" },
      { index: 3, reason: "earlier-failure", state: "not-attempted" },
    ]);
  });

  it("adds nothing when the run reached the end", () => {
    expect(withUnattempted({ outcomes: reached, reason: "earlier-failure", total: 2 })).toEqual(reached);
  });

  it("adds nothing when more outcomes exist than the stated total, rather than going negative", () => {
    expect(withUnattempted({ outcomes: reached, reason: "unconfirmed-prior", total: 1 })).toEqual(reached);
  });

  it("carries the halt reason through, so the report can say WHY nothing else was tried", () => {
    const filled = withUnattempted({ outcomes: [], reason: "unconfirmed-prior", total: 2 });

    expect(filled).toEqual([
      { index: 0, reason: "unconfirmed-prior", state: "not-attempted" },
      { index: 1, reason: "unconfirmed-prior", state: "not-attempted" },
    ]);
  });
});
