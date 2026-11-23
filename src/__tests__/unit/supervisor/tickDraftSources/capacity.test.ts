/** The `machine capacity --json` document turned into the tick's capacity observation. */
import { describe, expect, it } from "vitest";

import { buildCeilingsReading } from "../../capacity/ceilingsDefaults.js";
import { capacityDocument } from "../tickDraftDocumentsFixture.js";
import { CAPTURED, diagnosticOf, factsOf, redirected, refusalFor, sourcesWith } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — capacity", () => {
  // The fact keys of a report from a build that took none of the optional readings.
  const bareCapacityKeys = (): readonly string[] =>
    Object.keys(factsOf({ observation: sourcesWith({ capture: capacityDocument(), kind: "capacity" }).capacity }));

  it("maps every scalar and keeps the verdict as the verbatim line", () => {
    const sources = sourcesWith({ capture: capacityDocument(), kind: "capacity" });

    expect(sources.capacity.status).toBe("read");
    expect(factsOf({ observation: sources.capacity })).toStrictEqual({
      dispatchBackoffSeconds: 0,
      dispatchCovering: 0,
      dispatchOpen: 0,
      dispatchSubject: "",
      hold: true,
      holdSubjects: ["cpu"],
      load1: 30.93,
      segmentsPct: 15,
      swapfileCount: 5,
      topForeignGb: 5.2,
      topForeignLabel: "mds",
    });
    expect(sources.capacity.witness).toStrictEqual({
      command:
        "read capacity.json, the tick's redirected `slopweaver machine capacity --json` (undated: observed at the caller's --captured instant)",
      exitCode: null,
    });
  });

  it("carries the disk half when the report has one, and leaves the keys OFF when it does not", () => {
    const withDisk = sourcesWith({
      capture: capacityDocument({ diskFreeGb: 72.9, diskHoldFreeGb: 30, diskUsedPct: 93, registeredWorktrees: 872 }),
      kind: "capacity",
    });

    expect(factsOf({ observation: withDisk.capacity })).toStrictEqual({
      diskFreeGb: 72.9,
      diskHoldFreeGb: 30,
      diskUsedPct: 93,
      dispatchBackoffSeconds: 0,
      dispatchCovering: 0,
      dispatchOpen: 0,
      dispatchSubject: "",
      hold: true,
      holdSubjects: ["cpu"],
      load1: 30.93,
      registeredWorktrees: 872,
      segmentsPct: 15,
      swapfileCount: 5,
      topForeignGb: 5.2,
      topForeignLabel: "mds",
    });
    // A report from a build that took no such reading leaves the keys absent, never at zero — a zero here
    // would render as a volume with no space left and 0 worktrees registered.
    const olderKeys = bareCapacityKeys();
    expect(olderKeys).not.toContain("diskFreeGb");
    expect(olderKeys).not.toContain("diskHoldFreeGb");
  });

  it("carries the ceilings reading whole when the report has one, and leaves the key OFF when it does not", () => {
    const ceilings = buildCeilingsReading({
      machine: { hold: true, holdSubjects: ["cpu"], idlePct: null, load1: 30.93, loadHold: 22 },
      observedAtIso: CAPTURED,
      plans: { claude: [], codex: [], codexRoutedAlias: null, problems: ["claude plans: no accounts file"] },
    });
    const sources = sourcesWith({ capture: capacityDocument({ ceilings }), kind: "capacity" });

    expect(factsOf({ observation: sources.capacity }).ceilings).toStrictEqual(ceilings);
    expect(bareCapacityKeys()).not.toContain("ceilings");
  });

  it("carries the load the hold is judged at when the report has one, and leaves the key OFF when it does not", () => {
    const sources = sourcesWith({ capture: capacityDocument({ loadHold: 22 }), kind: "capacity" });

    expect(factsOf({ observation: sources.capacity }).loadHold).toBe(22);
    expect(bareCapacityKeys()).not.toContain("loadHold");
  });

  it("is unavailable — never zero — when the machine could not take a reading", () => {
    const capture = redirected({
      path: "capacity.json",
      value: { hold: false, holdSubjects: [], segmentsPct: 15, swapfileCount: 5, verdict: "machine capacity: ok" },
    });
    const sources = sourcesWith({ capture, kind: "capacity" });

    expect(sources.capacity.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.capacity })).toBe(
      "the report carries no 1-minute load, top foreign process, anomalous-load dispatch register reading, " +
        "so its facts are incomplete: machine capacity: ok",
    );
  });

  it("refuses a document that is not the producer's, naming the flag, the file and the field", () => {
    const refusal = refusalFor({ capture: capacityDocument({ hold: "yes" }), kind: "capacity" });

    expect(refusal[0]).toBe("--capacity capacity.json is not a `slopweaver machine capacity --json` document:");
    expect(refusal[1]).toContain("hold:");
  });
});
