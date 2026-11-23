/**
 * The voice verdict on a draft the talk console offers the owner as THEIR OWN words — the voice's add to their running
 * list (`site/lib/runningListCopy.ts`). Pure: the text and the owner's rules in, accepted or the reasons it was refused
 * out.
 *
 * The tray is the as-me surface no send door ever sees: the owner copies the words and posts them under their own
 * name, in Slack or on a pull request, so a rule the door would have refused reaches the world unless something
 * refuses it here. Measured: the console put a review comment carrying an em dash in the tray, and the owner had to
 * cut it by hand before posting.
 *
 * The decision is exactly `./exactRules.ts`'s matcher over the `me` lane, so a rule means the same thing here as at
 * the send door. There is no hatch: the tray sends nothing, and the model it refuses rewrites and offers again. A
 * reason names the rule and the line, never the message, so nothing it returns copies the owner's words anywhere.
 *
 * **A Slack message is held to the parked-draft shape too.** A draft that ran one sentence past its question, or went
 * too long at the end, was spoiled by the extra words. So an offer the voice marks for Slack (`slackDraft`) also passes
 * `../slack/draftEarnsItsPlace.ts` — the
 * caps `slack draft record --as me` enforces, and a paragraph that asks ending on its ask — read off the mrkdwn by
 * `./copyDraftSequences.ts`. Each shape reason is the finding's `blindFix`, which names counts and paragraph numbers
 * and never a fragment. A review comment, a script or talking points are judged by the exact rules alone: a talk
 * opening the owner will say is three paragraphs and lands.
 *
 * **A Slack message on the tray is also refused as one dense paragraph**, which the parked-draft shape never sees:
 * its caps are on the whole message, so one 84-word block of seven ideas passed every one, and the owner found it
 * needed more vertical white space. So no
 * authored paragraph may run past {@link COPY_PARAGRAPH_WORDS_MAX} words. This one rule is the tray's alone: `slack
 * draft record --as me` keeps the shape its own header measured, and nothing here has measured that register.
 */
import type { DripInlineRun } from "../artifact/types.js";
import { earnsItsPlaceFindingsOf } from "../slack/draftEarnsItsPlace.js";
import { copyDraftSequences } from "./copyDraftSequences.js";
import {
  authoredProseOf,
  type ExactVoiceRule,
  exactVoiceRuleFindings,
  rulesForActor,
  voiceRuleLabel,
} from "./exactRules.js";

/** What the tray is told about one proposed draft. */
export type CopyVoiceVerdict =
  { readonly kind: "accepted" } | { readonly kind: "refused"; readonly reasons: readonly string[] };

/** How every copy-tray refusal ends: what the model does next. */
const REWRITE = "Rewrite the message in the configured voice and call offer_copy again.";

/** How a shape refusal ends: the words were the owner's voice, the message ran past where they would end it. */
const RECUT = "Cut it to that shape and call offer_copy again.";

/**
 * The most authored words one paragraph of a Slack message on the tray carries. Fit to the two drafts the owner judged
 * on exactly this axis, which is all it is fit to: the 64-word single paragraph taken as written (`MONITORS_CUT`)
 * lands, and the 84-word one called cramped is refused. Between the two is unmeasured. The shape memory's "50 words
 * is a ceiling" is on an everyday reply as a whole, and taking it here would refuse the draft called perfect. Repro: both are cases in
 * `src/__tests__/unit/outbound/voice/copyVerdict.test.ts`.
 */
export const COPY_PARAGRAPH_WORDS_MAX = 70;

/**
 * The words the owner reads as the author's own in one paragraph: plain text, a link's label and one per mention, group
 * or broadcast. Somebody else's quoted words and code are not the owner's prose, so a quote and its answer count the answer.
 *
 * @returns the count of whitespace tokens carrying a letter or a digit, as the parked-draft shape counts a word
 */
function authoredParagraphWords({ runs }: { runs: readonly DripInlineRun[] }): number {
  const text = runs
    .map((run) => {
      if (run.type === "text") {
        return run.code === true || run.quoted === true ? " " : run.text;
      }
      if (run.type === "link") {
        return ` ${run.label} `;
      }
      return " @someone ";
    })
    .join("");
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * One reason per paragraph past {@link COPY_PARAGRAPH_WORDS_MAX}, naming its number and count, never its words. The
 * number counts the paragraphs `./copyDraftSequences.ts` returns, exactly as the parked-draft shape's `trailing`
 * reason numbers them: a quote-only block takes a number, a list takes none.
 *
 * @param sequences the message's counted paragraphs, a list's bullets already left out
 * @returns the reasons, in reading order
 */
function denseParagraphReasons({ sequences }: { sequences: readonly (readonly DripInlineRun[])[] }): readonly string[] {
  const reasons: string[] = [];
  for (const [index, runs] of sequences.entries()) {
    const words = authoredParagraphWords({ runs });
    if (words > COPY_PARAGRAPH_WORDS_MAX) {
      reasons.push(
        `shape paragraph-words: paragraph ${String(index + 1)} has ${String(words)} words, past ` +
          `${String(COPY_PARAGRAPH_WORDS_MAX)}: break it into short paragraphs, one idea each, a blank line between ` +
          `them. ${RECUT}`,
      );
    }
  }
  return reasons;
}

/**
 * Judge one proposed copy-tray draft against the owner's exact `me`-lane voice rules and, for a Slack message, the
 * shape a Slack draft is trimmed to.
 *
 * @param text the draft, exactly as the owner would paste, say or react to it
 * @param rules the operator's whole exact-rule list, before the actor split
 * @param slackDraft true when the owner will post it in Slack in their own name, so the earns-its-place shape binds it too
 * @returns accepted, or one reason per rule and line it breaks, exact rules first
 */
export function copyVoiceVerdict({
  text,
  rules,
  slackDraft,
}: {
  text: string;
  rules: readonly ExactVoiceRule[];
  slackDraft: boolean;
}): CopyVoiceVerdict {
  const exact = exactVoiceRuleFindings({
    prose: authoredProseOf({ path: "text", text }),
    rules: rulesForActor({ actor: "me", rules }),
  }).map((finding) => `${finding.path} ${voiceRuleLabel({ rule: finding.rule })}. ${REWRITE}`);
  const reasons = [...exact];
  if (slackDraft) {
    const sequences = copyDraftSequences({ text });
    for (const finding of earnsItsPlaceFindingsOf({ sequences })) {
      reasons.push(`shape ${finding.rule}: ${finding.blindFix}. ${RECUT}`);
    }
    reasons.push(...denseParagraphReasons({ sequences }));
  }
  if (reasons.length === 0) {
    return { kind: "accepted" };
  }
  return { kind: "refused", reasons };
}
