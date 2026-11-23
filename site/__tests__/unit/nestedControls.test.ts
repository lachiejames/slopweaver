import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { markDrawers, scopesOf, shieldNames } from "./nestedControls/nestedControlsHarness.js";
import { consoleSources, nestedScan, offShields, SITE } from "./nestedControls/nestedControlsScan.js";

describe("the console's warning marks inside a control", () => {
  const sources = consoleSources().map((path) => ({ path, source: readFileSync(join(SITE, path), "utf8") }));
  const scopes = scopesOf({ sources });
  const drawers = markDrawers({ scopes });
  const shields = shieldNames({ scopes });
  const scans = sources.map(({ path, source }) => nestedScan({ drawers, shields, path, source }));

  it("reads every route and component, and computes the drawers the Queue row draws", () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((one) => one.path.endsWith(".jsx"))).toBe(true);
    expect(drawers.has("components/console/QueueSections#ConfidenceMark")).toBe(true);
    expect(drawers.has("components/console/CardLaps#CardLapsLine")).toBe(true);
  });

  it("sees the Queue row's marks, shielded, so the walk reaches each case", () => {
    const shielded = scans.flatMap((scan) => scan.shielded).map((one) => `${one.path} ${one.mark}`);
    // FindingMark draws a WarningMark beside an unplaced row's finding when a read left it unplaced.
    expect(shielded).toEqual([
      "components/console/QueueSections.tsx FindingMark",
      "components/console/QueueSections.tsx CardLapsLine",
      "components/console/QueueSections.tsx ConfidenceMark",
    ]);
  });

  it("has the mark read InsideControl and draw a labelled image under it, which the walk above cannot see", () => {
    const mark = sources.find((one) => one.path === "components/console/WarningMark.tsx")!.source;
    expect(mark).toContain("useContext(InsideControl)");
    expect(mark).toContain('role="img"');
  });

  it("has the connect affordance StaleMark draws in the glyph's place read InsideControl too, drawing no control under it", () => {
    const connect = sources.find((one) => one.path === "components/console/ConnectIntegration.tsx")!.source;
    expect(connect).toContain("useContext(InsideControl)");
    expect(connect).toContain('role="note"');
  });

  it("draws no warning mark inside a control without InsideControl", () => {
    expect(scans.flatMap((scan) => scan.refused)).toEqual([]);
  });

  it("never draws InsideControl turned off, so no component undoes a shield credited above", () => {
    const off = sources.flatMap((one) => offShields({ ...one, shields }).map((line) => `${one.path}:${line}`));
    expect(off).toEqual([]);
  });
});
