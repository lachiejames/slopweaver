/**
 * Which resolved incidents are worth putting a postmortem card in front of the owner for — the read
 * `slopweaver incident postmortems` prints and the supervisor picks from, every now and then.
 *
 * It is looked at every now and then. So this is a READ the chair runs, never a
 * schedule that raises rows by itself: the chair picks which, and whether now is the time (rule 2 — nothing here
 * launches anything).
 *
 * A candidate is an incident the org-health snapshot keeps that is:
 *
 * - **resolved** — a postmortem follows the incident; a live one is the incident note's (`./note.ts`);
 * - **not Minor** — incident.io's own severity word; a Minor incident rarely earns a meeting the owner would sit in;
 * - **keyed by its own channel** — the row and the reply both live there. An incident whose announcement names no
 *   channel, names one that is no Slack channel id, or shares one with another, is HELD with the reason rather than
 *   dropped, so the chair sees it;
 * - **not yet carded** — no `pm-<channel>-r<n>` step was ever posted for its channel, open or settled. A card the
 *   owner answered no to stays answered.
 *
 * A candidate whose row is already on the board says so (`registered`) instead of offering a second `handover
 * register`, which would be refused: what is left for it is the card.
 *
 * Pure: the snapshot's incidents, the hand register's rows and the board's registered slugs in; candidates, newest
 * resolution first, out.
 */
import type { HandRow } from "../hand/row.js";
import type { OrgIncident } from "../orgHealth/types.js";

import { type IncidentPostmortemError, IncidentPostmortemErrors } from "./errors.js";
import { CHANNEL_ID } from "./form.js";
import { postmortemCardIdPattern } from "./postmortem.js";
import { postmortemRegisterFlags, postmortemRowSlug } from "./postmortemRow.js";

/** incident.io's severity word for an incident below a postmortem's bar. */
const BELOW_THE_BAR = "minor";

/** One resolved incident worth a postmortem card, and the register flags that raise its row. */
export interface PostmortemCandidate {
  readonly ref: string;
  readonly title: string;
  readonly severity: string;
  readonly channelId: string;
  readonly homepageUrl: string;
  /** When it resolved. */
  readonly resolvedIso: string;
  /** The board row a card for it waits on. */
  readonly row: string;
  /** The `handover register` flags that raise {@link PostmortemCandidate.row}. */
  readonly registerFlags: readonly string[];
  /** Whether {@link PostmortemCandidate.row} is already on the board, so what is left is the card, not the register. */
  readonly registered: boolean;
}

/** The read's verdict: the candidates, and the incidents that would be but cannot be keyed by a channel. */
export interface PostmortemCandidates {
  readonly candidates: readonly PostmortemCandidate[];
  readonly held: readonly IncidentPostmortemError[];
}

/**
 * Whether a postmortem card was ever posted for this channel, open or settled. A settled row counts on its own id:
 * a settling records the card as surely as its posting does, whatever lines sit beside it.
 *
 * @returns true when the register holds a `pm-<channel>-r<n>` posting or settling
 */
function carded({ channelId, rows }: { channelId: string; rows: readonly HandRow[] }): boolean {
  const pattern = postmortemCardIdPattern({ channelId });
  return rows.some((row) => pattern.test(row.kind === "settled" ? row.id : row.step.id));
}

/**
 * The eligible incidents grouped by their own channel, and every one held for naming no usable channel.
 *
 * @returns each channel's incidents, and the held refusals — a shared channel is held later, by the caller
 */
function groupByChannel({ incidents }: { incidents: readonly OrgIncident[] }): {
  readonly byChannel: ReadonlyMap<string, readonly OrgIncident[]>;
  readonly held: IncidentPostmortemError[];
} {
  const held: IncidentPostmortemError[] = [];
  const byChannel = new Map<string, OrgIncident[]>();
  for (const incident of incidents) {
    if (incident.channelId === undefined) {
      held.push(IncidentPostmortemErrors.channelMissing({ ref: incident.ref }));
      continue;
    }
    // The snapshot admits any non-empty string, and the slug built from it must survive `handover register`.
    if (!CHANNEL_ID.test(incident.channelId)) {
      held.push(IncidentPostmortemErrors.channelMalformed({ channelId: incident.channelId, ref: incident.ref }));
      continue;
    }
    const sharing = byChannel.get(incident.channelId);
    if (sharing === undefined) {
      byChannel.set(incident.channelId, [incident]);
    } else {
      sharing.push(incident);
    }
  }
  return { byChannel, held };
}

/**
 * The resolved incidents worth a postmortem card.
 *
 * @param incidents every incident the org-health snapshot keeps
 * @param rows every row the hand register holds
 * @param registered the postmortem row slugs already on the board — a second `handover register` of one is refused
 * @returns the candidates, newest resolution first, and every incident held for want of its own channel
 */
export function postmortemCandidates({
  incidents,
  rows,
  registered,
}: {
  incidents: readonly OrgIncident[];
  rows: readonly HandRow[];
  registered: ReadonlySet<string>;
}): PostmortemCandidates {
  const eligible = incidents.filter(
    (incident) => incident.phase === "resolved" && incident.severity.toLowerCase() !== BELOW_THE_BAR,
  );
  const { byChannel, held } = groupByChannel({ incidents: eligible });
  const candidates: PostmortemCandidate[] = [];
  for (const [channelId, sharing] of byChannel) {
    if (sharing.length > 1) {
      held.push(IncidentPostmortemErrors.channelShared({ channelId, refs: sharing.map((incident) => incident.ref) }));
      continue;
    }
    const incident = sharing[0]!;
    if (carded({ channelId, rows })) {
      continue;
    }
    const row = postmortemRowSlug({ channelId });
    candidates.push({
      channelId,
      homepageUrl: incident.homepageUrl,
      ref: incident.ref,
      registerFlags: postmortemRegisterFlags({
        incident: { channelId, homepageUrl: incident.homepageUrl, ref: incident.ref, title: incident.title },
      }),
      registered: registered.has(row),
      resolvedIso: incident.phaseChangedIso,
      row,
      severity: incident.severity,
      title: incident.title,
    });
  }
  return {
    candidates: candidates.toSorted((a, b) => b.resolvedIso.localeCompare(a.resolvedIso) || a.ref.localeCompare(b.ref)),
    held,
  };
}
