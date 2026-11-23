/**
 * The card a turn posts IN THREAD when one step is blocked on the owner — its words, and nothing else.
 *
 * Cut out of `./answer.ts`, which had grown to carry three unrelated notice families plus the checklist
 * primitives all three are built from. This one is the family with the narrowest reach: exactly one caller
 * (`../../cli/commands/turn/block.ts`), its own test file, and an editorial rule that is not the other
 * notices' — `./blockedOnHuman.ts`'s three rails, which say this card never reads as a failure, never states
 * a time, and never reports the turn as done. `./answer.ts` keeps the shared primitives this imports back;
 * the dependency runs one way only, and a builder that needs the OTHER direction belongs there, not here.
 *
 * Pure, exactly as `./answer.ts` is: nothing here posts, reads a clock or touches the corpus.
 */
import { TLDR_VISIBLE_MAX } from "../../outbound/artifact/schema.js";
import type { InlineRun } from "../../outbound/artifact/types.js";
import { clampVisible, notesBullets, proseParagraph, provenanceRuns, type TurnAnswerCard } from "./answer.js";
import { questionForPlainField } from "./quotedQuestion.js";

/**
 * What a blocked turn is waiting for, in the words the THREAD is told — never the operator's.
 *
 * Two arms rather than a free string, mirroring `../ask/lifecycle.ts`'s `BlockedNeed`, because the two ask a
 * watching colleague to understand different things: a sign-in is a chore, and an approval is a judgement the
 * owner has reserved. `other` reads as neither and says only that it needs the owner.
 *
 * @internal — the vocabulary {@link turnBlockedForm} renders; callers pass a `BlockedNeed` straight through.
 */
export type BlockedNeedWording = "sign-in" | "risky-approval" | "ruling" | "other";

/**
 * The clause naming what kind of thing is owed, per need. Pure.
 *
 * Every one of them is about ACCESS or PERMISSION and none of them is about the bot: that is the whole
 * editorial rule of this card, and it is the owner's — _"it is not that the bot fails, it is not that the
 * bot is crap, it is just that the bot got blocked on something that the owner is the only one that can
 * solve."_
 *
 * @param need which of the two shapes this block is
 * @returns the clause, with no trailing punctuation
 */
function blockedNeedClause({ need }: { need: BlockedNeedWording }): string {
  switch (need) {
    case "sign-in":
      return "this needs a sign-in only they can do";
    case "risky-approval":
      return "this one is risky enough that they approve it before I do it";
    case "ruling":
      // The tag decision tree's step (d).
      return "they haven't made a general ruling on this yet, bringing them in to approve this one";
    case "other":
      return "this step is theirs to do";
  }
}

/**
 * The card a turn posts IN THREAD when a step is blocked on the owner — the tag, and the one thing the owner
 * has to do.
 *
 * The bot tags the owner where the work is happening, so the asker and anyone watching can see what the
 * hold-up actually is: the owner keeps an eye on Slack anyway and expects the tag in the thread.
 *
 * **This is not `turnFailureForm` with softer words, and the difference is structural.** A failure card
 * says no answer is coming and tags the owner to go and find out why. This one says an answer IS coming, names the
 * single thing standing between the thread and it, and promises the turn picks up from where it stopped. So
 * it carries no `cause`, no coverage manifest and no fold full of the ending's own words — there is no
 * ending to report. What it carries instead is the resume promise, which is the fact the reader is actually
 * owed.
 *
 * **No time is ever stated, anywhere on it.** _"Might be one minute, might be one week, it should not
 * necessarily be constrained on time."_ So the card never says "shortly", never estimates, and never implies
 * a deadline the owner has not agreed to.
 *
 * @param need which of the two shapes this block is
 * @param question the question as asked
 * @param names what each Slack user id in the question reads as — see `questionForPlainField`
 * @param what the one colleague-safe sentence saying what the owner has to do
 * @param modelId the model working the turn
 * @param ownerMention the identity-map key to tag, or `undefined` when no owner is configured — in which
 *   case no tag line is written at all, exactly as `turnFailureForm` does, because claiming a human was
 *   pulled in when nobody was pinged is the lie both cards exist to avoid
 * @returns the form and the list of fields it had to shorten
 */
