/**
 * The `incident` noun's manifest: its four verbs, what each may write, and the usage leaf both the manifest and the
 * commands read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  INCIDENT_DETECT_USAGE,
  INCIDENT_NOTE_USAGE,
  INCIDENT_POSTMORTEM_USAGE,
  INCIDENT_POSTMORTEMS_USAGE,
} from "../../../cli/commands/incident/incidentUsage.js";
import { incidentManifest } from "../../../cli/manifests/incident.js";

describe("incident manifest", () => {
  it("declares detect, note, postmortem and postmortems", () => {
    expect(Object.keys(incidentManifest).toSorted()).toEqual(["detect", "note", "postmortem", "postmortems"]);
  });

  it("lets the readers write nothing and the posters write only local state, none through a door", () => {
    expect(incidentManifest["detect"]!.meta.effect).toBe("none");
    expect(incidentManifest["note"]!.meta.effect).toBe("local-state");
    expect(incidentManifest["postmortem"]!.meta.effect).toBe("local-state");
    expect(incidentManifest["postmortems"]!.meta.effect).toBe("none");
    expect(Object.values(incidentManifest).map((entry) => entry.meta.doorRouted)).toEqual([false, false, false, false]);
  });

  it("carries the usage leaf's own strings", () => {
    expect(incidentManifest["detect"]!.meta.usage).toBe(INCIDENT_DETECT_USAGE);
    expect(incidentManifest["note"]!.meta.usage).toBe(INCIDENT_NOTE_USAGE);
    expect(incidentManifest["postmortem"]!.meta.usage).toBe(INCIDENT_POSTMORTEM_USAGE);
    expect(incidentManifest["postmortems"]!.meta.usage).toBe(INCIDENT_POSTMORTEMS_USAGE);
  });

  it("points each poster's usage at a form reference that exists", () => {
    const references = [
      { reference: "skills/incident/reference/note-form.md", usage: INCIDENT_NOTE_USAGE },
      { reference: "skills/incident/reference/postmortem-form.md", usage: INCIDENT_POSTMORTEM_USAGE },
    ];

    expect(references.map(({ reference, usage }) => usage.includes(reference))).toEqual([true, true]);
    expect(
      references.map(({ reference }) => readFileSync(join(process.cwd(), reference), "utf8").includes("# ")),
    ).toEqual([true, true]);
  });
});
