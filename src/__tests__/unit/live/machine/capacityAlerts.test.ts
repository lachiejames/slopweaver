/**
 * Which ALERT thresholds one capacity reading crossed, each as the clause the summary prints — read here on
 * the fleet halves: a dead seat's orphans, a live seat's runaway searches, and a fan-out's calls in flight.
 */
import { describe, expect, it } from "vitest";

import { alertReasons } from "../../../../live/machine/capacityAlerts.js";
import { fleetLoadReading, parseElapsedRows, parseTopCpuRows } from "../../../../live/machine/fleetLoad.js";
import { runawaySearches } from "../../../../live/machine/runawaySearch.js";
import {
  INCIDENT_ETIME_TEXT,
  INCIDENT_PROCESSES,
  INCIDENT_TOP_CPU_TEXT,
  WEDGED_SESSION_ID,
} from "./fleetLoadFixtures.js";
import { RUNAWAY_ETIME_TEXT, RUNAWAY_PROCESSES, RUNAWAY_TOP_CPU_TEXT } from "./runawaySearchFixtures.js";

/** No foreign hog, no session child, no swap: only the fleet halves can fire. */
const QUIET = {
  fleetChildren: [],
  foreignAlertGb: 8,
  parallelCallAlert: 8,
  swap: undefined,
  swapAlertGb: 4,
  topForeign: undefined,
};

/** An empty fleet reading. */
const EMPTY_FLEET = fleetLoadReading({ cpuRows: [], elapsedRows: [], processes: [] });

describe("alertReasons", () => {
  it("raises nothing on a quiet reading", () => {
    expect(alertReasons({ ...QUIET, fleet: EMPTY_FLEET, searches: [] })).toEqual([]);
  });

  it("names the runaway searches by count and summed cost, with the command that ends them", () => {
    const searches = runawaySearches({
      cpuRows: parseTopCpuRows({ text: RUNAWAY_TOP_CPU_TEXT }),
      elapsedRows: parseElapsedRows({ text: RUNAWAY_ETIME_TEXT }),
      processes: RUNAWAY_PROCESSES,
      protectedPids: new Set([900]),
    });
    expect(alertReasons({ ...QUIET, fleet: EMPTY_FLEET, searches })).toEqual([
      { subject: "cpu", text: "2 runaway search(es) inside live seats at 100.3% cpu — slopweaver machine reap" },
    ]);
  });

  it("names the orphans, then the fan-out, in summary order", () => {
    const fleet = fleetLoadReading({
      cpuRows: parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT }),
      elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
      processes: INCIDENT_PROCESSES,
    });
    expect(alertReasons({ ...QUIET, fleet, parallelCallAlert: 2, searches: [] })).toEqual([
      { subject: "cpu", text: "2 orphaned fleet shell(s) from 1 dead seat(s) at 43% cpu — slopweaver machine reap" },
      { subject: "cpu", text: `session ${WEDGED_SESSION_ID} has 3 tool calls in flight, alert at 2` },
    ]);
  });
});
