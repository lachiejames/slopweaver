/**
 * A card's TL;DR as CLAUSES, and the one separator that joins them.
 *
 * ## The failure this exists to prevent
 *
 * A card could not post because its TL;DR carried a hard-coded em dash separator. The rule that follows: make
 * a repeat structurally impossible by keeping the Slack message schema strict, so a composer fills in a form
 * rather than freeform prose, which costs less than catching a mistake after the fact or following a long
 * skill file.
 *
 * A separator is punctuation BETWEEN two ideas, so the only author who can get it wrong is one holding both
 * ideas in one string. Take the two ideas as two fields and there is nowhere left to type one. That is the
 * whole mechanism: this module owns {@link HEADLINE_SEPARATOR} and every composer owns only its own words.
 *
 * ## Why this is not a character ban on `tldr`
 *
 * The obvious move — refuse a separator character on `updateArtifactSchema`'s `tldr` — refuses the two
 * lanes that already do the right thing, and misses every lane that does not. `./digest.ts` and
 * `./alertSummary.ts` DERIVE their TL;DR and then re-validate the derived card through
 * `updateArtifactSchema` (`./botFormLanes.ts`'s `validateDerivedCard`), so a card
 * carrying this module's own separator would be refused by the check meant to protect it. Meanwhile the
 * composers that hand-build a `kind: "update"` never reach the CLI form parser at all.
 *
 * `tldr` is also a plain string with no run typing, so it has no `quoted` flag to exempt — and
 * `./aboveFold.ts`'s header records what a character rule over untyped text costs: a whole-artifact scan
 * once blocked a quoted ticket title for an em dash, and two of the ten team alerts channels
 * lost their first daily card because a Datadog monitor title held one. So the refusal belongs on the
 * AUTHORED clause, where the words are provably the composer's own, and never on the rendered line.
 *
 * ## Why an ordered LIST rather than named cells
 *
 * A fixed `subject`/`state`/`qualifier` triple would force every composer that writes one sentence to cut
 * it into three, changing what a reader sees on a live card for no reason anybody asked for. A list of ONE
 * clause renders byte-identically to the string it replaces, so a sentence-shaped headline migrates with no
 * visible change and still gains the structure. {@link HEADLINE_CLAUSES_MAX} is 3 because past three
 * clauses a headline is a paragraph, and the width promise below has to stay provable.
 *
 * ## The runtime refusal keeps its hatch; the no-hatch half is a LINT gate
 *
 * A runtime hard block is wrong, and every such refusal carries an escape hatch. Nothing here adds one. The send-time voice rules keep the `voice-rules` grant
 * (`../voice/exactRules.ts`), and the half that has no hatch is `authored-separator` in `yarn lint`, which
 * `.claude/rules/error-handling.md` names as the one refusal that is allowed none — and which says so.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { TLDR_VISIBLE_MAX } from "../assistant/contentLimits.js";
import { strictForm } from "../strictForm.js";

/**
 * The ONE separator between a headline's clauses, rendered with a space on each side.
 *
 * A middot rather than an em dash, and that is not taste: `./alertSummary.ts` already chose it for exactly
 * this position and shipped it, so adopting anything else would leave two derived TL;DRs that agree only by
 * luck. It moved here so the tree holds one of these rather than one per lane.
 */
export const HEADLINE_SEPARATOR = "·";

/** The separator as rendered, spaces included. Three UTF-16 units, which is what the width promise spends. */
const JOINER = ` ${HEADLINE_SEPARATOR} `;

/**
 * Every character a clause may not contain, because each one is a separator somebody would otherwise type.
 *
 * The em dash is the measured case and the en dash is the same key on a different keyboard layout; the
 * middot is this module's own joiner, and a pipe is the separator a composer reaches for when the other
 * three are refused. A hyphen is deliberately absent — it is a word's own punctuation far more often than
 * it is a separator, and refusing `re-run` to catch `a - b` is the over-reach this file's header rejects.
 */
const SEPARATOR_CHARACTERS = ["—", "–", HEADLINE_SEPARATOR, "|"] as const;

/**
 * How many clauses a headline may carry. See this file's header for why three.
 */
export const HEADLINE_CLAUSES_MAX = 3;

/**
 * The visible ceiling on ONE clause, and on the whole rendered line.
 *
 * One number rather than two, because the honest bound is the LINE: a single-clause headline is the whole
 * line, so anything tighter would refuse a legal headline for being one field instead of two. Dividing the
 * line by {@link HEADLINE_CLAUSES_MAX} was tried and rejected — it gave 58, which is shorter than several
 * headlines already shipping, so it would have made the structured form strictly less expressive than the
 * strings it replaces, and a composer's only way out would have been to keep typing a separator.
 *
 * The line as a whole is bounded by {@link headlineSchema}'s own refine, which measures what
 * {@link renderHeadline} actually produces, joiners included. That is the only measurement that cannot drift
 * from the rendered card, and `headline.test.ts` pins it against a maximal fixture rather than trusting this
 * comment — the practice `./alertSummary.ts`'s header records, where every number restated in prose has gone
 * stale at least once.
 */
