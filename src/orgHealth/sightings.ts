/**
 * What a read remembers of each incident for the next one: when it first saw it in its phase, its severity, and its
 * last loud moment.
 *
 * ## The phase instant
 *
 * incident.io usually posts a moving update (`~Fixing~ → *Monitoring*`) when the status changes, and that dates the
 * phase exactly. When the root moved with no such update, the thread can only bound it from below, by the last update
 * still in the old phase — and keyed on that, a real move could sort BEHIND another incident's older one. The root's `edited.ts` is no better on its own: a cosmetic re-edit rewrites it with no status change.
 *
 * So an inferred phase is dated by its FIRST SIGHTING: the root's latest edit as the first complete read that saw the
 * incident in that phase found it, or the read's own start when the root carries no edit. Neither is the move itself;
 * both bound it from above, the edit more tightly (`./read.ts` `firstSeenIsos`). It is remembered while the phase
 * holds, so neither a cosmetic edit nor a same-phase update moves it, and replaced the first time a read sees the
 * phase change. Any phase, however dated, keeps a remembered instant its evidence does not post-date, so a moving
 * update seen late never re-dates a phase. Evidence AFTER it is a re-entry between two reads, and an exact rule
 * (`update`, `declared`) then dates it as the thread says.
 *
 * ## The loud moment
 *
 * What pages the owner (`./types.ts` {@link LoudMoment}) is recorded only while the incident is OPEN: first seen open is
 * `new`, open again after a read saw it resolved is `reopened`, and a severity other than the one the last read saw is
 * `severity-changed`. Each is dated by THIS read's start. incident.io records no severity change at all — the root is
 * edited in place and an update only repeats the current word — so no instant off the thread could date one, and a
 * read's start is the one instant that sorts every moment this machine saw after every moment it had already shown
 * An incident first seen already resolved has no loud moment, and a severity re-graded after
 * resolution is not one: neither is news, and either would outrank a still-open incident's page.
 *
 * ## First seen long after it was declared is not news either
 *
 * An incident this machine first sees open more than the live window ({@link LIVE_INCIDENT_WINDOW_HOURS}, the same
 * one that starts an investigation, `../incident/channel.ts`) after its declaration has no loud moment: it is not
 * starting, so it never floats as "a new incident". `org-health status` still counts it, and a later severity change or a
 * reopening still pages — a reopening outside the window as `reopened`, never as `new`. An incident declared weeks
 * before this machine first saw it would otherwise float as a newly emerging incident, rehashing an old conversation,
 * and the owner gets no floating note until there is something ready for their attention.
 *
 * ## A read with no memory at all
 *
 * With no sightings file — a new home, or one whose file was lost — nothing says which open incident this machine has
 * already paged, and dating each `new` by the read's start would mint a key newer than every page the owner was shown, so an
 * incident paged an hour ago would page again. Such a SEEDING read dates a first-seen open
 * incident by its own declaration instead. A page the owner saw was dated by a read that already held the incident, so no
 * earlier than its declaration, and the monitor's watermark reads the seeded key clear; one declared since that page
 * is newer than it, and pages. The cost: a reopening seen only by a seeding read reads as `new` at its declaration, and
 * is not paged when the owner was shown anything since. `org-health status` still counts it. A declaration is Slack's
 * time, floored to the second, so an incident declared within the same second as the newest key ever posted reads
 * clear too. That is the residue, not a defect: the watermark's `<=` is what stops a week-old page posting late, and
 * only an exact sub-second record of when each page's incident was declared would close it.
 *
 * Pure: the file is read and written by `./store.ts`.
 */
import { LIVE_INCIDENT_WINDOW_HOURS } from "../incident/channel.js";

import type { IncidentPhase, LoudMoment, OrgIncident, ThreadIncident } from "./types.js";

/** One hour, in milliseconds. */
const HOUR_MS = 3_600_000;

/** One incident's last sighting. */
interface IncidentSighting {
  readonly phase: IncidentPhase;
  readonly sinceIso: string;
  readonly severity: string;
  readonly loud?: LoudMoment | undefined;
}

/** Every incident's last sighting, by ref. */
export type IncidentSightings = Readonly<Record<string, IncidentSighting>>;

/**
 * Date every inferred phase by its first sighting, date each loud moment, and the sightings to remember for the next
 * read.
 *
 * @param incidents what this read parsed off the threads
 * @param previous what the last complete read remembered, `undefined` for a seeding read with no memory at all
 * @param firstSeenIso per ref, the instant to date a phase seen for the first time — the root's edit, else the
 *   read's start
 * @param readIso this read's start, which dates every loud moment it is the first to see
 * @returns the incidents, each inferred phase re-dated as `sighted` and each carrying its loud moment, and the
 *   sightings of exactly these incidents
 */
export function applySightings({
  incidents,
  previous,
  firstSeenIso,
  readIso,
}: {
  incidents: readonly ThreadIncident[];
  previous: IncidentSightings | undefined;
  firstSeenIso: Readonly<Record<string, string>>;
  readIso: string;
}): { readonly incidents: readonly OrgIncident[]; readonly sightings: IncidentSightings } {
  const dated = incidents.map((incident): OrgIncident => {
    let prior: IncidentSighting | undefined;
    let newIso = incident.declaredIso;
    if (previous !== undefined) {
      prior = previous[incident.ref];
      newIso = readIso;
    }
    const loud = loudOf({ incident, newIso, prior, readIso });
    // Evidence no later than the remembered instant is the SAME entry, seen late (a moving update backfilled, say),
    // and keeps the remembered instant, whatever rule dated it. Only evidence after it is a
    // re-entry since the last read.
    if (prior !== undefined && prior.phase === incident.phase && incident.phaseChangedIso <= prior.sinceIso) {
      return { ...incident, loud, phaseChangedIso: prior.sinceIso, phaseProvenance: "sighted" };
    }
    if (incident.phaseProvenance !== "inferred") {
      return { ...incident, loud };
    }
    return { ...incident, loud, phaseChangedIso: firstSeenIso[incident.ref]!, phaseProvenance: "sighted" };
  });
  const sightings = Object.fromEntries(
    dated.map((incident) => [
      incident.ref,
      {
        loud: incident.loud,
        phase: incident.phase,
        severity: incident.severity,
        sinceIso: incident.phaseChangedIso,
      } satisfies IncidentSighting,
    ]),
  );
  return { incidents: dated, sightings };
}

/**
 * The incident's loud moment as of this read: a new one when it is open and something paging the owner happened. `newIso`
 * dates a first sighting — the read's start, or the declaration on a seeding read.
 */
function loudOf({
  incident,
  prior,
  newIso,
  readIso,
}: {
  incident: ThreadIncident;
  prior: IncidentSighting | undefined;
  newIso: string;
  readIso: string;
}): LoudMoment | undefined {
  if (incident.phase === "resolved") {
    return prior?.loud;
  }
  const live = Date.parse(readIso) - Date.parse(incident.declaredIso) <= LIVE_INCIDENT_WINDOW_HOURS * HOUR_MS;
  if (prior === undefined) {
    if (!live) {
      return undefined;
    }
    return { iso: newIso, kind: "new" };
  }
  if (prior.phase === "resolved") {
    const starting = prior.loud === undefined && live;
    return { iso: readIso, kind: starting ? "new" : "reopened" };
  }
  if (prior.severity !== incident.severity) {
    return { fromSeverity: prior.severity, iso: readIso, kind: "severity-changed" };
  }
  return prior.loud;
}
