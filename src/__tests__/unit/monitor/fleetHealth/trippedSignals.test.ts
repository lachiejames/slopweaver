/*
 * `fleet-unhealthy`'s `trippedSignals`: the failing share that trips syncs, the floor of three failures, deaths
 * tripping at two on their own, and the listener tripping bot in key order after the job signals.
 */
import { describe, expect, it } from "vitest";

import { trippedSignals } from "../../../../monitor/fleetHealth.js";

describe("trippedSignals", () => {
  const tally = ({ succeeded, failing, died }: { succeeded: number; failing: number; died: number }) => ({
    died: Array.from({ length: died }, () => "d"),
    failing: Array.from({ length: failing }, () => "f"),
    succeeded,
  });

  it("trips syncs at a quarter failing, and not a run below it", () => {
    expect(trippedSignals({ botDown: false, tally: tally({ died: 0, failing: 3, succeeded: 9 }) })).toEqual(["syncs"]);
    expect(trippedSignals({ botDown: false, tally: tally({ died: 0, failing: 3, succeeded: 10 }) })).toEqual([]);
  });

  it("never trips syncs on fewer than three failures, whatever the share", () => {
    expect(trippedSignals({ botDown: false, tally: tally({ died: 0, failing: 2, succeeded: 0 }) })).toEqual([]);
  });

  it("trips deaths at two, on its own, and counts them toward the failing share", () => {
    expect(trippedSignals({ botDown: false, tally: tally({ died: 1, failing: 0, succeeded: 50 }) })).toEqual([]);
    expect(trippedSignals({ botDown: false, tally: tally({ died: 2, failing: 0, succeeded: 50 }) })).toEqual([
      "deaths",
    ]);
    expect(trippedSignals({ botDown: false, tally: tally({ died: 2, failing: 1, succeeded: 9 }) })).toEqual([
      "syncs",
      "deaths",
    ]);
  });

  it("trips bot on the listener alone, in key order after the job signals", () => {
    expect(trippedSignals({ botDown: true, tally: tally({ died: 2, failing: 3, succeeded: 0 }) })).toEqual([
      "syncs",
      "deaths",
      "bot",
    ]);
    expect(trippedSignals({ botDown: true, tally: tally({ died: 0, failing: 0, succeeded: 0 }) })).toEqual(["bot"]);
  });
});
