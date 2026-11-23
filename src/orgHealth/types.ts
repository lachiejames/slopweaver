/**
 * The organisation-health vocabulary: one incident as a public status page would show it, and the local snapshot
 * the `org-health` monitor and `org-health status` read.
 *
 * Something worth knowing reaches the owner as one line, and it updates the way a status page does: root cause
 * unknown so far, root cause confirmed and a fix dispatching, then stable and resolved. Those three moves are {@link IncidentPhase}; the incident system's own status is
 * kept beside the phase rather than replaced by it, so a reader can always see which word incident.io used.
 *
 * Pure: types only, no I/O.
 */

/** Where an incident is, in a status page's words. A closed set: an unmapped status is a refused read, never a guess. */
export type IncidentPhase = "investigating" | "identified" | "monitoring" | "resolved";

/** One update posted to an incident's thread — the latest one is what the note's details show. */
export interface IncidentUpdate {
  /** When the update was posted. */
  readonly iso: string;
  /** Who posted it, as incident.io names them — a person, or `incident.io (auto-closure)`. */
  readonly author: string;
  /** The update's own words, without the severity/status header incident.io puts in front of them. */
  readonly text: string;
  /** The status the update left the incident in. */
  readonly status: string;
}

/** One incident as its thread alone reports it, before a complete read dates its {@link LoudMoment}. */
export interface ThreadIncident {
  /** `INC-98` — derived from the incident's homepage address, and cross-checked against every update. */
  readonly ref: string;
  readonly title: string;
  /** incident.io's own severity word — `Critical`, `Major`, `Minor`. */
  readonly severity: string;
  /** incident.io's own status word, off the announcement it edits in place. */
  readonly status: string;
  readonly phase: IncidentPhase;
  /** The incident's homepage — the note's Open button. */
  readonly homepageUrl: string;
  /** The incident's own Slack channel, when the announcement names one. */
  readonly channelId?: string | undefined;
  /** The incident lead, when the announcement names one. */
  readonly lead?: string | undefined;
  /** When the incident was declared — the announcement's own post time. */
  readonly declaredIso: string;
  /**
   * When the incident entered its CURRENT phase: the first update of the run of updates that left it there, or the
   * declaration itself for an incident still investigating with no update.
   */
  readonly phaseChangedIso: string;
  /** Which evidence {@link ThreadIncident.phaseChangedIso} rests on (`./incidentIo.ts`'s `phaseEntered`). */
  readonly phaseProvenance: PhaseProvenance;
  /** The newest update, or absent for an incident nobody has updated since declaring it. */
  readonly lastUpdate?: IncidentUpdate | undefined;
}

/** One incident as a complete read reports it: its thread, and the last moment worth paging the owner for. */
export interface OrgIncident extends ThreadIncident {
  /** Absent for an incident first seen already resolved, which was never news (`./sightings.ts`). */
  readonly loud?: LoudMoment | undefined;
}

/**
 * What pages the owner: a floating note when a new incident starts, and one when the severity of something
 * materially changes. A phase move and a resolution are neither — those are the quiet channel,
 * `org-health status`. `iso` is the START of the first complete read that saw the moment, never an instant off the thread
 * (`./sightings.ts` says why), and the note is keyed on it (`../monitor/orgHealth.ts`).
 */
export type LoudMoment =
  | { readonly kind: "new" | "reopened"; readonly iso: string }
  | { readonly kind: "severity-changed"; readonly iso: string; readonly fromSeverity: string };

/**
 * What an incident's phase-entry instant rests on: incident.io's own moving update, the declaration (it has been in
 * this phase all along), the nearest update when the root moved without one (`inferred`, the thread parse alone), or
 * the first complete read that saw it there (`sighted`, which a read puts in place of `inferred` — `./sightings.ts`).
 */
export type PhaseProvenance = "update" | "declared" | "inferred" | "sighted";

/** A read that saw the whole channel and every thread it needed. */
export interface MeasuredIncidentSnapshot {
  readonly schemaVersion: 1;
  readonly state: "measured";
  /** When the read STARTED — what the monitor judges freshness against, so a slow read never reads fresher than it is. */
  readonly readIso: string;
  readonly channelId: string;
  /** How many announcements the read classified as incidents, every one of them, active or not. */
  readonly announcementCount: number;
  /** Every incident not resolved, and every one resolved within the remembered window (`./policy.ts`). */
  readonly incidents: readonly OrgIncident[];
}

/**
 * A read that could not see the channel whole, or one still under way — written so a stale success can never stand
 * in for it. A read writes this FIRST, before it opens a connection, so a read the supervisor kills mid-walk leaves
 * this behind rather than the last success looking current.
 *
 * @internal
 */
export interface UnmeasurableIncidentSnapshot {
  readonly schemaVersion: 1;
  readonly state: "unmeasurable";
  readonly attemptedIso: string;
  readonly because: string;
}

/** What `org-health read` last wrote. */
export type IncidentSnapshot = MeasuredIncidentSnapshot | UnmeasurableIncidentSnapshot;
