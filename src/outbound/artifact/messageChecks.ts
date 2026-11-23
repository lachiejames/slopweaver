/**
 * What a ONE-CARD artifact's width and a DRIP message's shape have to satisfy, and the two hints a refusal
 * carries so a composer can find the way out.
 *
 * Split out of `./schema.ts` (the file-size ratchet, step 4). The schemas themselves are declared in
 * {@link ./asMeSchema.js}, which delegates the per-message judgement here. Every function takes a Zod refinement context and reports into
 * it, so nothing here decides a verdict on its own.
 */
import type { z } from "zod";
import type { DripInlineRun } from "./types.js";
import { visibleLengthOfRuns } from "./visibleLength.js";

/**
 * The whole message's visible width, measured across every run sequence in it — the bound a caller cannot
 * satisfy by splitting.
 *
 * Takes the SEQUENCES rather than an artifact so the one-card and one-list forms share one cap. Those two
 * hold their runs under different field names and the same rule governs both: the bound is on the delivered
 * message, so a form that measured only its own field would let a caller move width into a sibling field.
 *
 * @param sequences every run sequence the message will render, in any order
 * @param path where the refusal points in the form the caller wrote
 * @returns nothing; an over-wide message is reported into `ctx`
 */
export function checkCardWidth({
  sequences,
  cardVisibleMax,
  ctx,
  path,
}: {
  sequences: readonly (readonly DripInlineRun[])[];
  cardVisibleMax: number;
  ctx: z.RefinementCtx;
  path: readonly (string | number)[];
}): void {
  const width = sequences.reduce((total, runs) => total + visibleLengthOfRuns({ citations: [], runs }), 0);
  if (width <= cardVisibleMax) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    message:
      `this card is ${String(width)} visible chars, over the ${String(cardVisibleMax)} cap — a discussion ` +
      "piece states the thing and links the detail rather than restating it. Cut it, or move the detail " +
      "into what the card links to. Splitting it into more lines will NOT help: this bound is on the whole " +
      "card, deliberately.",
    path: [...path],
  });
}

/**
 * A line's breaks come from the structure, so a `\n` inside one is a line the structure cannot see.
 *
 * Shared by the one-card and one-list forms, which is why the refusal names the FIELD it was given rather
 * than a hard-coded `lines`: both forms put their breaks in a structure, and pointing a one-list caller at
 * `lines` would name a field their form does not have.
 *
 * @param field the form field these runs came from, for the refusal to name
 * @param path where the refusal points in the form the caller wrote
 * @returns nothing; an embedded break is reported into `ctx`
 */
export function checkCardLineBreaks({
  ctx,
  field,
  path,
  runs,
}: {
  ctx: z.RefinementCtx;
  field: string;
  path: readonly (string | number)[];
  runs: readonly DripInlineRun[];
}): void {
  runs.forEach((run, runIndex) => {
    // Every visible string, a link LABEL included — the same reach as the drip's own check, and for the
    // same reason: a `\n` in a label breaks the render exactly as one in a text run does.
    let visible: string;
    if (run.type === "text") {
      visible = run.text;
    } else if (run.type === "link") {
      visible = run.label;
    } else {
      visible = "";
    }
    if (!/[\n\r]/.test(visible)) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message:
        `a ${field} entry carries no \`\\n\` of its own — \`${field}\` IS the line structure, so add another ` +
        "entry to it instead of embedding a break the preview cannot see.",
      path: [...path, "runs", runIndex],
    });
  });
}

/**
 * The trailing sentence naming the plain-body escape hatch, for the two refusals it speaks to.
 *
 * Exactly what the sentence claims, and it is worth being pedantic because five successive drafts of this
 * comment each claimed more and each was falsified by a one-line counterexample: **the two rules do not apply
 * in the plain lane.** That is all. Width and the newline rule are bounds the plain lane deliberately does not
 * have. The measured case that motivated it: a single approved message was refused three times — one width
 * breach, two newline violations — while `--body` was correct the whole time and nothing said so. This is a
 * DISCOVERABILITY fix; the flag existed and the validator never named it.
 *
 * It is NOT a promise that the send will succeed, and NOT a promise that the message will be identical:
 *
 * - a plain body is still bounded by the target platform's own maximum, which this module does not know
 *   (`plainArtifactSchema` takes it as a parameter precisely because it is a per-platform fact), so the
 *   sentence names that ceiling rather than pretending there is none;
 * - a plain body is parsed the way typed text is parsed, so unstyled text carrying platform markup — an
 *   asterisk pair, an underscore pair — GAINS meaning it did not have as a literal run. An adversarial pass
 *   found exactly that. The `<@U…>` this clause was first written about no longer reaches here: `./typedRuns.ts`
 *   converts raw mention markup to a `mention` run before any of these checks run, so it is a real mention on
 *   BOTH lanes now. Emphasis markup has no typed run to become and is still exactly as stated.
 * - a plain body's own raw `<@U…>` tokens are VERIFIED at the send seam even though nothing here reads them:
 *   an id nothing in the roster knows is refused, because Slack stores such a message and notifies nobody.
 *   The sentence names that, so following the hint cannot trade one refusal for a surprise one.
 *
 * The author still reads the preview. The hint points at a flag; it does not certify a result.
 *
 * TWO conditions gate it, and the second came from a review pass rather than from reasoning. The message must
 * be the drip's ONLY message, and every run in it must be UNSTYLED TEXT. These are conservative filters on
 * when the hint is likely to HELP rather than a proof that what follows is equivalent: a plain body is a bare
 * string with nowhere to put a link's target, a mention's identity or a bold span, so offering it for a
 * message built from those runs would be advising someone to flatten their own message and calling it a fix.
 * The counterexample that forced the second condition: a sole message holding one over-wide link label got the
 * hint, and following it could only have discarded the link.
 *
 * Every other refusal here is left alone, and deliberately WITHOUT a claim about what `--body` would do with
 * it, because that varies and any one sentence covering all of them is false. Two earlier drafts of this
 * comment each asserted a single mechanism and each was falsified by a one-line counterexample. What is
 * actually true, case by case: an unknown field or a bad run type WOULD send, with the structure flattened
 * into literal text and the link or mention silently gone — a downgrade dressed as a fix. An empty text run
 * would be refused all over again, because a plain body may not be empty either. Neither is a remedy, and
 * the only safe general statement is the narrow one above.
 *
 * Withheld for a MULTI-message drip, and that is the whole reason this is a function. `--body` sends exactly
 * one message, so telling someone with three messages and one over-wide line to use it would silently discard
 * the other two. There the honest advice is the split this already names.
 *
 * This is a deliberate, narrow coupling to a CLI spelling in an otherwise caller-agnostic module. It is here
 * because this is the only place that knows WHY the message was refused; a caller with no `--body` flag would
 * be reading a remedy it cannot offer, which is the cost being accepted rather than overlooked.
 */
