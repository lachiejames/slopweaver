/**
 * `orgHealth/acknowledgement.ts` — the owner can acknowledge a page. An acknowledgement holds
 * until the incident moves, and only the newest press for an incident counts.
 */
import { describe, expect, it } from "vitest";

import {
  type AcknowledgementRow,
  acknowledgementOf,
  acknowledgementRowFor,
  acknowledgementRowOf,
  acknowledgementsOf,
} from "../../../orgHealth/acknowledgement.js";
import { orgIncident } from "./orgIncidentFixture.js";

/** When the owner pressed, in every row here. */
const PRESSED = "2026-10-06T11:31:00.000Z";

/** The row a press on the fixture incident writes. */
const ROW: AcknowledgementRow = acknowledgementRowFor({
  acknowledgedIso: PRESSED,
  bySession: "work-console",
  incident: orgIncident(),
});

describe("acknowledgementRowFor", () => {
  it("takes the whole fingerprint off the incident, and null for one that never paged", () => {
    expect([
      ROW,
      acknowledgementRowFor({
        acknowledgedIso: PRESSED,
        bySession: "terminal",
        incident: orgIncident({ over: { loud: undefined } }),
      }).loudIso,
    ]).toEqual([
      {
        acknowledgedIso: PRESSED,
        bySession: "work-console",
        loudIso: "2026-10-04T08:00:00.000Z",
        phase: "investigating",
        phaseChangedIso: "2026-10-04T08:00:00.000Z",
        ref: "INC-98",
        severity: "Critical",
      },
      null,
    ]);
  });
});

describe("acknowledgementRowOf", () => {
  it("reads a row back, and refuses an extra field, a bad reference, an unknown phase or a missing instant", () => {
    const { acknowledgedIso: _dropped, ...noInstant } = ROW;
    expect([
      acknowledgementRowOf({ value: ROW }),
      acknowledgementRowOf({ value: { ...ROW, note: "x" } }),
      acknowledgementRowOf({ value: { ...ROW, ref: "34" } }),
      acknowledgementRowOf({ value: { ...ROW, phase: "fixing" } }),
      acknowledgementRowOf({ value: noInstant }),
    ]).toEqual([ROW, undefined, undefined, undefined, undefined]);
  });
});

describe("acknowledgementOf", () => {
  it("is acknowledged while the incident has not moved, an update with no move included", () => {
    const updated = orgIncident({
      over: {
        lastUpdate: { author: "Mandy", iso: "2026-10-07T00:00:00.000Z", status: "Investigating", text: "still on it" },
      },
    });
    expect([
      acknowledgementOf({ incident: orgIncident(), rows: [ROW] }),
      acknowledgementOf({ incident: updated, rows: [ROW] }),
    ]).toEqual([
      { atIso: PRESSED, state: "acknowledged" },
      { atIso: PRESSED, state: "acknowledged" },
    ]);
  });

  it("lapses on a severity change, a phase move, a move away and back, and a reopening", () => {
    const moved = [
      orgIncident({ over: { severity: "Major" } }),
      orgIncident({ over: { phase: "identified", status: "Fixing" } }),
      orgIncident({ over: { phaseChangedIso: "2026-10-08T00:00:00.000Z" } }),
      orgIncident({ over: { loud: { iso: "2026-10-08T00:00:00.000Z", kind: "reopened" } } }),
    ];
    expect(moved.map((incident) => acknowledgementOf({ incident, rows: [ROW] }))).toEqual([
      { state: "none" },
      { state: "none" },
      { state: "none" },
      { state: "none" },
    ]);
  });

  it("reads the newest row for the incident in file order, and ignores another incident's", () => {
    const stale = { ...ROW, acknowledgedIso: "2026-10-07T00:00:00.000Z", severity: "Minor" };
    const other = { ...ROW, ref: "INC-97" };
    expect([
      acknowledgementOf({ incident: orgIncident(), rows: [ROW, stale] }),
      acknowledgementOf({ incident: orgIncident(), rows: [stale, ROW, other] }),
      acknowledgementOf({ incident: orgIncident(), rows: [other] }),
      acknowledgementOf({ incident: orgIncident(), rows: [] }),
    ]).toEqual([{ state: "none" }, { atIso: PRESSED, state: "acknowledged" }, { state: "none" }, { state: "none" }]);
  });

  it("matches an incident that never paged against a row recording null", () => {
    const quietIncident = orgIncident({ over: { loud: undefined } });
    const row = acknowledgementRowFor({ acknowledgedIso: PRESSED, bySession: "terminal", incident: quietIncident });
    expect(acknowledgementOf({ incident: quietIncident, rows: [row] })).toEqual({
      atIso: PRESSED,
      state: "acknowledged",
    });
  });
});

describe("acknowledgementsOf", () => {
  it("judges each open incident off a whole ledger, and calls every one unmeasured off a broken one", () => {
    const open = [orgIncident(), orgIncident({ over: { ref: "INC-97" } })];
    expect([
      [...acknowledgementsOf({ ledger: { rows: [ROW] }, open })],
      [...acknowledgementsOf({ ledger: { because: "line 2 did not read" }, open })],
    ]).toEqual([
      [
        ["INC-98", { atIso: PRESSED, state: "acknowledged" }],
        ["INC-97", { state: "none" }],
      ],
      [
        ["INC-98", { because: "line 2 did not read", state: "unmeasured" }],
        ["INC-97", { because: "line 2 did not read", state: "unmeasured" }],
      ],
    ]);
  });

  it("calls a reference the snapshot holds open twice unmeasured, even when one of the two matches the newest row", () => {
    const regraded = orgIncident({ over: { severity: "Major" } });
    expect([...acknowledgementsOf({ ledger: { rows: [ROW] }, open: [regraded, orgIncident()] })]).toEqual([
      [
        "INC-98",
        {
          because:
            "INC-98 appears 2 times among the open incidents, so which one an acknowledgement describes cannot be told",
          state: "unmeasured",
        },
      ],
    ]);
  });
});
