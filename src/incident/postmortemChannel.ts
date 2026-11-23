/**
 * Whether a postmortem card's channel is the incident's own — the binding the form alone cannot carry.
 *
 * The form names an incident (`channel.reference`, its incident.io page) and a channel (`channel.id`, the row and the
 * parked reply), and each is checked against the other half of the form only. Nothing in it says the channel belongs
 * to the incident, so a card about INC-97 could carry INC-98's channel and row, and the owner's yes would send the reply into
 * the wrong room. incident.io's own announcement is the authority, as the org-health snapshot
 * keeps it: the incident the form references has to be there, naming exactly this channel.
 *
 * The snapshot is not judged for freshness here: which channel an incident owns does not change, so an old read binds
 * as well as a new one. It keeps a resolved incident for `../orgHealth/policy.ts`'s remembered window, the same window
 * `incident postmortems` lists from, so a card for an incident older than that is refused.
 *
 * Pure: a form's two halves and the snapshot in, a refusal or nothing out.
 */
import { RESOLVED_REMEMBERED_MS } from "../orgHealth/policy.js";
import type { IncidentSnapshot } from "../orgHealth/types.js";

import { IncidentPostmortemErrors, type PostmortemChannelUnboundError } from "./errors.js";

/** One day, for saying the remembered window in days. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The refusal when the snapshot does not name `channelId` as the referenced incident's own channel.
 *
 * @param reference incident.io's `INC-<n>` the form names
 * @param channelId the channel the form's row and parked reply are keyed by
 * @param snapshot what `org-health read` last wrote, or `null` when it never ran
 * @returns the refusal, or `undefined` once the snapshot binds the channel to the incident
 */
export function postmortemChannelUnbound({
  reference,
  channelId,
  snapshot,
}: {
  reference: string;
  channelId: string;
  snapshot: IncidentSnapshot | null;
}): PostmortemChannelUnboundError | undefined {
  const refused = ({ why }: { why: string }): PostmortemChannelUnboundError =>
    IncidentPostmortemErrors.channelUnbound({ channelId, ref: reference, why });
  if (snapshot === null) {
    return refused({
      why: "no incident read has run — `slopweaver org-health read` writes the snapshot this binds against",
    });
  }
  if (snapshot.state === "unmeasurable") {
    return refused({ why: `the last incident read could not see the channel whole (${snapshot.because})` });
  }
  const incident = snapshot.incidents.find((candidate) => candidate.ref === reference);
  if (incident === undefined) {
    return refused({
      why: `the snapshot read ${snapshot.readIso} keeps no ${reference}, and it remembers a resolved incident for ${String(RESOLVED_REMEMBERED_MS / DAY_MS)} days`,
    });
  }
  if (incident.channelId === undefined) {
    return refused({ why: `${reference}'s announcement names no channel` });
  }
  if (incident.channelId !== channelId) {
    return refused({ why: `${reference}'s own channel is ${incident.channelId}` });
  }
  return undefined;
}
