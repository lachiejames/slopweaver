import { describe, expect, it } from "vitest";
import { type FileSize, fileSizeOf, hasRetiredRegisterMarker } from "../../../devLint/fileSizeMeasure.js";
import { baselineOf, parseBaselineJson, regressionsOf, worseningsOf } from "../../../devLint/fileSizeRatchet.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { size } from "./fileSizeFixture.js";

describe("parseBaselineJson", () => {
  it("decodes a baseline carrying both halves", () => {
    const text =
      '{"offenders": [{"path": "src/a.ts", "codeLines": 900}], "exempt": [{"path": "src/g.ts", "codeLines": 1859}]}';
    expect(unwrap(parseBaselineJson({ text }))).toEqual({
      exempt: [{ codeLines: 1859, path: "src/g.ts" }],
      offenders: [{ codeLines: 900, path: "src/a.ts" }],
    });
  });

  it("defaults exempt to empty, so a floor written before the exempt field still decodes", () => {
    const result = parseBaselineJson({ text: '{"offenders": [{"path": "src/a.ts", "codeLines": 900}]}' });
    expect(unwrap(result).exempt).toEqual([]);
  });

  it("rejects invalid JSON, naming the file it could not parse", () => {
    expect(unwrapErr(parseBaselineJson({ text: "not json" })).message).toBe("file-size baseline: invalid JSON");
  });

  it("rejects a missing offenders field, naming the shape it wanted", () => {
    expect(unwrapErr(parseBaselineJson({ text: "{}" })).message).toBe(
      "file-size baseline: unexpected shape (expected { offenders: [{ path, codeLines }], exempt: [{ path, codeLines }] })",
    );
  });
});

describe("baselineOf", () => {
  const measured = (over: Partial<FileSize> & { path: string }): FileSize => ({
    codeLines: 400,
    exempt: false,
    exemptMarker: false,
    rawLines: 480,
    registerMarker: false,
    ...over,
  });

  it("sends an exempt file to the exempt array and an ordinary one to offenders", () => {
    const written = baselineOf({
      current: [measured({ path: "src/a.ts" }), measured({ codeLines: 1859, exempt: true, path: "src/gen.ts" })],
    });
    expect(written.offenders).toEqual([{ codeLines: 400, path: "src/a.ts" }]);
    expect(written.exempt).toEqual([{ codeLines: 1859, path: "src/gen.ts" }]);
  });

  it("writes the CODE-line count, never the raw one, so the floor and the cap read one number", () => {
    const written = baselineOf({ current: [measured({ codeLines: 301, path: "src/a.ts", rawLines: 999 })] });
    expect(written.offenders).toEqual([{ codeLines: 301, path: "src/a.ts" }]);
  });

  it("writes two empty arrays for an empty tree, rather than omitting either half", () => {
    expect(baselineOf({ current: [] })).toEqual({ exempt: [], offenders: [] });
  });
});

