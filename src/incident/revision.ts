/**
 * The revision fold every channel-keyed incident card shares — the incident note's `inc-<channel>-r<n>` and the
 * postmortem card's `pm-<channel>-r<n>`.
 *
 * A later card for the same channel re-cuts the open one rather than raising a second: the next number is one past
 * the highest ever POSTED, settled or not, so a settled revision's id is never reused; the one it supersedes is the
 * revision posted and not yet settled — counting a re-cut's settlement written on its posting's own line. More than
 * one open revision is ambiguous, and the caller refuses in its own domain's words.
 *
 * Pure: the register's rows in, the fold out.
 */
import type { HandRow } from "../hand/row.js";

/** One revision of a channel's card: its id, and the open revision it replaces. */
export interface IncidentRevision {
  readonly id: string;
  readonly supersedes?: string;
}

/**
 * The id every revision of one channel's card carries under one prefix, its revision number captured.
 *
 * @param kind the card's id prefix, `inc` or `pm`
 * @param channelId the incident channel's id
 * @returns `^<kind>-<channel id lowered>-r(<n>)$`
 */
export function channelRevisionPattern({ kind, channelId }: { kind: string; channelId: string }): RegExp {
  return new RegExp(`^${kind}-${channelId.toLowerCase()}-r(\\d+)$`, "u");
}

/**
 * The next revision of one channel's card, or every revision still open when more than one is.
 *
 * @param kind the card's id prefix, `inc` or `pm`
 * @param channelId the incident channel's id
 * @param rows every row the hand register holds
 * @returns the revision, or the open ids that make it ambiguous
 */
export function nextChannelRevision({
  kind,
  channelId,
  rows,
}: {
  kind: string;
  channelId: string;
  rows: readonly HandRow[];
}):
  | { readonly kind: "next"; readonly revision: IncidentRevision }
  | { readonly kind: "ambiguous"; readonly open: readonly string[] } {
  const pattern = channelRevisionPattern({ channelId, kind });
  const posted = new Set<string>();
  const settled = new Set<string>();
  // A bigint, never a number: `Number` of a long suffix the register can hold reads as `1e+34`, and the next id
  // built from it carries a `+` no step id may.
  let highest = 0n;
  for (const row of rows) {
    if (row.kind === "settled") {
      settled.add(row.id);
      continue;
    }
    if (row.settles !== undefined) {
      settled.add(row.settles.id);
    }
    const match = pattern.exec(row.step.id);
    if (match !== null) {
      posted.add(row.step.id);
      const number = BigInt(match[1]!);
      if (number > highest) {
        highest = number;
      }
    }
  }
  const open = [...posted].filter((id) => !settled.has(id));
  if (open.length > 1) {
    return { kind: "ambiguous", open };
  }
  const id = `${kind}-${channelId.toLowerCase()}-r${String(highest + 1n)}`;
  const supersedes = open[0];
  if (supersedes === undefined) {
    return { kind: "next", revision: { id } };
  }
  return { kind: "next", revision: { id, supersedes } };
}
