import { describe, expect, it } from "vitest";
import { laneVerdictLine } from "../../../../devLint/lintVerdict.js";

const SEAT_UNCOVERED = ["named-object-params", "knip", "whole-tree oxlint", "typecheck"];

describe("laneVerdictLine", () => {
  it("says PASS and nothing else when the lane ran the whole plan", () => {
    expect(
      laneVerdictLine({ lane: "full", laneScope: { ran: 63, total: 63 }, ok: true, uncovered: [], withheld: [] }),
    ).toBe("dev lint: PASS");
  });

  it("says FAIL and nothing else when the lane ran the whole plan", () => {
    expect(
      laneVerdictLine({ lane: "full", laneScope: { ran: 63, total: 63 }, ok: false, uncovered: [], withheld: [] }),
    ).toBe("dev lint: FAIL");
  });

  it("counts what a green did NOT cover, so a local PASS is never read as the whole bar", () => {
    expect(
      laneVerdictLine({ lane: "local", laneScope: { ran: 5, total: 63 }, ok: true, uncovered: [], withheld: [] }),
    ).toBe(
      "dev lint: PASS — this lane ran 5 of 63 gates. The other 58 are CI's: watch `build` with " +
        "`slopweaver github checks --wait`, and read a red leg with `--log`.",
    );
  });

  it("carries the same gap on a FAIL, so a red local lane is not read as the whole bar either", () => {
    expect(
      laneVerdictLine({ lane: "local", laneScope: { ran: 5, total: 63 }, ok: false, uncovered: [], withheld: [] }),
    ).toBe(
      "dev lint: FAIL — this lane ran 5 of 63 gates. The other 58 are CI's: watch `build` with " +
        "`slopweaver github checks --wait`, and read a red leg with `--log`.",
    );
  });

  it("stays one sentence at the real lane's real size rather than naming 58 gates", () => {
    expect(
      laneVerdictLine({ lane: "local", laneScope: { ran: 5, total: 63 }, ok: true, uncovered: [], withheld: [] }).split(
        "\n",
      ),
    ).toHaveLength(1);
  });

  it("names every gate a seat PASS did not cover, so a seat green is never read as the whole bar", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        laneScope: { ran: 60, total: 63 },
        ok: true,
        uncovered: SEAT_UNCOVERED,
        withheld: [],
      }),
    ).toBe(
      "dev lint: PASS — the seat lane ran 60 of 63 gates and did NOT cover: named-object-params, knip, " +
        "whole-tree oxlint, typecheck. CI, or `slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });

  // The supervisor's condition: a seat lane that withheld oxlint must never print a clean PASS.
  it("says INCOMPLETE, naming the withheld gate, when every gate that ran passed but one was withheld", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        laneScope: { ran: 60, total: 63 },
        ok: true,
        uncovered: SEAT_UNCOVERED,
        withheld: ["oxlint"],
      }),
    ).toBe(
      "dev lint: INCOMPLETE (oxlint NOT run: withheld, the reason is above) — the seat lane ran 60 of 63 gates and " +
        "did NOT cover: named-object-params, knip, whole-tree oxlint, typecheck. CI, or `slopweaver github lap` " +
        "where hosted Actions are off, runs them.",
    );
  });

  it("still says FAIL when a gate that ran failed beside a withheld one", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        laneScope: { ran: 60, total: 63 },
        ok: false,
        uncovered: SEAT_UNCOVERED,
        withheld: ["oxlint"],
      }),
    ).toBe(
      "dev lint: FAIL — the seat lane ran 60 of 63 gates and did NOT cover: named-object-params, knip, " +
        "whole-tree oxlint, typecheck. CI, or `slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });

  it("names the same gap on a seat FAIL", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        laneScope: { ran: 60, total: 63 },
        ok: false,
        uncovered: SEAT_UNCOVERED,
        withheld: [],
      }),
    ).toBe(
      "dev lint: FAIL — the seat lane ran 60 of 63 gates and did NOT cover: named-object-params, knip, " +
        "whole-tree oxlint, typecheck. CI, or `slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });
});
