/**
 * RESOLVING THE PEOPLE AN ANSWER MENTIONS, in one place, so the same refusal reaches a session before a
 * reviewer is spawned and again at the send — rather than only at the send.
 *
 * ## The measured failure this exists for
 *
 * One ask: `cannot resolve a mention for "<a colleague's id>": no exact match in the identity map`,
 * FOUR times, each after the answer had already been composed and reviewed. The person was real and
 * resolves today; the derived roster had frozen behind a `derive` that refuses past the heap ceiling, which
 * `../../outbound/slack/mentionIndex.ts` names as the whole reason the member layer exists. Whatever the
 * cause, the shape of the loss is the point: an unaddressable mention is a property of the answer's own
 * bytes plus the roster, decidable before any reviewer exists, and it was costing whole review rounds.
 *
 * Reproduce the class over any live home with:
 *
 * ```
 * jq -r 'select(.kind=="failed") | .reason' "$SLOPWEAVER_HOME/live/slack/asks.jsonl" | grep 'cannot resolve a mention'
 * ```
 *
 * ## Why this is a move rather than a new check
 *
 * The logic is `../../cli/commands/turn/postAnswer.ts`'s own, lifted unchanged so both callers share one
 * definition. A second implementation would drift, and a pre-flight that passes what the send then refuses
 * is the failure being fixed, running twice. The send path still calls it: the answer changes between the
 * two points, and so can the roster.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { addressedGroupsOfCard, mentionedPeopleOfCard } from "../../outbound/artifact/runs.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import {
  groupRefusals,
  type MentionResolution,
  renderableMentions,
  staleRosterRefusals,
} from "../../outbound/slack/mentionIndex.js";
import { mentionsFromIdentity, mentionsFromRosterSnapshot } from "../../outbound/slack/mentionWiring.js";
import type { ResolvedMentions } from "../../outbound/slack/render.js";
import type { IdentityRosterPort, IdentityRosterSnapshot } from "../../silver/identityRoster.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/**
 * How the answer's people and groups are resolved against the identity layers — the real roster read in
 * production, which can trigger a just-in-time `derive`, and a fake in a test.
 */
export type AnswerMentionResolver = typeof mentionsFromIdentity;

/**
 * Every person the answer mentions, resolved to a Slack id — or why the answer cannot be sent.
 *
 * Refuses rather than guessing: mentioning the wrong colleague is worse than refusing, which is the roster's
 * own stated contract and not a policy this module adds. The roster is read ONCE and the three layers read
 * that one resolution, because a just-in-time `derive` behind it is minutes rather than milliseconds.
 *
 * @param answer the composed answer, whose body and index carry every mention run
 * @param home the state home holding the identity layers
 * @param askedAtIso when this answer's send was asked for, which the roster's freshness is judged against
 * @param resolveMentions how the keys are resolved; omitted, the real identity layers under `home`
 * @param identityRoster the door the human roster is read through — the store's row; its refusal is the answer's
 * @returns the id per mention key, or the refusal lines to print
 */
export async function resolveAnswerMentions({
  answer,
  home,
  askedAtIso,
  identityRoster,
  resolveMentions = mentionsFromIdentity,
}: {
  answer: AnswerFormAnswer;
  home: string;
  askedAtIso: string;
  identityRoster: IdentityRosterPort;
  resolveMentions?: AnswerMentionResolver;
}): Promise<Result<ResolvedMentions, TurnError>> {
  const people = mentionedPeopleOfCard({ detail: answer.body, index: answer.index });
  const groups = addressedGroupsOfCard({ detail: answer.body, index: answer.index });
  const resolved = await resolveMentions({ askedAtIso, groups, home, identityRoster, people });
  if (resolved.isErr()) {
    return err(TurnErrors.mentionsRosterUnread({ error: resolved.error }));
  }
  return judgedResolution({ people, resolution: resolved.value });
}

/**
 * {@link resolveAnswerMentions} over a roster snapshot the caller already read — for a send whose card ALSO
 * renders names off the roster, so the addresses and the names come from one read rather than two.
 *
 * @param answer the composed answer, whose body and index carry every mention run
 * @param home the state home holding the member index and the derived roster
 * @param askedAtIso when this answer's send was asked for, which the derived roster's freshness is judged against
 * @param roster the store's identity roster, read once by the send's composition root
 * @returns the id per mention key, or the refusal lines to print
 */
export function resolveAnswerMentionsFromSnapshot({
  answer,
  home,
  askedAtIso,
  roster,
}: {
  answer: AnswerFormAnswer;
  home: string;
  askedAtIso: string;
  roster: IdentityRosterSnapshot;
}): Result<ResolvedMentions, TurnError> {
  const people = mentionedPeopleOfCard({ detail: answer.body, index: answer.index });
  const groups = addressedGroupsOfCard({ detail: answer.body, index: answer.index });
  const resolution = mentionsFromRosterSnapshot({
    askedAtIso,
    conversationMembers: undefined,
    groups,
    home,
    people,
    snapshot: roster,
  });
  return judgedResolution({ people, resolution });
}

/** The refusals both entry points share, in their one order: an unresolved person, a refused group, a stale roster. */
function judgedResolution({
  people,
  resolution,
}: {
  people: readonly string[];
  resolution: MentionResolution;
}): Result<ResolvedMentions, TurnError> {
  const missing = people.filter((person) => !resolution.resolved.has(person));
  if (missing.length > 0) {
    return err(TurnErrors.mentionsUnresolved({ missing }));
  }
  const groupsRefused = groupRefusals({ resolution });
  if (groupsRefused.length > 0) {
    return err(TurnErrors.mentionsRefused({ reasons: groupsRefused }));
  }
  const stale = staleRosterRefusals({ people, resolution });
  if (stale.length > 0) {
    return err(TurnErrors.mentionsRefused({ reasons: stale }));
  }
  return ok(renderableMentions({ resolution }));
}
