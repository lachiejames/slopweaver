import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { decodeIncidentSightings, decodeIncidentSnapshot } from "../../../orgHealth/snapshot.js";
import { measuredSnapshot, orgIncident } from "./orgIncidentFixture.js";

describe("decodeIncidentSnapshot", () => {
  it("decodes a measured snapshot exactly, a sighted phase and a severity change included", () => {
    const snapshot = measuredSnapshot({
      incidents: [
        orgIncident({
          over: {
            loud: { fromSeverity: "Minor", iso: "2026-10-04T08:30:00.000Z", kind: "severity-changed" },
            phaseProvenance: "sighted",
          },
        }),
        orgIncident({ over: { loud: undefined, phase: "resolved", ref: "INC-33", status: "Closed" } }),
      ],
    });
    expect(unwrap(decodeIncidentSnapshot({ value: snapshot }))).toEqual(snapshot);
  });

  it("refuses an unknown provenance, naming where", () => {
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    const drifted = { ...snapshot, incidents: [{ ...snapshot.incidents[0], phaseProvenance: "guessed" }] };
    expect(unwrapErr(decodeIncidentSnapshot({ value: drifted })).join("\n")).toContain("incidents.0.phaseProvenance");
  });

  it("refuses a severity change that does not say what it changed from", () => {
    const snapshot = measuredSnapshot({ incidents: [orgIncident()] });
    const drifted = {
      ...snapshot,
      incidents: [{ ...snapshot.incidents[0], loud: { iso: "2026-10-04T08:30:00.000Z", kind: "severity-changed" } }],
    };
    expect(unwrapErr(decodeIncidentSnapshot({ value: drifted })).join("\n")).toContain("incidents.0.loud");
  });
});

describe("decodeIncidentSightings", () => {
  it("decodes the sightings by ref", () => {
    const sightings = {
      "INC-98": {
        loud: { iso: "2026-10-04T08:00:00.000Z", kind: "new" },
        phase: "identified",
        severity: "Critical",
        sinceIso: "2026-10-04T08:45:00.000Z",
      },
    };
    expect(unwrap(decodeIncidentSightings({ value: { schemaVersion: 1, sightings } }))).toEqual(sightings);
  });

  it("refuses a ref that is not an incident number", () => {
    const sightings = { "PAY-1": { phase: "identified", severity: "Critical", sinceIso: "2026-10-04T08:45:00.000Z" } };
    expect(unwrapErr(decodeIncidentSightings({ value: { schemaVersion: 1, sightings } })).join("\n")).toContain(
      "sightings",
    );
  });

  it("refuses a sighting with no severity, which the next read could not compare against", () => {
    const sightings = { "INC-98": { phase: "identified", sinceIso: "2026-10-04T08:45:00.000Z" } };
    expect(unwrapErr(decodeIncidentSightings({ value: { schemaVersion: 1, sightings } })).join("\n")).toContain(
      "sightings.INC-98.severity",
    );
  });
});