export function turnBlockedForm({
  need,
  question,
  names = {},
  what,
  modelId,
  ownerMention,
}: {
  need: BlockedNeedWording;
  question: string;
  names?: Readonly<Record<string, string>>;
  what: string;
  modelId: string;
  ownerMention?: string | undefined;
}): TurnAnswerCard {
  const tldr = blockedTldr({ names, question });
  const notes = [
    "Nothing is lost — the work so far is on the checklist above, and the turn picks up from exactly there.",
    "There is no clock on this. It stays open until the owner has done it, however long that takes.",
  ];
  if (ownerMention === undefined) {
    notes.push("Nobody was tagged — no `slackBot.ownerUserId` is configured in profile.json.");
  }
  if (tldr.shortened) {
    notes.push("The question was shortened to fit the lead line; it is quoted whole in the thread above.");
  }
  return {
    artifact: {
      citations: [],
      detail: [
        proseParagraph({
          text: `The one step left is theirs:${what} Once that is done I carry straight on and answer here.`,
        }),
        notesBullets({ notes }),
        { runs: provenanceRuns({ modelId }), type: "paragraph" },
      ],
      index: blockedIndex({ need, ownerMention, what }),
      kind: "update",
      media: [],
      tldr: tldr.text,
    },
    clamped: tldr.shortened ? ["tldr"] : [],
  };
}

/**
 * The above-the-fold index of a blocked card: the tag and the ask, then the reassurance.
 *
 * The tag line comes FIRST here, where `failureIndex` puts the bar first, and the ordering is the
 * point: on a failure card the reader's first question is whether the bot is broken, and on this one the
 * answer to that is "no, it is waiting on a person" — which is only true if the person is the first thing on
 * the card.
 *
 * @param need which of the two shapes this block is
 * @param ownerMention the identity-map key to tag, or `undefined` when no owner is configured
 * @param what the one colleague-safe sentence saying what the owner has to do
 * @returns the index lines, in display order
 */
function blockedIndex({
  need,
  ownerMention,
  what,
}: {
  need: BlockedNeedWording;
  ownerMention: string | undefined;
  what: string;
}): readonly (readonly InlineRun[])[] {
  const clause = blockedNeedClause({ need });
  if (ownerMention === undefined) {
    return [
      [{ text: `Waiting on the owner — ${clause}: ${what}`, type: "text" }],
      [{ text: "I pick this up again the moment it is done.", type: "text" }],
    ];
  }
  return [
    [
      { person: ownerMention, type: "mention" },
      { text: ` — ${clause}: ${what}`, type: "text" },
    ],
    [{ text: "Everything else is done; I pick this up again the moment they have.", type: "text" }],
  ];
}

/**
 * The one sentence a blocked card leads with — already inside `TLDR_VISIBLE_MAX`.
 *
 * Built rather than clamped whole for the same reason `failureTldr` is: the QUESTION is what gets
 * shortened, never the frame, because the clause a reader needs is the one saying the turn is waiting rather
 * than finished.
 *
 * @param question the question as asked
 * @param names what each Slack user id in the question reads as — see `questionForPlainField`
 * @returns the lead sentence, and whether the question had to be shortened to fit it
 */
function blockedTldr({ names, question }: { names: Readonly<Record<string, string>>; question: string }): {
  readonly text: string;
  readonly shortened: boolean;
} {
  const before = 'Still on "';
  // A full stop rather than an em dash, for the reason `failureTldr` carries in full: a separator
  // between two ideas is never authored here (an owner ruling).
  const after = '". One step needs the owner before I can finish it.';
  // Resolved before the clamp, for the reason `failureTldr` states beside its own call.
  const prose = questionForPlainField({ names, question });
  const asked = clampVisible({ cap: TLDR_VISIBLE_MAX - before.length - after.length, text: prose });
  return { shortened: asked !== prose, text: `${before}${asked}${after}` };
}
