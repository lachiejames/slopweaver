import { describe, expect, it } from "vitest";
import { laneVerdictLine } from "../../../../devLint/lintVerdict.js";

const SEAT_UNCOVERED = ["named-object-params", "knip", "whole-tree oxlint", "typecheck"];

describe("laneVerdictLine", () => {
  it("says PASS and nothing else when the lane ran the whole plan", () => {
    expect(
      laneVerdictLine({
        lane: "full",
        ok: true,
        partial: false,
        scope: { ran: 63, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe("dev lint: PASS");
  });

  it("says FAIL and nothing else when the lane ran the whole plan", () => {
    expect(
      laneVerdictLine({
        lane: "full",
        ok: false,
        partial: false,
        scope: { ran: 63, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe("dev lint: FAIL");
  });

  it("counts what a green did NOT cover, so a local PASS is never read as the whole bar", () => {
    expect(
      laneVerdictLine({
        lane: "local",
        ok: true,
        partial: false,
        scope: { ran: 5, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe(
      "dev lint: PASS — this lane ran 5 of 63 gates. The other 58 are CI's: watch `build` with " +
        "`slopweaver github checks --wait`, and read a red leg with `--log`.",
    );
  });

  it("carries the same gap on a FAIL, so a red local lane is not read as the whole bar either", () => {
    expect(
      laneVerdictLine({
        lane: "local",
        ok: false,
        partial: false,
        scope: { ran: 5, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe(
      "dev lint: FAIL — this lane ran 5 of 63 gates. The other 58 are CI's: watch `build` with " +
        "`slopweaver github checks --wait`, and read a red leg with `--log`.",
    );
  });

  it("stays one sentence at the real lane's real size rather than naming 58 gates", () => {
    expect(
      laneVerdictLine({
        lane: "local",
        ok: true,
        partial: false,
        scope: { ran: 5, total: 63 },
        uncovered: [],
        withheld: [],
      }).split("\n"),
    ).toHaveLength(1);
  });

  it("names every gate a seat PASS did not cover, so a seat green is never read as the whole bar", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        ok: true,
        partial: false,
        scope: { ran: 60, total: 63 },
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
        ok: true,
        partial: false,
        scope: { ran: 60, total: 63 },
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
        ok: false,
        partial: false,
        scope: { ran: 60, total: 63 },
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
        ok: false,
        partial: false,
        scope: { ran: 60, total: 63 },
        uncovered: SEAT_UNCOVERED,
        withheld: [],
      }),
    ).toBe(
      "dev lint: FAIL — the seat lane ran 60 of 63 gates and did NOT cover: named-object-params, knip, " +
        "whole-tree oxlint, typecheck. CI, or `slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });
});

// FLEET FINDING: `dev lint --lane seat --only no-python` closed on "PASS — the seat lane ran 89 of 92 gates",
// one line under the scope line saying it ran 1. A narrowed verdict counts the run, never the lane.
describe("laneVerdictLine on a narrowed run", () => {
  it("counts the one gate a narrowed seat PASS ran, never the seat lane's own scope", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        ok: true,
        partial: true,
        scope: { ran: 1, total: 92 },
        uncovered: SEAT_UNCOVERED,
        withheld: [],
      }),
    ).toBe(
      "dev lint: PASS — this narrowed seat run ran 1 of 92 gates. The seat lane did NOT cover: named-object-params, " +
        "knip, whole-tree oxlint, typecheck. CI, or `slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });

  it("carries the same count on a narrowed seat FAIL", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        ok: false,
        partial: true,
        scope: { ran: 2, total: 92 },
        uncovered: SEAT_UNCOVERED,
        withheld: [],
      }),
    ).toBe(
      "dev lint: FAIL — this narrowed seat run ran 2 of 92 gates. The seat lane did NOT cover: named-object-params, " +
        "knip, whole-tree oxlint, typecheck. CI, or `slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });

  it("says INCOMPLETE on a narrowed seat run that withheld the gate it was asked for", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        ok: true,
        partial: true,
        scope: { ran: 1, total: 92 },
        uncovered: SEAT_UNCOVERED,
        withheld: ["oxlint"],
      }),
    ).toBe(
      "dev lint: INCOMPLETE (oxlint NOT run: withheld, the reason is above) — this narrowed seat run ran 1 of 92 " +
        "gates. The seat lane did NOT cover: named-object-params, knip, whole-tree oxlint, typecheck. CI, or " +
        "`slopweaver github lap` where hosted Actions are off, runs them.",
    );
  });

  it("never says the rest are CI's on a narrowed local run, since some it skipped are local", () => {
    expect(
      laneVerdictLine({
        lane: "local",
        ok: true,
        partial: true,
        scope: { ran: 1, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe(
      "dev lint: PASS — this narrowed local run ran 1 of 63 gates. Gates outside the local lane are CI's: watch " +
        "`build` with `slopweaver github checks --wait`, and read a red leg with `--log`.",
    );
  });

  it("carries the same count on a narrowed local FAIL", () => {
    expect(
      laneVerdictLine({
        lane: "local",
        ok: false,
        partial: true,
        scope: { ran: 1, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe(
      "dev lint: FAIL — this narrowed local run ran 1 of 63 gates. Gates outside the local lane are CI's: watch " +
        "`build` with `slopweaver github checks --wait`, and read a red leg with `--log`.",
    );
  });

  it("is no longer a bare PASS on a narrowed full-lane run", () => {
    expect(
      laneVerdictLine({
        lane: "full",
        ok: true,
        partial: true,
        scope: { ran: 2, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe("dev lint: PASS — this narrowed run ran 2 of 63 gates.");
  });

  it("is no longer a bare FAIL on a narrowed full-lane run", () => {
    expect(
      laneVerdictLine({
        lane: "full",
        ok: false,
        partial: true,
        scope: { ran: 2, total: 63 },
        uncovered: [],
        withheld: [],
      }),
    ).toBe("dev lint: FAIL — this narrowed run ran 2 of 63 gates.");
  });

  it("stays one line on a narrowed seat run naming every uncovered gate", () => {
    expect(
      laneVerdictLine({
        lane: "seat",
        ok: true,
        partial: true,
        scope: { ran: 1, total: 92 },
        uncovered: SEAT_UNCOVERED,
        withheld: [],
      }).split("\n"),
    ).toHaveLength(1);
  });
});