function escapeHatchHint({ runs, soleMessage }: { runs: readonly DripInlineRun[]; soleMessage: boolean }): string {
  const carriesOnlyPlainText = runs.every(
    (run) => run.type === "text" && run.bold !== true && run.italic !== true && run.code !== true,
  );
  return soleMessage && carriesOnlyPlainText
    ? ", or send it as one plain message with `--body`, which applies neither rule — only the target platform's own maximum length. Private exact voice rules still apply at the send seam, and so does the check that every raw `<@U…>` in it names somebody the roster knows."
    : ".";
}

/**
 * The sentence naming the one-card form, for the refusal a caller hits when they wanted one message.
 *
 * A DISCOVERABILITY fix of exactly the kind {@link escapeHatchHint} documents, and it exists because this
 * refusal used to be a dead end: a caller who wanted ONE message with line breaks was told to split it into
 * two, which is the opposite of what they were asking for, and the only way through was the raw `--body`
 * escape hatch — which verifies no mentions and styles nothing. `{"kind":"one-card"}` is the answer, so the
 * refusal says so.
 *
 * Offered only for a SOLE message, on the same reasoning as the escape-hatch hint: someone with three
 * messages and one stray `\n` wants the split this already names, not a rewrite into one card.
 */
function oneCardHint({ soleMessage }: { soleMessage: boolean }): string {
  return soleMessage
    ? ', or — if this was always meant to be ONE message — send it as `{"kind":"one-card"}`, whose `lines` carry the breaks and whose mentions are verified the same way a drip\'s are'
    : "";
}

/**
 * One drip message's bounds: its visible width, and that it carries no newline.
 *
 * The newline check is not pedantry. The owner's measured answer was that a drip message has NO internal
 * line breaks — the gap between MESSAGES is the spacing, and that is the mechanical reason the drip shape
 * exists at all. A `\n` smuggled into a text run would quietly re-create the wall of text the shape avoids,
 * and unlike the width bound it would do so without tripping any other check.
 */
export function checkDripMessage({
  runs,
  index,
  messageVisibleMax,
  soleMessage,
  ctx,
}: {
  runs: readonly DripInlineRun[];
  index: number;
  messageVisibleMax: number;
  soleMessage: boolean;
  ctx: z.RefinementCtx;
}): void {
  const width = visibleLengthOfRuns({ citations: [], runs });
  if (width > messageVisibleMax) {
    ctx.addIssue({
      code: "custom",
      message:
        `drip message ${String(index)} is ${String(width)} visible chars, over the ` +
        `${String(messageVisibleMax)} cap — a drip message is a concise sentence or two, and the ` +
        `sequence is where the length goes. Split it into another message${escapeHatchHint({ runs, soleMessage })}`,
      path: ["messages", index],
    });
  }
  runs.forEach((run, runIndex) => {
    // EVERY visible string, not just a text run: a link's LABEL is rendered prose too, and a `\n` smuggled
    // into one would break the message across lines exactly as a text-run newline would. Checking only
    // text runs is the kind of near-miss that passes review and then shows up in a posted message.
    let visible: string;
    if (run.type === "text") {
      visible = run.text;
    } else if (run.type === "link") {
      visible = run.label;
    } else {
      visible = "";
    }
    if (!/[\n\r]/.test(visible)) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message:
        "a drip message carries NO internal line breaks — the gap between messages IS the spacing. " +
        `Split this into two messages instead of embedding a newline${oneCardHint({ soleMessage })}` +
        escapeHatchHint({ runs, soleMessage }),
      path: ["messages", index, "runs", runIndex],
    });
  });
}
