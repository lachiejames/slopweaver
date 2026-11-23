/**
 * One parsed incident and one measured snapshot, for the policy, store and monitor tests — the shapes
 * `parseIncidentIoThread` and `readOrgIncidents` produce, with made-up wording.
 */
import type { MeasuredIncidentSnapshot, OrgIncident } from "../../../orgHealth/types.js";

/** The instant every org-health test judges at, as a fixed instant. */
export const NOW_ISO = "2026-10-04T09:00:00.000Z";

/** {@link NOW_ISO} in epoch milliseconds. */
export const NOW_MS = Date.parse(NOW_ISO);

/** One hour, in milliseconds. */
export const HOUR_MS = 3_600_000;

/**
 * An incident, investigating since an hour before {@link NOW_ISO} and first seen new then, unless told otherwise.
 *
 * @returns the incident, with `over` laid on top
 */
export function orgIncident({ over = {} }: { over?: Partial<OrgIncident> } = {}): OrgIncident {
  return {
    declaredIso: "2026-10-04T08:00:00.000Z",
    homepageUrl: "https://app.incident.io/example-org/incidents/98",
    loud: { iso: "2026-10-04T08:00:00.000Z", kind: "new" },
    phase: "investigating",
    phaseChangedIso: "2026-10-04T08:00:00.000Z",
    phaseProvenance: "declared",
    ref: "INC-98",
    severity: "Critical",
    status: "Investigating",
    title: "Payment checkout regression",
    ...over,
  };
}

/**
 * A measured snapshot read at {@link NOW_ISO}.
 *
 * @returns the snapshot holding `incidents`
 */
export function measuredSnapshot({
  incidents,
  readIso = NOW_ISO,
}: {
  incidents: readonly OrgIncident[];
  readIso?: string;
}): MeasuredIncidentSnapshot {
  return {
    announcementCount: incidents.length,
    channelId: "C0SYNINCIDENTS",
    incidents,
    readIso,
    schemaVersion: 1,
    state: "measured",
  };
}
