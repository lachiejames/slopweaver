import { describe, expect, it } from "vitest";

import { applySightings, type IncidentSightings } from "../../../orgHealth/sightings.js";
import type { ThreadIncident } from "../../../orgHealth/types.js";
import { orgIncident } from "./orgIncidentFixture.js";

/** An incident as its thread reports it: the fixture without the loud moment a read adds. */
const threadIncident = ({ over = {} }: { over?: Partial<ThreadIncident> } = {}): ThreadIncident => {
  const { loud: _loud, ...thread } = orgIncident({ over });
  return thread;
};

/** INC-98, its Fixing phase inferred off the thread at 07:00. */
const inferred = threadIncident({
  over: {
    phase: "identified",
    phaseChangedIso: "2026-10-04T07:00:00.000Z",
    phaseProvenance: "inferred",
    status: "Fixing",
  },
});
const firstSeenIso = { "INC-98": "2026-10-04T08:45:00.000Z" };

/** This read's start, which dates every loud moment it is first to see. */
const READ_ISO = "2026-10-04T09:00:00.000Z";

/** What an earlier read remembered of INC-98. */
const remembered = ({
  over = {},
}: {
  over?: Partial<IncidentSightings[string]>;
} = {}): IncidentSightings => ({
  "INC-98": {
    loud: { iso: "2026-10-04T06:00:00.000Z", kind: "new" },
    phase: "identified",
    severity: "Critical",
    sinceIso: "2026-10-04T08:10:00.000Z",
    ...over,
  },
});

/** Apply the sightings to one incident, at {@link READ_ISO}. */
const apply = ({ incident, previous }: { incident: ThreadIncident; previous: IncidentSightings | undefined }) =>
  applySightings({ firstSeenIso, incidents: [incident], previous, readIso: READ_ISO });

describe("applySightings — the phase instant", () => {
  it("dates an inferred phase seen for the first time by the root's edit at that read", () => {
    const { incidents, sightings } = apply({ incident: inferred, previous: {} });
    expect(incidents.map((one) => [one.phaseChangedIso, one.phaseProvenance])).toEqual([
      ["2026-10-04T08:45:00.000Z", "sighted"],
    ]);
    expect(sightings).toEqual({
      "INC-98": {
        loud: { iso: READ_ISO, kind: "new" },
        phase: "identified",
        severity: "Critical",
        sinceIso: "2026-10-04T08:45:00.000Z",
      },
    });
  });

  it("keeps the remembered instant while the phase holds, whatever the root's edit now says", () => {
    const { incidents } = apply({ incident: inferred, previous: remembered() });
    expect(incidents[0]!.phaseChangedIso).toBe("2026-10-04T08:10:00.000Z");
  });

  it("re-dates an inferred phase the last read saw in a different phase", () => {
    const previous = remembered({ over: { phase: "investigating", sinceIso: "2026-10-04T06:00:00.000Z" } });
    expect(apply({ incident: inferred, previous }).incidents[0]!.phaseChangedIso).toBe("2026-10-04T08:45:00.000Z");
  });

  it("keeps the remembered instant when a moving update dated before it is seen late", () => {
    const late = threadIncident({ over: { phaseChangedIso: "2026-10-04T09:59:00.000Z", phaseProvenance: "update" } });
    const previous = remembered({ over: { phase: "investigating", sinceIso: "2026-10-04T10:00:00.000Z" } });
    expect(
      apply({ incident: late, previous }).incidents.map((one) => [one.phaseChangedIso, one.phaseProvenance]),
    ).toEqual([["2026-10-04T10:00:00.000Z", "sighted"]]);
  });

  it("re-dates an inferred phase entered again after the remembered instant", () => {
    const previous = remembered({ over: { sinceIso: "2026-10-04T06:00:00.000Z" } });
    expect(apply({ incident: inferred, previous }).incidents[0]!.phaseChangedIso).toBe("2026-10-04T08:45:00.000Z");
  });

  it("dates a re-entry an update records after the remembered instant as the thread says", () => {
    const exact = threadIncident({ over: { phaseChangedIso: "2026-10-04T08:00:00.000Z", phaseProvenance: "update" } });
    const previous = remembered({ over: { phase: "investigating", sinceIso: "2026-10-04T05:00:00.000Z" } });
    const { incidents } = apply({ incident: exact, previous });
    expect([incidents[0]!.phaseChangedIso, incidents[0]!.phaseProvenance]).toEqual([
      "2026-10-04T08:00:00.000Z",
      "update",
    ]);
  });

  it("forgets an incident this read did not carry", () => {
    const previous = {
      "INC-9": { phase: "resolved" as const, severity: "Minor", sinceIso: "2026-09-01T00:00:00.000Z" },
    };
    expect(applySightings({ firstSeenIso: {}, incidents: [], previous, readIso: READ_ISO }).sightings).toEqual({});
  });
});

