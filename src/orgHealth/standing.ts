/**
 * Where the organisation stands, judged ONCE for both of its channels: the floating note (`../monitor/orgHealth.ts`)
 * and the quiet one (`slopweaver org-health status`, read on demand since the console sidebar's Incidents indicator
 * was cut).
 *
 * The quiet channel is a red indicator beside the count of incidents ongoing and a yellow one for an incident
 * suspected and under investigation, and it replaces any message or digest.
 * Both channels read this one judgement, so the quiet one can never call the
 * organisation healthy while the note's reading is unmeasurable, nor the reverse.
 *
 * Yellow is read as a declared incident.io incident still `Investigating`: its root cause is unknown, so it is
 * suspected and under investigation. Red is any open incident past that — `Fixing` or `Monitoring`. A suspected
 * problem nobody has declared, a bug thread say, has no source here yet, so it never turns the indicator yellow.
 *
 * Pure: the snapshot is read by `./store.ts`.
 */
import { renderAge, renderDuration } from "#lib/duration.js";
import type { Result } from "#lib/result.js";

import type { Acknowledgement } from "./acknowledgement.js";
import type { OrgHealthError } from "./errors.js";
import type { Investigation } from "./investigation.js";
import { SNAPSHOT_FRESH_MS } from "./policy.js";
import type { IncidentPhase, IncidentSnapshot, OrgIncident } from "./types.js";

/** Where each phase is, in status-page words. */
const PHASE_WORDS: Readonly<Record<IncidentPhase, string>> = {
  identified: "root cause confirmed, fix dispatching",
  investigating: "investigating, root cause unknown so far",
  monitoring: "fix out, monitoring that it holds",
  resolved: "confirmed stable, resolved",
};

/** The organisation as both channels judge it. */
export type OrgHealthStanding =
  | { readonly state: "unmeasurable"; readonly because: string }
  | {
      readonly state: "measured";
      readonly readIso: string;
      /** Every incident the snapshot keeps, the week's resolutions included. */
      readonly incidents: readonly OrgIncident[];
      /** The ones not resolved, newest phase change first. */
      readonly open: readonly OrgIncident[];
    };

/**
 * Judge the snapshot: no read, a failed or killed read, or a stale one is `unmeasurable`, never healthy.
 *
 * @param snapshot what the last read wrote, `null` when no read has run, or why the file cannot be trusted
 * @param nowMs the instant judged at
 * @returns the standing
 */
export function orgHealthStanding({
  snapshot,
  nowMs,
}: {
  snapshot: Result<IncidentSnapshot | null, OrgHealthError>;
  nowMs: number;
}): OrgHealthStanding {
  if (snapshot.isErr()) {
    return { because: snapshot.error.message, state: "unmeasurable" };
  }
  const read = snapshot.value;
  if (read === null) {
    return {
      because: "no incident read has run — `slopweaver org-health read` writes the snapshot this judges",
      state: "unmeasurable",
    };
  }
  if (read.state === "unmeasurable") {
    return { because: read.because, state: "unmeasurable" };
  }
  const ageMs = nowMs - Date.parse(read.readIso);
  if (ageMs > SNAPSHOT_FRESH_MS) {
    return {
      because: `the last complete incident read was ${renderAge({ ms: ageMs })} ago (${read.readIso}), past the ${renderDuration({ ms: SNAPSHOT_FRESH_MS })} it is believed for`,
      state: "unmeasurable",
    };
  }
  const open = read.incidents
    .filter((incident) => incident.phase !== "resolved")
    .toSorted((a, b) => b.phaseChangedIso.localeCompare(a.phaseChangedIso));
  return { incidents: read.incidents, open, readIso: read.readIso, state: "measured" };
}

/** What `org-health status --json` prints: the quiet channel's whole reading. */
export type OrgHealthStatus =
  | { readonly schemaVersion: 1; readonly state: "unmeasurable"; readonly because: string }
  | {
      readonly schemaVersion: 1;
      readonly state: "measured";
      readonly readIso: string;
      /** `healthy` with nothing open; else red once any open incident is past investigating, else yellow. */
      readonly tone: "healthy" | "red" | "yellow";
      readonly ongoing: number;
      readonly investigating: number;
      /**
       * Each open incident as a status page's one line, newest phase change first, and whether the fleet is looking
       * into it (`./investigation.ts`) — the quiet "looking into this, and why" beside the incident.
       */
      readonly incidents: readonly {
        readonly ref: string;
        readonly line: string;
        readonly url: string;
        readonly investigation: Investigation;
        /** Whether the owner acknowledged it and it has not moved since (`./acknowledgement.ts`). */
        readonly acknowledgement: Acknowledgement;
      }[];
    };

/**
 * The quiet channel's reading, from the standing.
 *
 * @param standing what {@link orgHealthStanding} judged
 * @param investigations each open incident's investigation by reference (`./investigationRead.ts`); one missing
 *   reads as unmeasured, never as nobody looking
 * @param acknowledgements each open incident's acknowledgement by reference (`./acknowledgement.ts`); one missing
 *   reads as unmeasured, never as not acknowledged
 * @returns the document `org-health status --json` prints
 */
export function orgHealthStatus({
  standing,
  investigations,
  acknowledgements,
}: {
  standing: OrgHealthStanding;
  investigations: ReadonlyMap<string, Investigation>;
  acknowledgements: ReadonlyMap<string, Acknowledgement>;
}): OrgHealthStatus {
  if (standing.state === "unmeasurable") {
    return { because: standing.because, schemaVersion: 1, state: "unmeasurable" };
  }
  const { open } = standing;
  const investigating = open.filter((incident) => incident.phase === "investigating").length;
  return {
    incidents: open.map((incident) => ({
      acknowledgement: acknowledgementFor({ acknowledgements, ref: incident.ref }),
      investigation: investigationOf({ investigations, ref: incident.ref }),
      line: `${incident.ref} ${incident.severity} · ${incident.title} — ${PHASE_WORDS[incident.phase]}`,
      ref: incident.ref,
      url: incident.homepageUrl,
    })),
    investigating,
    ongoing: open.length,
    readIso: standing.readIso,
    schemaVersion: 1,
    state: "measured",
    tone: toneOf({ investigating, ongoing: open.length }),
  };
}

/** One incident's investigation, or unmeasured when the reading holds none for it. */
function investigationOf({
  investigations,
  ref,
}: {
  investigations: ReadonlyMap<string, Investigation>;
  ref: string;
}): Investigation {
  const investigation = investigations.get(ref);
  if (investigation === undefined) {
    return { because: `no investigation reading was taken for ${ref}`, state: "unmeasured" };
  }
  return investigation;
}

/** One incident's acknowledgement, or unmeasured when the reading holds none for it. */
function acknowledgementFor({
  acknowledgements,
  ref,
}: {
  acknowledgements: ReadonlyMap<string, Acknowledgement>;
  ref: string;
}): Acknowledgement {
  const acknowledgement = acknowledgements.get(ref);
  if (acknowledgement === undefined) {
    return { because: `no acknowledgement reading was taken for ${ref}`, state: "unmeasured" };
  }
  return acknowledgement;
}

/** Healthy with nothing open, yellow while every open incident is still investigating, else red. */
function toneOf({ ongoing, investigating }: { ongoing: number; investigating: number }): "healthy" | "red" | "yellow" {
  if (ongoing === 0) {
    return "healthy";
  }
  if (investigating === ongoing) {
    return "yellow";
  }
  return "red";
}
