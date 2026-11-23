/**
 * Doc drift: the one part of "how is this proposal tracking" a machine can answer without a model.
 *
 * The owner's named failure is a proposal that gets implemented end to end while the document that pitched it
 * is never touched again. That is not a documentation nicety in this system — the corpus INGESTS Notion, so a
 * stale proposal page is a corpus correctness problem: retrieval over it returns a plan that was
 * abandoned, with nothing marking it superseded, and a turn asked about the subject leans on the wrong page.
 *
 * The check needs no judgement, because the register already holds one half of it and the destination supplies
 * the other — a Notion page's `last_edited_time`, a Linear document's `updatedAt`, a local page's newest freeze:
 *
 * > a proposal whose newest MATERIAL event happened after its page was last edited is drifted.
 *
 * ## Three things this deliberately does NOT claim
 *
 * **"Material" is narrow.** It means an event a reader of the PAGE would need to see and cannot — the
 * decision or rejection, the supersession, the withdrawal, the moves to partially-implemented or implemented,
 * and the follow-ups the proposal spawned. It excludes `created` and `destination-linked` (which the page
 * trivially knows), `slack-linked` and `feedback-*` (which live in Slack, and which nobody expects a proposal doc to
 * carry), `audience-set`, and the `shared`/`discussed` status moves — announcing a doc is not a change TO it.
 * A broader set would flag every entry the moment it was registered, and a check that always fires is a check
 * nobody reads. `follow-up-added` is the one judgement call in that list: not every ticket a proposal spawns
 * belongs in its page, so this is a deliberate lean towards catching the case the owner actually hit (work
 * shipped, doc silent) at the cost of some follow-ups that were never going to be written up.
 *
 * **The non-drifted arm proves nothing.** `seenIndex.ts` establishes only the one-way fact that Notion's
 * `last_edited_time` advances on any edit to a page's own blocks, and every other destination's clock is read the
 * same way. An edit AFTER the decision does not
 * establish that the edit was ABOUT the decision, so the clean arm is called `no-drift-evidence` rather than
 * `current`: it says this comparison found nothing, not that the page is right.
 *
 * **Occurrence time, not append time.** Every event carries `atIso`, the instant the CLI wrote it, and a
 * backfill of July's facts in August files them all under August — which against a July page edit reads as
 * drift even when that edit already documented the thing. So this prefers `decidedIso` on a decision and the
 * optional `occurredIso` on the rest, falls back to append time when neither exists, and REPORTS which of the
 * two it used rather than presenting one as the other.
 *
 * Everything here is pure. The destination's last edit is passed in — reading it is the CLI shell's job —
 * and the day gap is computed from the two timestamps rather than from a clock, so this module has no `now`.
 */
import { parseIsoMs, parseStrictIsoInstantMs } from "../../../lib/date.js";
import type { RegisterEvent } from "./events.js";

/** Whether a material event's timestamp is when it HAPPENED or merely when the CLI wrote it down. */
type DriftTimestampBasis = "occurred" | "recorded";

/** One event that changed what the proposal MEANS, and so should have been reflected back into the page. */
export interface MaterialRegisterEvent {
  /** When it happened, preferring an occurrence time over the append time — see {@link basis}. */
  readonly atIso: string;
  readonly basis: DriftTimestampBasis;
  /** A short operator-facing description — what a drift report names as the thing the page does not say. */
  readonly what: string;
}

/** Milliseconds in a day, for the whole-days gap a drift report quotes. */
const MS_PER_DAY = 86_400_000;

/** The material description of one event, or `undefined` when that event kind changes nothing a reader needs. */
function materialDescription({ event }: { event: RegisterEvent }): string | undefined {
  switch (event.kind) {
    case "decided":
      return event.outcome === "rejected" ? `rejected by ${event.decider}` : `decided by ${event.decider}`;
    case "superseded":
      return `superseded by ${event.by}`;
    case "follow-up-added":
      return `follow-up ${event.ref}`;
    case "status-changed":
      return event.status === "partially-implemented" || event.status === "implemented" || event.status === "withdrawn"
        ? `status ${event.status}`
        : undefined;
    case "created":
    case "destination-linked":
    case "slack-linked":
    case "audience-set":
    case "feedback-recorded":
    case "feedback-answered":
      return undefined;
  }
}

/** When a material event happened, and whether that is an occurrence time or only the append time. */
function occurrenceOf({ event }: { event: RegisterEvent }): {
  readonly atIso: string;
  readonly basis: DriftTimestampBasis;
} {
  if (event.kind === "decided") {
    // `decidedIso` has been required since the first version of this event, and it has always MEANT the
    // occurrence time — `proposal decide --date` exists for exactly the back-dating case.
    return { atIso: event.decidedIso, basis: "occurred" };
  }
  const occurred =
    event.kind === "superseded" || event.kind === "status-changed" || event.kind === "follow-up-added"
      ? event.occurredIso
      : undefined;
  return occurred === undefined ? { atIso: event.atIso, basis: "recorded" } : { atIso: occurred, basis: "occurred" };
}

