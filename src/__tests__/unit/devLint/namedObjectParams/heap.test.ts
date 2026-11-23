/*
 * The named-object-params heap report lines: the live heap against its budget, one line per phase, and the
 * in-scope and vendored mix of what the Program loaded.
 */
import { describe, expect, it } from "vitest";

import { fileMixLine, heapBudgetReport, phaseLine } from "../../../../devLint/namedObjectParamsHeap.js";

describe("heapBudgetReport", () => {
  it("reports a live heap under the budget as within it", () => {
    expect(heapBudgetReport({ budgetMib: 2200, liveMib: 2033 })).toEqual({
      line: "live heap 2033 MiB of a 2200 MiB budget",
      overBudget: false,
    });
  });

  it("treats a live heap exactly at the budget as within it — the budget is a ceiling, not a limit to clear", () => {
    expect(heapBudgetReport({ budgetMib: 2200, liveMib: 2200 })).toEqual({
      line: "live heap 2200 MiB of a 2200 MiB budget",
      overBudget: false,
    });
  });

  it("busts on a single MiB over — the ratchet is what makes the next ceiling visible early", () => {
    expect(heapBudgetReport({ budgetMib: 2200, liveMib: 2201 })).toEqual({
      line: "live heap 2201 MiB of a 2200 MiB budget",
      overBudget: true,
    });
  });

  it("reports an unmeasured heap as unchecked rather than as a pass", () => {
    expect(heapBudgetReport({ budgetMib: 2200, liveMib: undefined })).toEqual({
      line: "live heap not measured (no --expose-gc), budget 2200 MiB unchecked",
      overBudget: false,
    });
  });

  it("reports a zero live heap as within budget rather than as unmeasured", () => {
    expect(heapBudgetReport({ budgetMib: 2200, liveMib: 0 })).toEqual({
      line: "live heap 0 MiB of a 2200 MiB budget",
      overBudget: false,
    });
  });
});

describe("phaseLine", () => {
  it("pads the label so successive phases line up in a column", () => {
    expect(phaseLine({ label: "createProgram", liveMib: 1526 })).toBe(
      "named-object-params phase: createProgram        1526 MiB",
    );
  });

  it("names a phase whose heap could not be measured rather than printing a bare number", () => {
    expect(phaseLine({ label: "rule scan", liveMib: undefined })).toBe(
      "named-object-params phase: rule scan            unmeasured (no --expose-gc)",
    );
  });

  it("keeps a label longer than the column width intact rather than truncating it", () => {
    expect(phaseLine({ label: "a-label-past-the-column-width", liveMib: 1 })).toBe(
      "named-object-params phase: a-label-past-the-column-width 1 MiB",
    );
  });
});

describe("fileMixLine", () => {
  it("splits what the program loaded into in-scope and vendored, sizing the in-scope text this process holds", () => {
    const own = { text: "x".repeat(2 * 1024 * 1024) };
    expect(fileMixLine({ inScope: [own], loaded: ["/repo/src/a.ts", "/repo/node_modules/dep/index.d.ts"] })).toBe(
      "named-object-params files: loaded 2, in-scope 1 (2 MiB text), vendored 1",
    );
  });

  it("counts a loaded file that is neither in-scope nor vendored in the total alone", () => {
    expect(fileMixLine({ inScope: [{ text: "x" }], loaded: ["/repo/src/a.ts", "/ts/lib/lib.esnext.d.ts"] })).toBe(
      "named-object-params files: loaded 2, in-scope 1 (0 MiB text), vendored 0",
    );
  });

  it("reports an empty program as zeroes rather than failing", () => {
    expect(fileMixLine({ inScope: [], loaded: [] })).toBe(
      "named-object-params files: loaded 0, in-scope 0 (0 MiB text), vendored 0",
    );
  });
});
