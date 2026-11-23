import { describe, expect, it } from "vitest";
import { MAX_FILE_LINES, offendersOf } from "../../../devLint/fileSizeMeasure.js";
import { regressionsOf, slackOf, staleRowsOf, worseningsOf } from "../../../devLint/fileSizeRatchet.js";
import { size } from "./fileSizeFixture.js";

describe("offendersOf", () => {
  it("keeps only files over the cap, sorted by path", () => {
    const sizes = [
      size({ codeLines: MAX_FILE_LINES + 1, path: "src/b.ts" }),
      size({ codeLines: MAX_FILE_LINES, path: "src/a.ts" }),
      size({ codeLines: MAX_FILE_LINES + 5, path: "src/a.ts" }),
    ];
    expect(offendersOf({ sizes }).map((one) => one.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("a file exactly at the cap is not an offender", () => {
    expect(offendersOf({ sizes: [size({ codeLines: MAX_FILE_LINES, path: "src/a.ts" })] })).toEqual([]);
  });

  it("keeps an exempt file over the cap, so it can be frozen at its own ceiling", () => {
    const sizes = [size({ codeLines: 1859, exempt: true, path: "src/atlas/slackApi/browser.ts" })];
    expect(offendersOf({ sizes })).toEqual([
      {
        codeLines: 1859,
        exempt: true,
        exemptMarker: false,
        path: "src/atlas/slackApi/browser.ts",
        rawLines: 1869,
        registerMarker: false,
      },
    ]);
  });
});

describe("regressionsOf", () => {
  it("flags a current offender absent from the baseline as new", () => {
    const current = [size({ codeLines: 900, path: "src/a.ts" })];
    expect(regressionsOf({ baseline: { exempt: [], offenders: [] }, current })).toEqual([
      {
        codeLines: 900,
        exempt: false,
        path: "src/a.ts",
        rawLines: 910,
        tightestFloor: undefined,
      },
    ]);
  });

  it("flags an existing offender that grew past its baseline", () => {
    const current = [size({ codeLines: 950, path: "src/a.ts" })];
    const baseline = { exempt: [], offenders: [{ codeLines: 900, path: "src/a.ts" }] };
    expect(regressionsOf({ baseline, current })).toEqual([
      {
        codeLines: 950,
        exempt: false,
        path: "src/a.ts",
        rawLines: 960,
        tightestFloor: 900,
      },
    ]);
  });

  it("does not flag an offender at or below its baseline", () => {
    const current = [size({ codeLines: 900, path: "src/a.ts" })];
    const baseline = { exempt: [], offenders: [{ codeLines: 900, path: "src/a.ts" }] };
    expect(regressionsOf({ baseline, current })).toEqual([]);
  });

  it("REFUSES an exempt file growing past its recorded ceiling — the 1,859-line case", () => {
    const current = [size({ codeLines: 1860, exempt: true, path: "src/atlas/slackApi/browser.ts" })];
    const baseline = { exempt: [{ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" }], offenders: [] };
    expect(regressionsOf({ baseline, current })).toEqual([
      {
        codeLines: 1860,
        exempt: true,
        path: "src/atlas/slackApi/browser.ts",
        rawLines: 1870,
        tightestFloor: 1859,
      },
    ]);
  });

  it("lets an exempt file sit at its recorded ceiling, however long that is", () => {
    const current = [size({ codeLines: 1859, exempt: true, path: "src/atlas/slackApi/browser.ts" })];
    const baseline = { exempt: [{ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" }], offenders: [] };
    expect(regressionsOf({ baseline, current })).toEqual([]);
  });

  it("holds a file to its floor after a marker toggle, because the count did not move", () => {
    const current = [size({ codeLines: 900, exempt: true, path: "src/a.ts" })];
    const baseline = { exempt: [], offenders: [{ codeLines: 900, path: "src/a.ts" }] };
    expect(regressionsOf({ baseline, current })).toEqual([]);
    expect(staleRowsOf({ baseline, current })).toEqual([{ exempt: false, path: "src/a.ts" }]);
  });

  it("refuses a file that GREW while its marker was being added, across the halves", () => {
    const current = [size({ codeLines: 1000, exempt: true, path: "src/a.ts" })];
    const baseline = { exempt: [], offenders: [{ codeLines: 900, path: "src/a.ts" }] };
    expect(regressionsOf({ baseline, current })).toEqual([
      {
        codeLines: 1000,
        exempt: true,
        path: "src/a.ts",
        rawLines: 1010,
        tightestFloor: 900,
      },
    ]);
  });

  it("holds a path standing in BOTH halves to the tighter row, not the looser one it toggled into", () => {
    // The r3 counterexample: a 650 offender row and a 900 exempt ceiling for one path. Reading only the
    // half the marker puts it in, 700 passed against 900 and no regression was raised at all, so
    // `worseningsOf` never saw it and `--rebaseline` deleted the 650.
    const current = [size({ codeLines: 700, exempt: true, path: "src/a.ts" })];
    const baseline = {
      exempt: [{ codeLines: 900, path: "src/a.ts" }],
      offenders: [{ codeLines: 650, path: "src/a.ts" }],
    };
    const regressions = regressionsOf({ baseline, current });
    expect(regressions).toEqual([
      {
        codeLines: 700,
        exempt: true,
        path: "src/a.ts",
        rawLines: 710,
        tightestFloor: 650,
      },
    ]);
    expect(worseningsOf({ regressions })).toEqual(regressions);
  });

  it("treats a long file that LOST its marker as held by the ceiling it already had", () => {
    const current = [size({ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" })];
    const baseline = { exempt: [{ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" }], offenders: [] };
    expect(regressionsOf({ baseline, current })).toEqual([]);
    expect(staleRowsOf({ baseline, current })).toEqual([{ exempt: true, path: "src/atlas/slackApi/browser.ts" }]);
  });
});

describe("staleRowsOf", () => {
  it("flags an offender row whose file has fallen under the cap", () => {
    const baseline = { exempt: [], offenders: [{ codeLines: 449, path: "src/review/landing.ts" }] };
    expect(staleRowsOf({ baseline, current: [] })).toEqual([{ exempt: false, path: "src/review/landing.ts" }]);
  });

  it("flags an exempt ceiling whose file is gone", () => {
    const baseline = { exempt: [{ codeLines: 571, path: "src/atlas/jam/generated/surfaces.ts" }], offenders: [] };
    expect(staleRowsOf({ baseline, current: [] })).toEqual([
      { exempt: true, path: "src/atlas/jam/generated/surfaces.ts" },
    ]);
  });

  it("flags a row whose file changed halves, so adding a marker to dodge the cap is visible", () => {
    const baseline = { exempt: [], offenders: [{ codeLines: 900, path: "src/a.ts" }] };
    const current = [size({ codeLines: 900, exempt: true, path: "src/a.ts" })];
    expect(staleRowsOf({ baseline, current })).toEqual([{ exempt: false, path: "src/a.ts" }]);
  });

  it("does not flag a row whose file is still over the cap in the same half", () => {
    const baseline = { exempt: [], offenders: [{ codeLines: 900, path: "src/a.ts" }] };
    expect(staleRowsOf({ baseline, current: [size({ codeLines: 900, path: "src/a.ts" })] })).toEqual([]);
  });

  it("does NOT flag a row whose count merely dropped while staying over the cap", () => {
    const baseline = { exempt: [], offenders: [{ codeLines: 559, path: "src/a.ts" }] };
    expect(staleRowsOf({ baseline, current: [size({ codeLines: 400, path: "src/a.ts" })] })).toEqual([]);
  });

  it("is empty when every row still fires", () => {
    const baseline = {
      exempt: [{ codeLines: 1859, path: "src/gen.ts" }],
      offenders: [{ codeLines: 559, path: "src/a.ts" }],
    };
    const current = [
      size({ codeLines: 559, path: "src/a.ts" }),
      size({ codeLines: 1859, exempt: true, path: "src/gen.ts" }),
    ];
    expect(staleRowsOf({ baseline, current })).toEqual([]);
  });
});

describe("slackOf", () => {
  it("totals the headroom a floor holds above what its files measure today", () => {
    const baseline = {
      exempt: [{ codeLines: 1859, path: "src/gen.ts" }],
      offenders: [{ codeLines: 559, path: "src/a.ts" }],
    };
    const current = [
      size({ codeLines: 400, path: "src/a.ts" }),
      size({ codeLines: 1850, exempt: true, path: "src/gen.ts" }),
    ];
    expect(slackOf({ baseline, current })).toBe(168);
  });

  it("is zero when every row records exactly what its file measures", () => {
    const baseline = { exempt: [], offenders: [{ codeLines: 559, path: "src/a.ts" }] };
    expect(slackOf({ baseline, current: [size({ codeLines: 559, path: "src/a.ts" })] })).toBe(0);
  });

  it("counts nothing for a file with no row at all", () => {
    expect(
      slackOf({ baseline: { exempt: [], offenders: [] }, current: [size({ codeLines: 559, path: "src/a.ts" })] }),
    ).toBe(0);
  });
});

describe("worseningsOf", () => {
  it("keeps only regressions the floor already held a tighter count for", () => {
    const regressions = [
      {
        codeLines: 900,
        exempt: false,
        path: "src/new.ts",
        rawLines: 1000,
        tightestFloor: undefined,
      },
      {
        codeLines: 950,
        exempt: false,
        path: "src/worse.ts",
        rawLines: 1000,
        tightestFloor: 900,
      },
    ];
    expect(worseningsOf({ regressions }).map((one) => one.path)).toEqual(["src/worse.ts"]);
  });

  it("REFUSES a rebaseline laundering a raise through a marker toggle — the r1 counterexample", () => {
    const current = [size({ codeLines: 2000, path: "src/atlas/slackApi/browser.ts" })];
    const baseline = { exempt: [{ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" }], offenders: [] };
    const regressions = regressionsOf({ baseline, current });
    expect(regressions[0]!.tightestFloor).toBe(1859);
    expect(worseningsOf({ regressions }).map((one) => one.path)).toEqual(["src/atlas/slackApi/browser.ts"]);
  });

  it("lets a marker toggle through when the file did not grow, since the ratchet is not what moved", () => {
    const current = [size({ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" })];
    const baseline = { exempt: [{ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" }], offenders: [] };
    expect(worseningsOf({ regressions: regressionsOf({ baseline, current }) })).toEqual([]);
  });

  it("holds a path to the TIGHTEST count either half ever recorded, never the looser one", () => {
    const current = [size({ codeLines: 700, path: "src/a.ts" })];
    const baseline = {
      exempt: [{ codeLines: 900, path: "src/a.ts" }],
      offenders: [{ codeLines: 650, path: "src/a.ts" }],
    };
    expect(worseningsOf({ regressions: regressionsOf({ baseline, current }) }).map((one) => one.tightestFloor)).toEqual(
      [650],
    );
  });
});
