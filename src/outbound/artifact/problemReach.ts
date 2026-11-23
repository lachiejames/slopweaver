/**
 * A message about a POSSIBLE PROBLEM says, at the top, how many people it affects: one, a few, or many.
 *
 * ## The ruling
 *
 * A card about a possible problem states how many people it affects so the owner can size their response, and
 * it states it first. It is one of three steers that review kept catching after the fact, so doctrine rule 7 moves it into the form: a violation is REFUSED by the schema.
 *
 * ## The trigger is a declaration, never a keyword scan
 *
 * No content scan can decide that prose is "about a possible problem" — a hedge, a euphemism or a quoted error
 * title would each fool one. So the composer DECLARES it: `problem: {"kind":"none"}` or
 * `problem: {"kind":"possible","affects":"one"|"a few"|"many"}`. Every composed form accepts the field and
 * checks it when present; `slack draft record` requires it (`../../cli/commands/slack/problemDeclared.ts`; the
 * composer's guide is `skills/slack/reference/problem-reach.md`),
 * because a parked draft is the card the owner reads to size a response. A derived or scheduled card never declares
 * one, and the bot's `finding` card carries its own `blastRadius` (`./finding.ts`) instead.
 *
 * ## What "at the top" means, per form
 *
 * The first authored region a reader meets: a drip's first message, a one-card's first line, a one-list's or
 * no-fold's lead, an update's `tldr`. That region must carry the declared word in the author's own plain text —
 * not inside code, a link label or a quote, which are not the author's words. Nothing is synthesised into an as-me
 * message: the words stay the author's, and the schema only refuses a top that omits them.
 *
 * ## The finding card's vocabulary is not this one, on purpose
 *
 * A finding counts its reach (`./findingPriority.ts`: `one`, `few` 2–9, `some` 10–99, `many` 100+, `unknown`)
 * because that count drives its priority matrix. This rule's three words are what the owner reads. The two are
 * not renamed into each other: a finding already leads with its blast radius, and folding `some` into "a few"
 * would quietly move a priority boundary nobody asked to move.
 *
 * ## Stated residue
 *
 * A composer can declare `none` for a message that is about a problem, or write the word in a sentence that
 * negates it. The schema proves the message was classified and that the classification sits where the reader looks
 * first — never that the classification is true.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import type { InlineRun, ProblemDeclaration, ProblemReach } from "./types.js";

/** The three reach words, in the order they are read. */
const PROBLEM_REACH: readonly [ProblemReach, ...ProblemReach[]] = ["many", "a few", "one"];

/** The declaration every composed form accepts, and `slack draft record` requires. */
export const problemDeclarationSchema: z.ZodType<ProblemDeclaration> = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("none") }),
  strictForm({ affects: z.enum(PROBLEM_REACH), kind: z.literal("possible") }),
]);

/**
 * The author's own plain words in a run sequence: text runs that are neither code nor a quote, joined by a
 * space so two runs never weld into one word. A link label, a mention and a chip are not the author's words. Every
 * form's narrower run vocabulary is an {@link InlineRun}, so one reader serves them all.
 *
 * @param runs the top region's runs
 * @returns the authored text
 */
export function authoredTextOf({ runs }: { runs: readonly InlineRun[] }): string {
  return runs
    .flatMap((run) => (run.type === "text" && run.code !== true && run.quoted !== true ? [run.text] : []))
    .join(" ");
}

/**
 * Whether `text` carries `affects` as whole words, in any case — "A few" leads a sentence as well as it ends one.
 *
 * @param text the top region's authored text
 * @param affects the declared reach
 * @returns true when the word is there
 */
function statesReach({ text, affects }: { text: string; affects: ProblemReach }): boolean {
  const words = affects.split(" ").join("\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${words}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

/**
 * The refusal for a top region that does not say how many it affects, or nothing when it does or when the
 * message declares no possible problem.
 *
 * @param problem the form's declaration, absent when it made none
 * @param topText the authored text of the form's first region
 * @param region how the refusal names that region for this form
 * @returns the refusal message, or undefined when the top states the declared reach
 */
export function problemReachIssue({
  problem,
  topText,
  region,
}: {
  problem: ProblemDeclaration | undefined;
  topText: string;
  region: string;
}): string | undefined {
  if (problem?.kind !== "possible" || statesReach({ affects: problem.affects, text: topText })) {
    return undefined;
  }
  return (
    `this message declares a possible problem affecting "${problem.affects}", and its ${region} does not say so — ` +
    "a message about a possible problem states at the top how many people it affects, so the reader can size their " +
    `response. Put "${problem.affects}" in the ${region} in your own words (not inside code, ` +
    'a link or a quote), e.g. "this hits a few members". If it is not a problem, declare {"kind":"none"}.'
  );
}

/** What `slack draft record` says when a composed form makes no declaration at all. */
export const PROBLEM_UNDECLARED =
  'this draft declares no `problem`. Every draft says whether it is about a possible problem: add `"problem":' +
  '{"kind":"none"}`, or `"problem":{"kind":"possible","affects":"one"|"a few"|"many"}` with that word in its ' +
  "first line, so the reader can size their response before reading further.";

/**
 * Refuse, inside a form's `superRefine`, a declared possible problem whose top region does not say how many it
 * affects. One helper so every form names its region the same way.
 *
 * @param path where the issue points: the form's top region
 * @param region how the refusal names that region for this form
 * @param topText the authored text of that region
 */
export function addProblemReachIssue({
  ctx,
  path,
  problem,
  region,
  topText,
}: {
  ctx: z.RefinementCtx;
  path: readonly (string | number)[];
  problem: ProblemDeclaration | undefined;
  region: string;
  topText: string;
}): void {
  const message = problemReachIssue({ problem, region, topText });
  if (message !== undefined) {
    ctx.addIssue({ code: "custom", message, path: [...path] });
  }
}
