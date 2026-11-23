/**
 * Where a `finding` card may go: the channel and thread the owner approved it for on a queue card, as the bot —
 * never a direct message, and never without the owner's yes.
 *
 * A finding goes to the relevant team channel, never a top-level post in the owner's bot DM that is forwarded by
 * hand.
 *
 * There is no destination rule. Each finding is judged as the owner would judge it — which team owns it, whether
 * there is a team bugs or team channel, a subteam to tag, and whether the owner is comfortable putting it in front
 * of people — and for now every one is a queue card naming the draft, the channel and thread, who to tag and why.
 * A conversation started in the wrong channel loses trust with the people using it, so sending autonomy
 * graduates only once the fleet's picks prove right on cards (rule 10, reeled in).
 *
 * So this hold names no channel and no placement. What it admits is the approved share: a finding parked with
 * `slack draft record --as bot --channel <channel> [--thread-ts <root ts>]` and released on the owner's approval.
 * `approvedDraft` is set ONLY by that recording and that release, never from argv, so an unasked bot post of a
 * finding is refused here wherever it is aimed — the owner's DM included.
 *
 * ## No hatch, and the refusal says so
 *
 * The correction is always available — park it as a card — so an override would only ever send a finding the
 * owner has not seen, or into a DM a finding does not go to.
 */
import { FINDING_KIND } from "../artifact/finding.js";

/**
 * A Slack id that can only name a direct conversation: a `D…` DM, or a `U…`/`W…` user id Slack opens one with.
 * A finding is for a team, so no direct conversation is ever its destination.
 */
const DIRECT_MESSAGE_ID = /^[DUW][A-Z0-9]+$/;

/** The line every refusal ends on, because the correction is always available. */
const NO_HATCH = "There is deliberately NO escape hatch here: the correction is always available.";

/**
 * Hold a `finding` send that is not an approved share into a team's channel or one of its threads.
 *
 * Returns an EMPTY list for every other form kind, so a caller asks unconditionally.
 *
 * @param formKind the bot form kind that produced the card
 * @param approvedDraft whether the send is a parked draft's recording or its release on the owner's approval
 * @param channel where the send is aimed
 * @returns the hold's lines, or nothing when the send may proceed
 */
export function findingDestinationRefusal({
  formKind,
  approvedDraft,
  channel,
}: {
  formKind: string;
  approvedDraft: boolean;
  channel: string;
}): readonly string[] {
  if (formKind !== FINDING_KIND) {
    return [];
  }
  const problems: string[] = [];
  if (DIRECT_MESSAGE_ID.test(channel)) {
    problems.push(`${channel} is a direct message, and a finding goes to the owning team's channel, never a DM`);
  }
  if (!approvedDraft) {
    problems.push("it is not a parked draft the owner approved, and a finding reaches a team only on the owner's yes");
  }
  if (problems.length === 0) {
    return [];
  }
  return [
    `this finding cannot go out as asked: ${problems.join(". Also, ")}. Every finding is a ` +
      "queue card naming the channel and thread, who to tag and why, and goes out as the bot on the owner's yes, never a DM.",
    "Park it with `slopweaver slack draft record --as bot --channel <team channel> [--thread-ts <root ts>] --form - " +
      '--why "<…>" --media a,b,c`; it is released by `slack post` (or `slack reply` for a thread) `--as bot --draft ' +
      "<id> --approve <digest>` on the owner's yes.",
    NO_HATCH,
  ];
}
