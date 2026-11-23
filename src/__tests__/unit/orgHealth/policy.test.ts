import { describe, expect, it } from "vitest";

import type { IncidentIoRoot } from "../../../orgHealth/incidentIo.js";
import {
  keptIncidents,
  RESOLVED_REMEMBERED_MS,
  rootsToOpen,
  TITLE_CAP,
  UPDATE_TEXT_CAP,
} from "../../../orgHealth/policy.js";
import { HOUR_MS, NOW_MS, orgIncident } from "./orgIncidentFixture.js";

/** A parsed announcement, posted at `ts` and in `phase`. */
function root({
  ts,
  phase,
  editedTs,
  latestReplyTs,
}: {
  ts: string;
  phase: IncidentIoRoot["phase"];
  editedTs?: string;
  latestReplyTs?: string;
}): IncidentIoRoot {
  return {
    botId: "B0INCIDENT1",
    editedTs,
    homepageUrl: `https://app.incident.io/example-org/incidents/${ts.slice(0, 4)}`,
    latestReplyTs,
    phase,
    ref: `INC-${ts.slice(0, 4)}`,
    severity: "Major",
    status: phase === "resolved" ? "Closed" : "Investigating",
    title: "t",
    ts,
  };
}

describe("rootsToOpen", () => {
  // NOW is ts 1791104400; eight days back is 1790413200, six days back 1790586000, sixty days back 1785920400.
  it("opens every unresolved announcement however old, and a resolved one only when touched within the week", () => {
    const opened = rootsToOpen({
      nowMs: NOW_MS,
      roots: [
        root({ phase: "investigating", ts: "1785920400.000100" }),
        root({ phase: "resolved", ts: "1790413200.000100" }),
        root({ editedTs: "1790586000.000000", phase: "resolved", ts: "1785920400.000200" }),
        root({ phase: "resolved", ts: "1790586000.000100" }),
      ],
    });
    expect(opened.map((one) => one.ts)).toEqual(["1790586000.000100", "1785920400.000200", "1785920400.000100"]);
  });

  it("opens a long-resolved announcement replied to within the week, the reopening incident.io has yet to edit in", () => {
    const opened = rootsToOpen({
      nowMs: NOW_MS,
      roots: [
        root({ latestReplyTs: "1790586000.000000", phase: "resolved", ts: "1785920400.000100" }),
        root({ latestReplyTs: "1790413200.000000", phase: "resolved", ts: "1785920400.000200" }),
      ],
    });
    expect(opened.map((one) => one.ts)).toEqual(["1785920400.000100"]);
  });

  it("opens nothing for a channel with no announcement", () => {
    expect(rootsToOpen({ nowMs: NOW_MS, roots: [] })).toEqual([]);
  });
});

describe("keptIncidents", () => {
  it("keeps the unresolved and the resolved within the week, newest transition first", () => {
    const old = orgIncident({
      over: {
        phase: "resolved",
        phaseChangedIso: new Date(NOW_MS - RESOLVED_REMEMBERED_MS - HOUR_MS).toISOString(),
        ref: "INC-70",
      },
    });
    const recent = orgIncident({
      over: { phase: "resolved", phaseChangedIso: new Date(NOW_MS - 2 * HOUR_MS).toISOString(), ref: "INC-33" },
    });
    const open = orgIncident();
    expect(keptIncidents({ incidents: [old, recent, open], nowMs: NOW_MS }).map((one) => one.ref)).toEqual([
      "INC-98",
      "INC-33",
    ]);
  });

  it("cuts a title and an update to their caps, marking the cut", () => {
    const [kept] = keptIncidents({
      incidents: [
        orgIncident({
          over: {
            lastUpdate: {
              author: "Riley",
              iso: "2026-10-04T08:30:00.000Z",
              status: "Investigating",
              text: "u".repeat(900),
            },
            title: "t".repeat(500),
          },
        }),
      ],
      nowMs: NOW_MS,
    });
    expect(kept!.title).toBe(`${"t".repeat(TITLE_CAP - 1)}…`);
    expect(kept!.lastUpdate!.text).toBe(`${"u".repeat(UPDATE_TEXT_CAP - 1)}…`);
  });
});
