/*
 * `narrowCoverage`: closed gaps dropped only under `--open-only`, and cells narrowed by surface and state apart.
 */
import { describe, expect, it } from "vitest";

import { narrowCoverage } from "../../../../../../cli/commands/atlas/coverageCore.js";
import { snapshot } from "./harness.js";

describe("narrowCoverage", () => {
  it("drops closed gaps only when --open-only is set", () => {
    const view = snapshot().kinds[0]!;
    const closed = { ...view, gaps: [{ ...view.gaps[0]!, status: "closed" as const }] };
    expect(narrowCoverage({ openOnly: false, state: undefined, surface: undefined, view: closed }).gaps.length).toBe(1);
    expect(narrowCoverage({ openOnly: true, state: undefined, surface: undefined, view: closed }).gaps.length).toBe(0);
  });

  it("narrows cells by surface and by state independently", () => {
    const view = snapshot().kinds[0]!;
    expect(narrowCoverage({ openOnly: false, state: undefined, surface: "browser", view }).coverage.length).toBe(0);
    expect(narrowCoverage({ openOnly: false, state: "unreadable", surface: undefined, view }).coverage.length).toBe(0);
    expect(narrowCoverage({ openOnly: false, state: "synced", surface: "rest-api", view }).coverage.length).toBe(1);
  });
});
