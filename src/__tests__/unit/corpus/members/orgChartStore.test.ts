import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { vantaAtlasPaths } from "../../../../atlas/vanta/store.js";
import { readOrgChart } from "../../../../corpus/members/orgChartStore.js";

describe("readOrgChart", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-chart-store-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an install with neither store as an empty chart, saying nothing is wrong", () => {
    const { chart, warnings } = readOrgChart({ home });
    expect([chart.directory.size, chart.vantaPeople.size, chart.vantaGroups.size, warnings]).toEqual([0, 0, 0, []]);
  });

  it("names a Vanta kind file it cannot trust, rather than drawing a chip silently missing its groups", () => {
    const file = vantaAtlasPaths({ home }).kinds["person"];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "not json\n");
    const { chart, warnings } = readOrgChart({ home });
    expect(chart.vantaPeople.size).toBe(0);
    expect(warnings.map((warning) => warning.startsWith("vanta person atlas unreadable: "))).toEqual([true, true]);
  });
});
