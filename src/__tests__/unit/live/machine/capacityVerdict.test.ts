import { describe, expect, it } from "vitest";

import { renderVerdict, subjectsOf, verdictSummary } from "../../../../live/machine/capacityVerdict.js";

const NO_HIDDEN = {
  busyCores: undefined,
  hiddenFromTop: [],
  idlePct: undefined,
  unattributedCores: undefined,
  visibleCores: undefined,
};

describe("subjectsOf", () => {
  it("names each subject once, in memory-cpu-boots-disk order whatever order the crossings came in", () => {
    const reasons = [
      { subject: "disk", text: "d" },
      { subject: "boots", text: "b" },
      { subject: "cpu", text: "c" },
      { subject: "memory", text: "m" },
      { subject: "cpu", text: "c2" },
    ] as const;
    expect(subjectsOf({ reasons })).toEqual(["memory", "cpu", "boots", "disk"]);
  });

  it("is empty with no crossings", () => {
    expect(subjectsOf({ reasons: [] })).toEqual([]);
  });
});

describe("verdictSummary", () => {
  it("says unmeasured for every reading it lacks", () => {
    expect(
      verdictSummary({
        compressor: undefined,
        hiddenCpu: NO_HIDDEN,
        load: undefined,
        swap: undefined,
        swapfileCount: undefined,
        topForeign: undefined,
      }),
    ).toBe(
      "load unmeasured · idle unmeasured · no foreign process observed · swap unmeasured · compressor unmeasured · swapfiles uncounted",
    );
  });

  it("prints the load and top's idle percentage side by side when both were read", () => {
    expect(
      verdictSummary({
        compressor: undefined,
        hiddenCpu: { ...NO_HIDDEN, idlePct: 40 },
        load: { load1: 46.5, load15: 30, load5: 40 },
        swap: undefined,
        swapfileCount: undefined,
        topForeign: undefined,
      }),
    ).toBe(
      "1-min load 46.5 · 40% idle · no foreign process observed · swap unmeasured · compressor unmeasured · swapfiles uncounted",
    );
  });
});

describe("renderVerdict", () => {
  it("leads with HOLD, appends ALERT, names the ungraded subject and the culprit", () => {
    expect(
      renderVerdict({
        alerts: [{ subject: "memory", text: "swap 5 GB" }],
        culprit: { endedBy: "seat", kill: "kill 1", subject: "session abc", why: "40 processes" },
        graded: ["memory", "cpu"],
        holds: [
          { subject: "cpu", text: "load 30" },
          { subject: "boots", text: "3 booting" },
        ],
        summary: "tail",
        ungraded: ["cpu"],
      }),
    ).toBe(
      "machine capacity: HOLD on cpu and boots (load 30; 3 booting) · ALERT on memory (swap 5 GB) · cpu UNGRADED · SUBJECT session abc — 40 processes; end it with `kill 1` — tail",
    );
  });

  it("says ok on what it graded when nothing crossed", () => {
    expect(
      renderVerdict({ alerts: [], culprit: undefined, graded: ["memory"], holds: [], summary: "s", ungraded: [] }),
    ).toBe("machine capacity: ok on memory — s");
  });

  it("says graded nothing rather than ok when nothing was readable", () => {
    expect(renderVerdict({ alerts: [], culprit: undefined, graded: [], holds: [], summary: "s", ungraded: [] })).toBe(
      "machine capacity: graded nothing — s",
    );
  });
});
