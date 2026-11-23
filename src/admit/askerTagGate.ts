/**
 * The gate that refuses to send an answer which never tags the person who asked for it.
 *
 * ## The measured failure
 *
 * One channel thread, reconstructed live from the ask ledger and the thread itself. A colleague
 * asked a question; the bot answered it 4h56m later, and that card contains **zero** mention runs. The very
 * next bot card in the same thread told the owner the answer was *"up in this thread, as its own reply
 * attributed to them"* — and it was, in the ledger, to the ask's own `messageTs`. Nothing in Slack tagged
 * them, so the one person the answer existed for was never notified. The owner noticed unprompted, and the
 * owner's stated ideal for that thread named *the answer TAGGING* the colleague who asked.
 *
 * The machinery was never missing. The typed `{"type":"mention"}` run is declared in
 * `../outbound/artifact/schema.ts`, an earlier card in that same thread used it twice, and
 * `../live/turn/failureForm.ts` already force-mentions the owner on a failure card. What was missing was the
 * REQUIREMENT, which is why doctrine rule 7 puts it here: shape is enforced by the form, never by review.
 *
 * ## The three edges, settled
 *
 * The duty is decided by {@link answerMustTagAsker} alone, from three facts, and each exemption is a case
 * where the tag would be noise rather than a notification:
 *
 * - **The asker is the composing session's own owner.** The owner is watching the thread they asked in; a card that
 *   pings them for answering their own question is the gratuitous tag this gate must not create. Exempt.
 * - **The surface is a DM.** Slack notifies its only other participant on every message there, so the
 *   notification this rule exists to produce already happened. Exempt. A CHANNEL thread where the asker is
 *   the sole other participant is NOT exempt: visibility was never the point, the ping was.
 * - **Anyone else, in a channel.** Owed.
 *
 * **A compound instruction — the owner asking on a colleague's behalf — is deliberately NOT a fourth arm.**
 * In the measured thread the owner did exactly that, telling the bot to also answer the question the
 * colleague had just asked; the honest reading is that the mention travels with the ask that the answer
 * discharges, and that colleague's own question was captured as its own ask, so it is the one that owed the
 * tag. Deciding "on whose behalf" from a question's own bytes is not decidable in general — *"summarise
 * what @a and @b shipped"* names two people the answer is ABOUT and neither is its audience — and this
 * repository's rule for that split is already written, in `./requestedDeliverables.ts`: gate the part that
 * is a property of the bytes, RENDER the part that is a judgement. So the compound case is carried by
 * {@link askerTagPreflightLines}, in the worker's own brief, and never by a keyword match here.
 *
 * ## `warn`, like every other gate on this path
 *
 * The house rule is block-by-default WITH a break-glass. One real case needs it: a person the roster cannot
 * address at all — the mention would be refused by `../outbound/slack/mentionIndex.ts` before it could ping
 * anybody — and a gate that demands an impossible tag is a deadlock rather than a gate. The finding names
 * that exit, so it is self-correctable, and the door records every override it waives.
 */

import { mentionedPeopleOfCard } from "../outbound/artifact/runs.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import type { DoorFinding, DoorGate } from "./types.js";
import type { ReplySurface } from "./withhold.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the docs and tests quote it rather than re-spelling it.
 */
export const ASKER_TAG_OVERRIDE = "answer.tag-asker:v1";

/** The finding code an untagged answer fires. */
export const ASKER_TAG_CODE = "ANSWER_DOES_NOT_TAG_ASKER";

/**
 * Whether this answer owes its asker a typed mention, and — when it does not — why not.
 *
 * A discriminated union rather than a boolean, because the REASON is what the worker's pre-flight prints and
 * what a reader of the door ledger needs; "false" alone cannot say whether the asker was the owner or the
 * surface was a DM.
 *
 * @internal — exported so a test can name an arm without going through a finding.
 */
export type AskerTagDuty =
  { readonly kind: "owed"; readonly askedBy: string } | { readonly kind: "exempt"; readonly why: string };

/**
 * Whether an answer must carry a typed mention of the person who asked. Pure and total — the whole decision
 * is decidable from these three facts; see this module's header for why each exemption is one.
 *
 * @param askedBy the Slack user id that addressed the bot
 * @param ownerUserId the composing session's own owner, or `undefined` when `profile.json` declares none —
 *   in which case every asker is someone other than the owner, and the duty stands
 * @param surface where the reply lands
 * @returns the duty, or the exemption and its reason
 */
export function answerMustTagAsker({
  askedBy,
  ownerUserId,
  surface,
}: {
  askedBy: string;
  ownerUserId: string | undefined;
  surface: ReplySurface;
}): AskerTagDuty {
  if (surface === "dm") {
    return {
      kind: "exempt",
      why: "this is a 1:1 DM — Slack already notifies its only other participant on every message, so a tag adds nothing",
    };
  }
  if (askedBy === ownerUserId) {
    return {
      kind: "exempt",
      why: "the asker is this session's own owner, who is watching the thread they asked in — tagging them back is noise",
    };
  }
  return { askedBy, kind: "owed" };
}