describe("applySightings — the loud moment", () => {
  it("pages an incident first seen open as new, at this read, once a memory exists — even an empty one", () => {
    expect(apply({ incident: inferred, previous: {} }).incidents[0]!.loud).toEqual({ iso: READ_ISO, kind: "new" });
  });

  it("keeps the remembered moment through a phase move with the severity unchanged", () => {
    const previous = remembered({ over: { phase: "investigating", sinceIso: "2026-10-04T06:00:00.000Z" } });
    expect(apply({ incident: inferred, previous }).incidents[0]!.loud).toEqual({
      iso: "2026-10-04T06:00:00.000Z",
      kind: "new",
    });
  });

  it("pages a severity other than the one the last read saw, naming what it was", () => {
    const previous = remembered({ over: { severity: "Minor" } });
    const { incidents, sightings } = apply({ incident: inferred, previous });
    expect(incidents[0]!.loud).toEqual({ fromSeverity: "Minor", iso: READ_ISO, kind: "severity-changed" });
    expect(sightings["INC-98"]!.severity).toBe("Critical");
  });

  it("pages a severity gone back to an earlier one as a fresh moment, never the old one", () => {
    const previous = remembered({
      over: {
        loud: { fromSeverity: "Critical", iso: "2026-10-04T07:00:00.000Z", kind: "severity-changed" },
        severity: "Minor",
      },
    });
    expect(apply({ incident: inferred, previous }).incidents[0]!.loud).toEqual({
      fromSeverity: "Minor",
      iso: READ_ISO,
      kind: "severity-changed",
    });
  });

  it("pages an incident open again after a read saw it resolved as reopened", () => {
    const previous = remembered({ over: { phase: "resolved" } });
    expect(apply({ incident: inferred, previous }).incidents[0]!.loud).toEqual({ iso: READ_ISO, kind: "reopened" });
  });

  it("gives an incident first seen already resolved no loud moment, and pages it as new once open", () => {
    const resolved = threadIncident({ over: { phase: "resolved", status: "Closed" } });
    const first = apply({ incident: resolved, previous: {} });
    expect(first.incidents[0]!.loud).toBe(undefined);
    expect(apply({ incident: inferred, previous: first.sightings }).incidents[0]!.loud).toEqual({
      iso: READ_ISO,
      kind: "new",
    });
  });

  it("dates a first-seen open incident by its declaration on a seeding read with no memory, and still dates its phase", () => {
    const { incidents, sightings } = apply({ incident: inferred, previous: undefined });
    expect(incidents[0]!.loud).toEqual({ iso: "2026-10-04T08:00:00.000Z", kind: "new" });
    expect(sightings["INC-98"]!.sinceIso).toBe("2026-10-04T08:45:00.000Z");
  });

  it("gives an incident first seen open more than the live window after its declaration no loud moment", () => {
    const old = threadIncident({ over: { declaredIso: "2026-10-02T08:59:59.999Z" } });
    expect(apply({ incident: old, previous: {} }).incidents[0]!.loud).toBe(undefined);
    expect(apply({ incident: old, previous: undefined }).incidents[0]!.loud).toBe(undefined);
  });

  it("still pages an incident first seen open exactly the live window after its declaration as new", () => {
    const edge = threadIncident({ over: { declaredIso: "2026-10-02T09:00:00.000Z" } });
    expect(apply({ incident: edge, previous: {} }).incidents[0]!.loud).toEqual({ iso: READ_ISO, kind: "new" });
  });

  it("pages a late-seen incident's later severity change, though its first sighting was never news", () => {
    const old = threadIncident({ over: { declaredIso: "2026-09-23T00:34:11.000Z", severity: "Minor" } });
    const first = apply({ incident: old, previous: {} });
    const regraded = threadIncident({ over: { declaredIso: "2026-09-23T00:34:11.000Z" } });
    expect(apply({ incident: regraded, previous: first.sightings }).incidents[0]!.loud).toEqual({
      fromSeverity: "Minor",
      iso: READ_ISO,
      kind: "severity-changed",
    });
  });

  it("pages a late-seen incident first seen resolved, open again, as reopened — never as new", () => {
    const declaredIso = "2026-09-23T00:34:11.000Z";
    const resolved = threadIncident({ over: { declaredIso, phase: "resolved", status: "Closed" } });
    const first = apply({ incident: resolved, previous: {} });
    const reopened = threadIncident({ over: { declaredIso } });
    expect(apply({ incident: reopened, previous: first.sightings }).incidents[0]!.loud).toEqual({
      iso: READ_ISO,
      kind: "reopened",
    });
  });

  it("keeps the last moment through a resolution, and never pages a severity re-graded after it", () => {
    const resolved = threadIncident({ over: { phase: "resolved", severity: "Minor", status: "Closed" } });
    expect(apply({ incident: resolved, previous: remembered() }).incidents[0]!.loud).toEqual({
      iso: "2026-10-04T06:00:00.000Z",
      kind: "new",
    });
  });
});
