import { describe, expect, it } from "vitest";

import {
  type AtlasContentDebt,
  atlasContentCoverageProblems,
  type ScannedPlatform,
  scanAtlasContentCoverage,
} from "../../../devLint/atlasContentCoverage.js";

const known = ({ exists, reached }: { exists: number; reached: number }) => ({ exists, known: true, reached }) as const;
const unknown = () => ({ known: false }) as const;

const platform = ({ name, surfaces }: { name: string; surfaces: ScannedPlatform["surfaces"] }): ScannedPlatform => ({
  platform: name,
  surfaces,
});

describe("scanAtlasContentCoverage", () => {
  it("counts a surface with no denominator as debt", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "vanta",
          surfaces: [{ denominator: unknown(), name: "browser", status: "filled" }],
        }),
      ],
    });
    expect(scan.surfacesWithNoDenominator).toBe(1);
    expect(scan.knownSurfaces).toEqual({});
    expect(scan.duplicateSurfaces).toEqual([]);
    expect(scan.filledButEmpty).toEqual([]);
    expect(scan.platformsScanned).toBe(1);
  });

  it("reports a known surface's two numbers separately, keyed by platform and surface", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "vanta",
          surfaces: [{ denominator: known({ exists: 107, reached: 42 }), name: "manage-api", status: "filled" }],
        }),
      ],
    });
    expect(scan.knownSurfaces).toEqual({ "vanta/manage-api": { exists: 107, reached: 42 } });
    expect(scan.surfacesWithNoDenominator).toBe(0);
  });

  it("keeps two surfaces of one platform apart, because each ratchets on its own", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "vanta",
          surfaces: [
            { denominator: known({ exists: 107, reached: 25 }), name: "manage-api", status: "filled" },
            { denominator: known({ exists: 38, reached: 0 }), name: "auditor-api", status: "declared-unfilled" },
          ],
        }),
      ],
    });
    expect(scan.knownSurfaces).toEqual({
      "vanta/auditor-api": { exists: 38, reached: 0 },
      "vanta/manage-api": { exists: 107, reached: 25 },
    });
  });

  it("flags a filled surface whose denominator says it reached nothing", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "braze",
          surfaces: [{ denominator: known({ exists: 40, reached: 0 }), name: "rest-api", status: "filled" }],
        }),
      ],
    });
    expect(scan.filledButEmpty).toEqual([{ platform: "braze", surface: "rest-api" }]);
  });

  it("does not flag a filled surface with nothing to reach, because zero of zero is a measurement", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "vanta",
          surfaces: [{ denominator: known({ exists: 0, reached: 0 }), name: "webhooks", status: "filled" }],
        }),
      ],
    });
    expect(scan.filledButEmpty).toEqual([]);
    expect(scan.knownSurfaces).toEqual({ "vanta/webhooks": { exists: 0, reached: 0 } });
  });

  it("does not flag an unfilled surface that reached nothing", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "braze",
          surfaces: [{ denominator: known({ exists: 40, reached: 0 }), name: "rest-api", status: "declared-unfilled" }],
        }),
      ],
    });
    expect(scan.filledButEmpty).toEqual([]);
  });

  it("reports a surface name declared twice, because two rows with one name collapse into one ratchet entry", () => {
    const scan = scanAtlasContentCoverage({
      platforms: [
        platform({
          name: "vanta",
          surfaces: [
            { denominator: known({ exists: 106, reached: 25 }), name: "manage-api", status: "filled" },
            { denominator: known({ exists: 107, reached: 25 }), name: "manage-api", status: "filled" },
          ],
        }),
      ],
    });
    expect(scan.duplicateSurfaces).toEqual([{ platform: "vanta", surface: "manage-api" }]);
  });

  it("counts nothing for an atlas with no surfaces", () => {
    const scan = scanAtlasContentCoverage({ platforms: [platform({ name: "empty", surfaces: [] })] });
    expect(scan.surfacesWithNoDenominator).toBe(0);
    expect(scan.platformsScanned).toBe(1);
  });
});

describe("atlasContentCoverageProblems", () => {
  const debt: AtlasContentDebt = {
    knownSurfaces: { "vanta/manage-api": { because: "the pinned Manage document", exists: 107, reached: 25 } },
    surfacesWithNoDenominator: 3,
  };
  const scanOf = ({
    surfacesWithNoDenominator = 3,
    knownSurfaces = { "vanta/manage-api": { exists: 107, reached: 25 } },
    filledButEmpty = [],
  }: {
    surfacesWithNoDenominator?: number;
    knownSurfaces?: Record<string, { exists: number; reached: number }>;
    filledButEmpty?: readonly { platform: string; surface: string }[];
  }) => ({ duplicateSurfaces: [], filledButEmpty, knownSurfaces, platformsScanned: 1, surfacesWithNoDenominator });

  it("passes when every number sits exactly at its recorded baseline", () => {
    expect(atlasContentCoverageProblems({ debt, scan: scanOf({}) })).toEqual([]);
  });

  it("refuses a rise in surfaces with no denominator", () => {
    const problems = atlasContentCoverageProblems({ debt, scan: scanOf({ surfacesWithNoDenominator: 4 }) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("may not land without one");
  });

  it("refuses a baseline left stale after the denominator-less count came down", () => {
    const problems = atlasContentCoverageProblems({ debt, scan: scanOf({ surfacesWithNoDenominator: 2 }) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("lower ATLAS_CONTENT_DEBT.surfacesWithNoDenominator to 2");
  });

  it("refuses reach that FELL, which is the one movement nothing forgives", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: scanOf({ knownSurfaces: { "vanta/manage-api": { exists: 107, reached: 24 } } }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("reach FELL");
  });

  it("refuses a stale baseline after reach ROSE, naming the number to record", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: scanOf({ knownSurfaces: { "vanta/manage-api": { exists: 107, reached: 52 } } }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Raise ATLAS_CONTENT_DEBT.knownSurfaces["vanta/manage-api"].reached to 52');
  });

  it("refuses a denominator that SHRANK, because a shortfall is not paid by deleting it", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: scanOf({ knownSurfaces: { "vanta/manage-api": { exists: 106, reached: 25 } } }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("the denominator SHRANK");
  });

  it("asks for a GROWN denominator to be recorded, and says it is not a regression", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: scanOf({ knownSurfaces: { "vanta/manage-api": { exists: 157, reached: 25 } } }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("the denominator GREW");
    expect(problems[0]).toContain("is not a regression");
    expect(problems[0]).toContain('raising ATLAS_CONTENT_DEBT.knownSurfaces["vanta/manage-api"].exists to 157');
  });

  it("refuses a new known surface carrying no baseline at all", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: scanOf({
        knownSurfaces: {
          "vanta/auditor-api": { exists: 38, reached: 0 },
          "vanta/manage-api": { exists: 107, reached: 25 },
        },
      }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("vanta/auditor-api: declares a real denominator");
  });

  it("refuses a recorded baseline whose surface no longer declares a denominator", () => {
    const problems = atlasContentCoverageProblems({ debt, scan: scanOf({ knownSurfaces: {} }) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("a baseline is recorded for a surface no descriptor declares");
  });

  it("refuses a duplicate surface name, the collapse that could hide a shrunk denominator", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: { ...scanOf({}), duplicateSurfaces: [{ platform: "vanta", surface: "manage-api" }] },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("is declared more than once");
  });

  it("refuses a filled-but-empty surface with no baseline to forgive it", () => {
    const problems = atlasContentCoverageProblems({
      debt,
      scan: scanOf({ filledButEmpty: [{ platform: "braze", surface: "rest-api" }] }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("it has no baseline");
  });
});
