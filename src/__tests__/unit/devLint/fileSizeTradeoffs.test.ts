/*
 * The tradeoff register and the marker findings `file-size-ratchet` raises from it — the rule that
 * oversized files are always split, so the exemption marker exempts nothing without a signed row and the register
 * marker is retired.
 */
import { describe, expect, it } from "vitest";
import { fileSizeOf, offendersOf } from "../../../devLint/fileSizeMeasure.js";
import { baselineOf, regressionsOf, worseningsOf } from "../../../devLint/fileSizeRatchet.js";
import {
  fileSizeTradeoffDebtOf,
  parseFileSizeTradeoffsJson,
  TRADEOFF_FILE,
  tradeoffFindingsOf,
} from "../../../devLint/fileSizeTradeoffs.js";
import { lintDeclarationFor } from "../../../devLint/refusal/registry.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NONE: ReadonlySet<string> = new Set();
const EXEMPT_LINE = "// max-file-lines-exempt: a domain error union\n";
const REGISTER_LINE = "// max-file-lines-register: the table IS the length\n";
const body = ({ lines }: { lines: number }): string => "const a = 1;\n".repeat(lines);
const signed = { ownerApproval: "talk:abc#turn_1", path: "src/errors.ts", tradeoff: "one union, one factory" };

describe("an exemption marker with no signed row exempts nothing", () => {
  it("measures a 301-line marked file as an ordinary offender, so the size ratchet refuses it as new", () => {
    const measured = fileSizeOf({
      approvedTradeoffPaths: NONE,
      content: EXEMPT_LINE + body({ lines: 301 }),
      path: "src/x.ts",
    });
    expect(measured).toEqual({
      codeLines: 301,
      exempt: false,
      exemptMarker: true,
      path: "src/x.ts",
      rawLines: 302,
      registerMarker: false,
    });
    const regressions = regressionsOf({
      baseline: { exempt: [], offenders: [] },
      current: offendersOf({ sizes: [measured] }),
    });
    expect(regressions.map((one) => [one.path, one.exempt, one.tightestFloor])).toEqual([
      ["src/x.ts", false, undefined],
    ]);
  });

  it("exempts the same file once the register holds its row", () => {
    const approved = new Set(["src/x.ts"]);
    const measured = fileSizeOf({
      approvedTradeoffPaths: approved,
      content: EXEMPT_LINE + body({ lines: 301 }),
      path: "src/x.ts",
    });
    expect(measured.exempt).toBe(true);
    expect(baselineOf({ current: offendersOf({ sizes: [measured] }) })).toEqual({
      exempt: [{ codeLines: 301, path: "src/x.ts" }],
      offenders: [],
    });
  });

  it("does not exempt an unmarked file just because a row names it", () => {
    const approved = new Set(["src/x.ts"]);
    expect(
      fileSizeOf({ approvedTradeoffPaths: approved, content: body({ lines: 301 }), path: "src/x.ts" }).exempt,
    ).toBe(false);
  });

  it("never exempts a test file, row or not", () => {
    const path = "src/__tests__/unit/a.test.ts";
    const measured = fileSizeOf({
      approvedTradeoffPaths: new Set([path]),
      content: EXEMPT_LINE + body({ lines: 501 }),
      path,
    });
    expect([measured.exempt, measured.exemptMarker]).toEqual([false, true]);
  });
});

describe("the retired register marker exempts and raises nothing", () => {
  it("measures a register-marked file as an ordinary one, so --rebaseline refuses its growth", () => {
    const measured = fileSizeOf({
      approvedTradeoffPaths: NONE,
      content: REGISTER_LINE + body({ lines: 700 }),
      path: "src/r.ts",
    });
    expect([measured.exempt, measured.registerMarker]).toEqual([false, true]);
    const regressions = regressionsOf({
      baseline: { exempt: [{ codeLines: 689, path: "src/r.ts" }], offenders: [] },
      current: offendersOf({ sizes: [measured] }),
    });
    expect(worseningsOf({ regressions }).map((one) => [one.path, one.tightestFloor])).toEqual([["src/r.ts", 689]]);
  });
});

describe("parseFileSizeTradeoffsJson", () => {
  it("decodes the empty register it ships with", () => {
    expect(unwrap(parseFileSizeTradeoffsJson({ text: '{"tradeoffs": []}' }))).toEqual({ tradeoffs: [] });
  });

  it("decodes a signed row", () => {
    const text = JSON.stringify({ tradeoffs: [signed] });
    expect(unwrap(parseFileSizeTradeoffsJson({ text })).tradeoffs).toEqual([signed]);
  });

  it("refuses a row with a blank anchor, so a row cannot stand in for the owner's yes", () => {
    const text = JSON.stringify({ tradeoffs: [{ ...signed, ownerApproval: "  " }] });
    expect(unwrapErr(parseFileSizeTradeoffsJson({ text })).code).toBe("BASELINE_SHAPE_INVALID");
  });

  it("refuses two rows for one path", () => {
    const text = JSON.stringify({ tradeoffs: [signed, { ...signed, tradeoff: "another" }] });
    expect(unwrapErr(parseFileSizeTradeoffsJson({ text })).message).toBe(
      "file-size tradeoffs: src/errors.ts has more than one row, and one file has one recorded tradeoff",
    );
  });

  it("refuses invalid JSON, naming the register", () => {
    expect(unwrapErr(parseFileSizeTradeoffsJson({ text: "not json" })).message).toBe(
      "file-size tradeoffs: invalid JSON",
    );
  });
});