export const HEADLINE_VISIBLE_MAX = TLDR_VISIBLE_MAX;

/** The separator a clause carries, or nothing when it carries none. */
function separatorIn({ text }: { text: string }): string | undefined {
  return SEPARATOR_CHARACTERS.find((character) => text.includes(character));
}

/**
 * The refusal a clause carrying a separator reads, naming the field boundary as where it belongs.
 *
 * The non-null assertion is the honest spelling rather than a fallback: this is only ever reached from the
 * refine below, which has already established that the value HAS one. A substituted character would put a
 * separator in the message that is not the one the author typed, which is a message that lies.
 */
function separatorMessage({ text }: { text: string }): string {
  const character = separatorIn({ text })!;
  return (
    `a headline clause cannot contain "${character}" — a separator is punctuation BETWEEN two ideas, and ` +
    "this form has a field boundary for that. Split the clause in two and let the renderer join them; the " +
    `separator is "${HEADLINE_SEPARATOR}" and it is never yours to type.`
  );
}

/**
 * One authored clause: the composer's own words for ONE idea, and provably not two.
 *
 * Trimmed before it is judged so that trailing whitespace cannot smuggle a clause past the cap, and refused
 * rather than trimmed when it carries a separator, because silently deleting one would leave two ideas
 * welded into a run-on sentence — which is worse than the punctuation it removed.
 *
 * Not exported: {@link headlineSchema} is the whole contract, and a clause on its own has no meaning a
 * caller could use.
 */
const headlineClauseSchema = z
  .string()
  .trim()
  .min(1)
  .max(HEADLINE_VISIBLE_MAX)
  .refine((value) => separatorIn({ text: value }) === undefined, {
    error: (issue) => separatorMessage({ text: String(issue.input) }),
  });

/**
 * A validated headline: one entry per idea, in the order a reader meets them.
 *
 * Declared as an interface rather than inferred from {@link headlineSchema}, because the schema's own line
 * refine has to render a candidate to judge it — and inferring the type from a schema that references the
 * renderer that references the type is a cycle the compiler refuses.
 */
export interface Headline {
  /** The ideas, in reader order. At least one, at most {@link HEADLINE_CLAUSES_MAX}. */
  readonly clauses: readonly string[];
}

/**
 * Render a headline into the one line a card's `tldr` carries.
 *
 * A single clause renders as itself, with no joiner anywhere near it — that is what lets a composer whose
 * headline is one sentence adopt this form without changing a byte of what a reader sees.
 *
 * @param headline the validated clauses
 * @returns the TL;DR line, with every separator supplied by this module
 */
export function renderHeadline({ headline }: { headline: Headline }): string {
  return headline.clauses.join(JOINER);
}

/** The refusal a headline whose clauses render past the line's own cap reads. */
function overLineMessage({ headline }: { headline: Headline }): string {
  return (
    `the clauses render to ${String(renderHeadline({ headline }).length)} visible characters and a card's ` +
    `TL;DR carries ${String(HEADLINE_VISIBLE_MAX)}. The joiners are counted: each one costs ` +
    `${String(JOINER.length)}. Shorten a clause, or drop one.`
  );
}

/**
 * A card's headline, as the ideas it is made of.
 *
 * @internal — a form embeds it; no caller outside a form schema names it.
 */
export const headlineSchema = strictForm({
  clauses: z.array(headlineClauseSchema).min(1).max(HEADLINE_CLAUSES_MAX),
}).superRefine((headline, ctx) => {
  if (renderHeadline({ headline }).length > HEADLINE_VISIBLE_MAX) {
    ctx.addIssue({ code: "custom", message: overLineMessage({ headline }), path: ["clauses"] });
  }
});

/**
 * The TL;DR a code composer's clauses render to, refusing exactly what {@link headlineSchema} refuses.
 *
 * Code composers do not parse JSON — they hold their clauses as values already — so this is the seam they
 * use, and it runs the SAME schema rather than a second copy of its rules. An empty or whitespace-only
 * clause is dropped before validation: a composer whose optional clause is absent has one idea, not one
 * idea and a blank, and requiring every call site to filter first is how a silent fallback sneaks back in.
 *
 * @param clauses the ideas, in reader order; empty ones are dropped
 * @returns the rendered TL;DR, or one line per reason the clauses were refused
 */
export function headlineOf({ clauses }: { clauses: readonly string[] }): Result<string> {
  const parsed = headlineSchema.safeParse({ clauses: clauses.filter((clause) => clause.trim().length > 0) });
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message));
  }
  return ok(renderHeadline({ headline: parsed.data }));
}
