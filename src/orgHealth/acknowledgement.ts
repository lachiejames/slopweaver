/**
 * The owner's acknowledgement of an open incident: the row one `org-health ack` writes (a "press", in the ledger's
 * words), and whether it still holds.
 *
 * An incident the owner has already talked through should not sit in the sidebar for days, as with a pager, where
 * an engineer acknowledges a page. So an acknowledgement quiets `org-health status`'s attention signal for that incident, keeps it listed, and lapses the moment
 * the incident moves. It is LOCAL: nothing reaches incident.io, Slack or any person.
 *
 * The row holds the incident's state as the owner acknowledged it, never a copy of the incident. Whether the incident is
 * still acknowledged is DERIVED on every read by comparing that fingerprint with the live snapshot: its severity, its
 * phase, when it entered that phase (so a move away and back is a change), and its last loud moment (so a reopening
 * or a re-grade is a change). An update posted with no move is not a change of state, so it does not lapse.
 *
 * Pure: the ledger is the store's `org_health_acknowledgement` table, read and appended by `./storeAcknowledgements.ts`.
 */
import { z } from "zod";

import type { IncidentPhase, OrgIncident } from "./types.js";

/** One press, as the ledger holds it. */
export interface AcknowledgementRow {
  /** `INC-33`. */
  readonly ref: string;
  /** The incident's severity when the owner acknowledged it. */
  readonly severity: string;
  /** The incident's phase when the owner acknowledged it. */
  readonly phase: IncidentPhase;
  /** When the incident had entered that phase. */
  readonly phaseChangedIso: string;
  /** The incident's last loud moment then, or `null` for one that never paged. */
  readonly loudIso: string | null;
  readonly acknowledgedIso: string;
  /** Who acknowledged: the session that ran the verb, or `work-console` on a row the console's cut button wrote. */
  readonly bySession: string;
}

/** Whether one open incident stands acknowledged, as `org-health status` prints it. */
export type Acknowledgement =
  | { readonly state: "acknowledged"; readonly atIso: string }
  | { readonly state: "none" }
  | { readonly state: "unmeasured"; readonly because: string };

/** An incident reference, as incident.io prints one. */
export const INCIDENT_REF = /^INC-\d+$/u;

const rowSchema = z
  .object({
    acknowledgedIso: z.iso.datetime(),
    bySession: z.string().min(1),
    loudIso: z.iso.datetime().nullable(),
    phase: z.enum(["investigating", "identified", "monitoring", "resolved"]),
    phaseChangedIso: z.iso.datetime(),
    ref: z.string().regex(INCIDENT_REF),
    severity: z.string().min(1),
  })
  .strict();

/**
 * Read one ledger line's value as a row.
 *
 * @param value one parsed JSON line
 * @returns the row, or `undefined` when it is not one
 */
export function acknowledgementRowOf({ value }: { value: unknown }): AcknowledgementRow | undefined {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

/**
 * The incident's last loud moment, the way a row records it.
 *
 * @returns the moment's instant, or `null` for an incident that never paged
 */
function loudIsoOf({ incident }: { incident: OrgIncident }): string | null {
  if (incident.loud === undefined) {
    return null;
  }
  return incident.loud.iso;
}

/**
 * The row a press on this incident writes: its fingerprint taken from the incident itself, never from the caller.
 *
 * @param incident the incident as the live snapshot holds it
 * @param acknowledgedIso when the owner pressed
 * @param bySession who pressed
 * @returns the row
 */
export function acknowledgementRowFor({
  incident,
  acknowledgedIso,
  bySession,
}: {
  incident: OrgIncident;
  acknowledgedIso: string;
  bySession: string;
}): AcknowledgementRow {
  return {
    acknowledgedIso,
    bySession,
    loudIso: loudIsoOf({ incident }),
    phase: incident.phase,
    phaseChangedIso: incident.phaseChangedIso,
    ref: incident.ref,
    severity: incident.severity,
  };
}

/**
 * Whether the incident stands acknowledged: the newest row for its reference, in file order, still describes it.
 *
 * @param incident the incident as the live snapshot holds it
 * @param rows every row the ledger holds, in file order
 * @returns acknowledged with when, or none when no row holds it or the incident has moved since
 */
export function acknowledgementOf({
  incident,
  rows,
}: {
  incident: OrgIncident;
  rows: readonly AcknowledgementRow[];
}): Acknowledgement {
  const newest = rows.findLast((row) => row.ref === incident.ref);
  if (newest === undefined) {
    return { state: "none" };
  }
  const unmoved =
    newest.severity === incident.severity &&
    newest.phase === incident.phase &&
    newest.phaseChangedIso === incident.phaseChangedIso &&
    newest.loudIso === loudIsoOf({ incident });
  if (!unmoved) {
    return { state: "none" };
  }
  return { atIso: newest.acknowledgedIso, state: "acknowledged" };
}

/**
 * Each open incident's acknowledgement off one read of the ledger. A ledger that could not be read whole makes EVERY
 * open incident's acknowledgement unmeasured, so a broken ledger keeps the reading loud, never quiet.
 *
 * @param open the open incidents, as the standing holds them
 * @param ledger every row in file order, or why the ledger could not be read whole
 * @returns each open incident's acknowledgement by reference
 */
export function acknowledgementsOf({
  open,
  ledger,
}: {
  open: readonly OrgIncident[];
  ledger: { readonly rows: readonly AcknowledgementRow[] } | { readonly because: string };
}): ReadonlyMap<string, Acknowledgement> {
  const counts = new Map<string, number>();
  for (const incident of open) {
    const seen = counts.get(incident.ref);
    if (seen === undefined) {
      counts.set(incident.ref, 1);
    } else {
      counts.set(incident.ref, seen + 1);
    }
  }
  return new Map(
    open.map((incident): [string, Acknowledgement] => {
      if ("because" in ledger) {
        return [incident.ref, { because: ledger.because, state: "unmeasured" }];
      }
      const count = counts.get(incident.ref)!;
      if (count > 1) {
        return [incident.ref, { because: ambiguousRefBecause({ count, ref: incident.ref }), state: "unmeasured" }];
      }
      return [incident.ref, acknowledgementOf({ incident, rows: ledger.rows })];
    }),
  );
}

/**
 * Why a reference the snapshot holds open more than once has no acknowledgement: a row names a reference, so which of
 * the incidents it describes cannot be told, and the answer is neither yes nor no.
 *
 * @param count how many open incidents carry the reference
 * @returns the reason, worded once for the status and the verb's refusal
 */
export function ambiguousRefBecause({ ref, count }: { ref: string; count: number }): string {
  return `${ref} appears ${String(count)} times among the open incidents, so which one an acknowledgement describes cannot be told`;
}