describe("fileSizeTradeoffDebtOf", () => {
  const measure = ({ path, content }: { path: string; content: string }) =>
    fileSizeOf({ approvedTradeoffPaths: NONE, content, path });

  it("is empty for a clean tree and an empty register", () => {
    const files = [measure({ content: body({ lines: 3 }), path: "src/a.ts" })];
    expect(fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [] } })).toEqual({
      retiredMarkers: [],
      stale: [],
      unrecorded: [],
    });
  });

  it("finds an unrecorded marker on an UNDER-cap file too, so it cannot wait for the file to grow", () => {
    const files = [measure({ content: EXEMPT_LINE + body({ lines: 3 }), path: "src/b.ts" })];
    expect(fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [] } }).unrecorded).toEqual(["src/b.ts"]);
  });

  it("clears a marker whose row is in the register", () => {
    const files = [measure({ content: EXEMPT_LINE + body({ lines: 3 }), path: "src/errors.ts" })];
    expect(fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [signed] } })).toEqual({
      retiredMarkers: [],
      stale: [],
      unrecorded: [],
    });
  });

  it("finds a stale row whose file lost its marker or is gone", () => {
    const files = [measure({ content: body({ lines: 3 }), path: "src/errors.ts" })];
    const gone = { ...signed, path: "src/gone.ts" };
    expect(fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [gone, signed] } }).stale).toEqual([
      "src/errors.ts",
      "src/gone.ts",
    ]);
  });

  it("refuses a test file's marker even with a row, since a test file is never exempt", () => {
    const path = "src/__tests__/unit/a.test.ts";
    const files = [measure({ content: EXEMPT_LINE + body({ lines: 3 }), path })];
    const debt = fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [{ ...signed, path }] } });
    expect([debt.unrecorded, debt.stale]).toEqual([[path], []]);
  });

  it("refuses a marker on a GENERATED file with no row, though the header already exempts it", () => {
    const files = [
      measure({ content: `// GENERATED — do not hand-edit\n${EXEMPT_LINE}${body({ lines: 3 })}`, path: "src/g.ts" }),
    ];
    expect(files[0]!.exempt).toBe(true);
    expect(fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [] } }).unrecorded).toEqual(["src/g.ts"]);
  });

  it("finds every retired register marker, sorted, whatever the file's size", () => {
    const files = [
      measure({ content: REGISTER_LINE + body({ lines: 3 }), path: "src/z.ts" }),
      measure({ content: "/* max-file-lines-register: */\nconst a = 1;\n", path: "src/y.ts" }),
    ];
    expect(fileSizeTradeoffDebtOf({ files, tradeoffs: { tradeoffs: [] } }).retiredMarkers).toEqual([
      "src/y.ts",
      "src/z.ts",
    ]);
  });
});

describe("tradeoffFindingsOf", () => {
  it("finds nothing to print when every marker and row holds", () => {
    expect(tradeoffFindingsOf({ debt: { retiredMarkers: [], stale: [], unrecorded: [] } })).toEqual([]);
  });

  it("groups each kind under its refusal id, unrecorded before retired before stale", () => {
    const findings = tradeoffFindingsOf({
      debt: { retiredMarkers: ["src/devLint/journalledIds.ts"], stale: ["src/gone.ts"], unrecorded: ["src/b.ts"] },
    });
    expect(findings).toEqual([
      {
        id: "file-size-ratchet-unrecorded-tradeoff",
        paths: ["src/b.ts"],
        says: `an exemption marker with no row in ${TRADEOFF_FILE}, which exempts nothing`,
      },
      {
        id: "file-size-ratchet-retired-marker",
        paths: ["src/devLint/journalledIds.ts"],
        says: "declares the retired register marker",
      },
      {
        id: "file-size-ratchet-debt",
        paths: ["src/gone.ts"],
        says: `a row in ${TRADEOFF_FILE} whose file is gone or declares no exemption marker`,
      },
    ]);
  });

  it("leaves out a kind with no path, so only a real finding prints a refusal", () => {
    const findings = tradeoffFindingsOf({ debt: { retiredMarkers: ["src/r.ts"], stale: [], unrecorded: [] } });
    expect(findings.map((one) => one.id)).toEqual(["file-size-ratchet-retired-marker"]);
  });

  it("refuses under declarations that say what each new finding caught", () => {
    expect(lintDeclarationFor({ id: "file-size-ratchet-unrecorded-tradeoff" }).caught).toContain(
      "declares the exemption marker but the committed tradeoff register holds no row",
    );
    expect(lintDeclarationFor({ id: "file-size-ratchet-retired-marker" }).caught).toContain(
      "declares the retired register marker, which no longer raises or exempts anything",
    );
  });
});