/**
 * Every event in a journal that a reader of the published proposal would need to see reflected there.
 *
 * @param events the journal's events, in the order they were appended
 * @returns the material events, in journal order, each timestamped by when it happened
 */
export function materialRegisterEvents({
  events,
}: {
  events: readonly RegisterEvent[];
}): readonly MaterialRegisterEvent[] {
  return events.flatMap((event) => {
    const what = materialDescription({ event });
    return what === undefined ? [] : [{ ...occurrenceOf({ event }), what }];
  });
}

/** What comparing a journal against its page's last edit says. */
export type ProposalDriftVerdict =
  /** The register knows something the page does not. */
  | {
      readonly kind: "drifted";
      readonly latestMaterialIso: string;
      readonly basis: DriftTimestampBasis;
      readonly what: string;
      readonly destinationLastEditedIso: string;
      readonly daysBehind: number;
    }
  /**
   * The page was edited at or after the newest material event. That is the ABSENCE of timestamp evidence, not
   * proof the page says the right thing — any unrelated edit advances the same clock.
   */
  | {
      readonly kind: "no-drift-evidence";
      readonly destinationLastEditedIso: string;
      readonly latestMaterialIso: string;
      readonly basis: DriftTimestampBasis;
    }
  /** Nothing material has happened yet, so there is nothing the page could be behind on. */
  | { readonly kind: "no-material-events"; readonly destinationLastEditedIso: string }
  /**
   * The comparison could not be made. Refused rather than guessed, and never folded into one of the arms
   * above: a missing page reported as `no-drift-evidence` is a silent degrade wearing a clean result.
   */
  | { readonly kind: "unassessable"; readonly why: string };

/**
 * Compare one proposal's journal against its page's last edit.
 *
 * The latest material event is the newest by TIMESTAMP rather than the last in the file. Journals are
 * append-only and normally already in order, but a decision carries a back-dated `decidedIso` and a backfill
 * can record yesterday's fact today, so ordering by position would be an assumption where ordering by time is
 * a fact.
 *
 * An unparseable timestamp on EITHER side is `unassessable`, naming which one. Dropping the offending event
 * and comparing the rest would answer a question nobody asked, and would answer it clean.
 *
 * @param events the proposal's journal events
 * @param destinationLastEditedIso when the destination was last edited, by its own provider's clock
 * @returns the drift verdict
 */
export function assessProposalDrift({
  events,
  destinationLastEditedIso,
}: {
  events: readonly RegisterEvent[];
  destinationLastEditedIso: string;
}): ProposalDriftVerdict {
  // Strict, because every destination clock is a full instant (Notion, Linear and a freeze all write one) and
  // `Date.parse` rolls a calendar impossibility such as an impossible February day forward into a real-looking edit.
  const editedMs = parseStrictIsoInstantMs({ text: destinationLastEditedIso });
  if (editedMs === undefined) {
    return {
      kind: "unassessable",
      why: `the destination reported an unreadable last-edited time (${destinationLastEditedIso})`,
    };
  }
  // Every event's instant is parsed once, in order, and the first one that will not parse ends the assessment;
  // so past this loop `instants` holds exactly one parsed instant per material event.
  const material = materialRegisterEvents({ events });
  const instants: number[] = [];
  for (const event of material) {
    const ms = parseIsoMs({ tsIso: event.atIso });
    if (ms === undefined) {
      return {
        kind: "unassessable",
        why: `"${event.what}" carries an unreadable timestamp (${event.atIso}), so nothing can be compared against it`,
      };
    }
    instants.push(ms);
  }
  const latest = material
    .map((event, index) => ({ ...event, ms: instants[index]! }))
    .toSorted((a, b) => a.ms - b.ms)
    .at(-1);
  if (latest === undefined) {
    return { kind: "no-material-events", destinationLastEditedIso };
  }
  return latest.ms > editedMs
    ? {
        basis: latest.basis,
        // Whole days, floored: a report that says "0 days behind" for a four-hour gap is saying the page was
        // edited the same day, which is the true and useful reading of it.
        daysBehind: Math.floor((latest.ms - editedMs) / MS_PER_DAY),
        kind: "drifted",
        latestMaterialIso: latest.atIso,
        destinationLastEditedIso,
        what: latest.what,
      }
    : { basis: latest.basis, kind: "no-drift-evidence", latestMaterialIso: latest.atIso, destinationLastEditedIso };
}