/**
 * Whether the composed answer tags one Slack user id anywhere a reader's client would see it.
 *
 * Reads BOTH regions a card renders runs in — `index` above the fold and `body` below it — because the
 * notification fires either way and the rule is about the ping, not its placement. Deliberately does NOT
 * count a `broadcast` run: `@here`/`@channel` notifies a room, and the duty here is owed to a person.
 *
 * @param answer the composed answer about to be sent
 * @param mentions every mention key this send already resolved, key → Slack user id
 * @param slackId the user id to look for
 * @returns whether some `mention` run in the answer resolves to that id
 */
export function answerTagsSlackId({
  answer,
  mentions,
  slackId,
}: {
  answer: AnswerFormAnswer;
  mentions: ReadonlyMap<string, string>;
  slackId: string;
}): boolean {
  return mentionedPeopleOfCard({ detail: answer.body, index: answer.index }).some(
    (person) => mentions.get(person) === slackId,
  );
}

/**
 * The finding for an answer that owes its asker a tag and does not carry one.
 *
 * One finding or none — unlike `./coreDeliverableGate.ts`'s list, there is exactly one person this can be
 * about, so a list would only ever hold zero or one entry.
 *
 * @param answer the composed answer about to be sent
 * @param askedBy the Slack user id that addressed the bot
 * @param mentions every mention key this send already resolved, key → Slack user id
 * @param ownerUserId the composing session's own owner, or `undefined` when none is configured
 * @param surface where the reply lands
 * @returns the finding, or empty when the duty is exempt or already discharged
 */
export function askerTagFindings({
  answer,
  askedBy,
  mentions,
  ownerUserId,
  surface,
}: {
  answer: AnswerFormAnswer;
  askedBy: string;
  mentions: ReadonlyMap<string, string>;
  ownerUserId: string | undefined;
  surface: ReplySurface;
}): readonly DoorFinding[] {
  const duty = answerMustTagAsker({ askedBy, ownerUserId, surface });
  if (duty.kind === "exempt") {
    return [];
  }
  if (answerTagsSlackId({ answer, mentions, slackId: duty.askedBy })) {
    return [];
  }
  return [
    {
      code: ASKER_TAG_CODE,
      correction:
        `add {"type":"mention","person":"${duty.askedBy}"} to an \`index\` line, above the fold — a Slack ` +
        "user id is an addressable mention key. If the roster genuinely cannot address them, that mention " +
        `would be refused before it pinged anyone, so waive this with SLOPWEAVER_DOOR_OVERRIDE=${ASKER_TAG_OVERRIDE} ` +
        "and say in the answer that they could not be tagged.",
      override: ASKER_TAG_OVERRIDE,
      severity: "warn",
      summary:
        `this answer is for ${duty.askedBy} and mentions them nowhere, so posting it notifies nobody — ` +
        "attribution in the ledger is not a notification in Slack",
    },
  ];
}

/**
 * The asker-tag gate, ready to compose into the door's gate list.
 *
 * @param answer the composed answer about to be sent
 * @param askedBy the Slack user id that addressed the bot
 * @param mentions every mention key this send already resolved, key → Slack user id
 * @param ownerUserId the composing session's own owner, or `undefined` when none is configured
 * @param surface where the reply lands
 * @returns a `DoorGate` that reports an answer which never tags the person it was written for
 */
export function askerTagGate({
  answer,
  askedBy,
  mentions,
  ownerUserId,
  surface,
}: {
  answer: AnswerFormAnswer;
  askedBy: string;
  mentions: ReadonlyMap<string, string>;
  ownerUserId: string | undefined;
  surface: ReplySurface;
}): DoorGate {
  return () => askerTagFindings({ answer, askedBy, mentions, ownerUserId, surface });
}

/**
 * The worker's pre-flight lines for this ask — what it owes the asker, and the compound case the gate
 * deliberately does not decide.
 *
 * Rendered rather than enforced for the same reason `./requestedDeliverables.ts` splits its own two halves:
 * "does the answer tag its asker" is a property of the bytes and is gated above, while "the owner asked this
 * FOR someone else, so tag them instead" is a judgement only a reader of the question can make.
 *
 * @param askedBy the Slack user id that addressed the bot
 * @param ownerUserId the composing session's own owner, or `undefined` when none is configured
 * @param surface where the reply will land
 * @returns the lines to print, in order
 */
export function askerTagPreflightLines({
  askedBy,
  ownerUserId,
  surface,
}: {
  askedBy: string;
  ownerUserId: string | undefined;
  surface: ReplySurface;
}): readonly string[] {
  const duty = answerMustTagAsker({ askedBy, ownerUserId, surface });
  const owed =
    duty.kind === "owed"
      ? [
          `  The send door REFUSES an answer that mentions ${duty.askedBy} nowhere (break-glass ${ASKER_TAG_OVERRIDE}).`,
          `  Put {"type":"mention","person":"${duty.askedBy}"} in an \`index\` line — above the fold, where the`,
          "  answer opens by addressing the person it is for.",
        ]
      : [`  No tag is owed here: ${duty.why}. Do not add one for form's sake.`];
  return [
    "TAG WHOEVER THIS ANSWER IS FOR — attribution is not notification:",
    ...owed,
    "  If the question was raised on somebody ELSE's behalf — an instruction to answer what another person",
    "  asked — they are the audience, and they get the tag too. The door cannot decide that from the",
    "  question's own words, so it is yours to get right: a person named as the SUBJECT of a question is not",
    "  its audience, and tagging them is noise.",
  ];
}