describe("the retired REGISTER marker raises and exempts nothing — the owner's ruling", () => {
  it("is detected whether or not it carries a reason, since it is refused by name either way", () => {
    expect(
      hasRetiredRegisterMarker({ content: "// max-file-lines-register: the table IS the length\nconst a = 1;" }),
    ).toBe(true);
    expect(hasRetiredRegisterMarker({ content: "// max-file-lines-register:   \nconst a = 1;" })).toBe(true);
    expect(hasRetiredRegisterMarker({ content: "/* max-file-lines-register: */\nconst a = 1;" })).toBe(true);
  });

  it("is not fired by the plain exemption marker, so the two words stay different findings", () => {
    expect(hasRetiredRegisterMarker({ content: "// max-file-lines-exempt: a generated surface\nconst a = 1;" })).toBe(
      false,
    );
  });

  it("is NOT exempt from the cap, so a register measures like any other file", () => {
    const content = "// max-file-lines-register: the table IS the length\nconst a = 1;\nconst b = 2;";
    expect(fileSizeOf({ approvedTradeoffPaths: new Set(), content, path: "src/devLint/journalledIds.ts" })).toEqual({
      codeLines: 2,
      exempt: false,
      exemptMarker: false,
      path: "src/devLint/journalledIds.ts",
      rawLines: 2,
      registerMarker: true,
    });
  });

  it("STILL reddens an ordinary lap when it grows, now as an ordinary offender", () => {
    const current = [size({ codeLines: 700, path: "src/devLint/refusal/declarations.ts", registerMarker: true })];
    const baseline = { exempt: [{ codeLines: 689, path: "src/devLint/refusal/declarations.ts" }], offenders: [] };
    expect(regressionsOf({ baseline, current })).toEqual([
      {
        codeLines: 700,
        exempt: false,
        path: "src/devLint/refusal/declarations.ts",
        rawLines: 710,
        tightestFloor: 689,
      },
    ]);
  });

  it("is refused by --rebaseline like any other growth, against the ceiling it once held", () => {
    const regressions = regressionsOf({
      baseline: { exempt: [{ codeLines: 689, path: "src/devLint/refusal/declarations.ts" }], offenders: [] },
      current: [size({ codeLines: 700, path: "src/devLint/refusal/declarations.ts", registerMarker: true })],
    });
    expect(worseningsOf({ regressions })).toEqual([
      {
        codeLines: 700,
        exempt: false,
        path: "src/devLint/refusal/declarations.ts",
        rawLines: 710,
        tightestFloor: 689,
      },
    ]);
  });

  it("does NOT widen the budget of a merely exempt file — the 1,859-line case", () => {
    const regressions = regressionsOf({
      baseline: { exempt: [{ codeLines: 1859, path: "src/atlas/slackApi/browser.ts" }], offenders: [] },
      current: [size({ codeLines: 1860, exempt: true, path: "src/atlas/slackApi/browser.ts" })],
    });
    expect(worseningsOf({ regressions })).toEqual([
      {
        codeLines: 1860,
        exempt: true,
        path: "src/atlas/slackApi/browser.ts",
        rawLines: 1870,
        tightestFloor: 1859,
      },
    ]);
  });
});

describe("the seam between the marker and the FLOOR — its two cases", () => {
  it("REFUSES a raise on a path the offenders half still holds, so no marker is a way out of debt", () => {
    const regressions = regressionsOf({
      baseline: { exempt: [], offenders: [{ codeLines: 400, path: "src/example.ts" }] },
      current: [size({ codeLines: 500, path: "src/example.ts", registerMarker: true })],
    });
    expect(worseningsOf({ regressions })).toEqual([
      {
        codeLines: 500,
        exempt: false,
        path: "src/example.ts",
        rawLines: 510,
        tightestFloor: 400,
      },
    ]);
  });

  it("reads the tightest floor across BOTH halves, so a path in each is held to the smaller", () => {
    const regressions = regressionsOf({
      baseline: {
        exempt: [{ codeLines: 700, path: "src/example.ts" }],
        offenders: [{ codeLines: 400, path: "src/example.ts" }],
      },
      current: [size({ codeLines: 500, exempt: true, path: "src/example.ts" })],
    });
    expect(regressions[0]!.tightestFloor).toBe(400);
    expect(worseningsOf({ regressions })).toHaveLength(1);
  });

  it("records a path the floor never held, marker or not — the marker is its own finding, not this one", () => {
    const plain = regressionsOf({
      baseline: { exempt: [], offenders: [] },
      current: [size({ codeLines: 500, path: "src/new.ts" })],
    });
    const registered = regressionsOf({
      baseline: { exempt: [], offenders: [] },
      current: [size({ codeLines: 500, path: "src/newRegister.ts", registerMarker: true })],
    });
    expect(worseningsOf({ regressions: plain })).toEqual([]);
    expect(worseningsOf({ regressions: registered })).toEqual([]);
  });
});
