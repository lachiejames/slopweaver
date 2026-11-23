/*
 * `summariseKind`: one kind's cells tallied by state, and its open gaps counted apart from closed ones.
 */
import { describe, expect, it } from "vitest";

import { summariseKind } from "../../../../../../cli/commands/atlas/coverageCore.js";
import { snapshot } from "./harness.js";

describe("summariseKind", () => {
  it("counts cells by state and open gaps separately from closed ones", () => {
    const view = snapshot().kinds[0]!;
    const summary = summariseKind({ view });
    expect(summary.entityCount).toBe(1);
    expect(summary.publishedCount).toBe(1);
    expect(summary.openGaps).toBe(1);
    expect(summary.states["synced"]).toBe(1);
  });

  it("adds a second cell in a state to the first rather than restarting the count", () => {
    const view = snapshot().kinds[0]!;
    const summary = summariseKind({ view: { ...view, coverage: [view.coverage[0]!, view.coverage[0]!] } });
    expect(summary.states).toEqual({ synced: 2 });
  });

  it("holds no state at all for a kind with no cells", () => {
    const view = snapshot().kinds[0]!;
    expect(summariseKind({ view: { ...view, coverage: [] } }).states).toEqual({});
  });
});
