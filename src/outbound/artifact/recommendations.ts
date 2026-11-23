/**
 * The RECOMMENDATIONS lane a daily alert card carries: for each finding that fired, the one act that would
 * clear it, plus one or two opportunities nothing alerted on.
 *
 * Monitoring says something is wrong and not how to fix it, and the fleet
 * already writes pull requests well — so a team's daily post should carry "clear suggestions on what PRs it
 * would recommend raising or what actions to take", as a discussion piece. It RECOMMENDS; nothing here raises
 * a pull request, and nothing here composes one. A recommendation is authored data a visible session wrote on
 * the recipe row (rule 2); this file only decides how one READS on the card.
 *
 * ## Where it lands, and why there
 *
 * Directly below the fold, as the first detail blocks. The rule allows "in that ten or directly below the
 * fold", and above the fold is the ranked findings' own region: the derived index lines are trimmed to fill
 * `ABOVE_FOLD_VISIBLE_MAX` exactly, so a recommendation there would take a line from a finding.
 *
 * ## The width is ARITHMETIC, so a line is never trimmed
 *
 * Trimming a recommendation changes what it says ("raise the pool size to…"), so every field is capped such
 * that the widest possible line is exactly `BULLET_ITEM_VISIBLE_MAX`:
 *
 *   marker 3 + act word 15 + change 90 + (3 + target 57) + (3 + owner 24) + (1 + chip 4) = 200
 *
 * A chip is 4 wide from `[10]` up and stays 4 to `[99]`, which is what the sum needs. The old reason given
 * here — "a card carries at most ten index citations plus {@link RECOMMENDATIONS_MAX}" — stopped being true
 * when the alert-summary card grew a Datadog `behind` lane: ten rows plus two behind entries plus five
 * recommendations is 17. The conclusion is unchanged and now rests on the range rather than on a count.
 * `recommendations.test.ts` pins the sum.
 *
 * ## A raised pull request REPLACES the act word, and that is what keeps the sum
 *
 * Yesterday's highest-ranked recommendation comes back in today's post as a
 * draft pull request the bot already wrote. So a recommendation may carry `raisedPrUrl`, and the line's
 * lead becomes a LINK rather than a plain act word:
 *
 *   marker 3 + link "Draft PR" 8 + ": " 2 + change 90 + (3 + target 57) + (3 + owner 24) + (1 + chip 4) = 195
 *
 * Replacing rather than appending is the whole design, and it fell out of one measured fact rather than a
 * preference: `./visibleLength.ts` costs a `link` run its LABEL and its URL nothing, so the link is 8 wide
 * where the widest act word is 15. Appending anything to a line that is already exactly 200 needs five
 * characters back from `change`, `target` or `owner`, and there are none — measured on the one
 * shipped row that authors recommendations, `change` reaches 89 of 90, `target` 56 of 57. A narrowed cap
 * would not trim those, it would REFUSE them, and `live/automation/recommendationSet.ts`'s
 * `recommendationsDocumentOf` turns the whole lane off for an unparseable set — at an unattended hour.
 *
 * It is also the honest reading. `Raise PR:` is a suggestion; once the bot has written it the line is
 * reporting, not advising, and the same is true whichever act it was — a `tune-monitor` that came back as a
 * pull request is still a pull request. The `evidenceUrl` chip stays exactly where it was: evidence is what
 * JUSTIFIED the recommendation and the pull request is its OUTPUT, so one is never allowed to stand in for
 * the other. {@link sameUrlRefusal} refuses a form that tries.
 *
 * A second CHIP was rejected rather than untried. `[3] [4]` is what a reader would see — `../slack/render.ts`
 * gives a chip no text but its `[n]` label — so nothing on the line would say which one was the output, and
 * {@link recommendationCitations} reuses a citation whose URL matches, which a second URL per recommendation
 * turns into a collision.
 *
 * ## Authored text cannot ping, broadcast or cite
 *
 * `typedRuns.ts` converts raw markup inside EVERY detail text run before validation, so `<@U…>` in a
 * `change` would become a real mention, `<!here>` a broadcast, and a literal `[2]` a chip pointing at
 * somebody else's evidence. `bareRefRuns.ts` converts a bare `#N` — and a bare DIGIT RUN inside a
 * `merged: 4821, 4822` list — the same way, AFTER this schema has accepted the form, or refuses the whole
 * send when nothing resolves it; three review passes each found one more shape of that class, which is why
 * both scanners are CALLED here rather than approximated. Day one tags nobody, so those shapes are refused at the form
 * rather than trusted to a composer. The target renders as a `code` run, which that conversion skips.
 */
import { z } from "zod";

import { type BareRefContext, scanBareRefs } from "../linkify/bareRefs.js";
import { strictForm } from "../strictForm.js";
import { clickableUrlSchema } from "./runSchema.js";
import { SEVERITIES, SEVERITY_GLYPH, type Severity } from "./severity.js";
import { scanRawMarkup } from "./typedRuns.js";
import type { Citation, DetailBlock, InlineRun } from "./types.js";

/** The acts a recommendation may name. `owner` says WHOSE it is; an act says WHAT to do.
 *
 * @internal — the schemas below are the surface; nothing outside this file names the list.
 */
export const RECOMMENDATION_ACTS = ["raise-pr", "tune-monitor", "change-config", "hand-to-owner"] as const;

/** One recommendation's act.
 *
 * @internal — derived from {@link RECOMMENDATION_ACTS} for this file's own lookup table.
 */
export type RecommendationAct = (typeof RECOMMENDATION_ACTS)[number];

/**
 * How an act reads on the card. The widest, with its `: `, is 15 — see the file overview's sum.
 *
 * `hand-to-owner` is the act for work that is neither a pull request nor a configuration change: a
 * reconciliation, a refund decision, a call somebody has to make. Without it a card would have to describe
 * such a finding as one of the other three, which would be a recommendation nobody could follow.
 */
const ACT_WORD: Readonly<Record<RecommendationAct, string>> = {
  "change-config": "Change config",
  "hand-to-owner": "Hand to owner",
  "raise-pr": "Raise PR",
  "tune-monitor": "Tune monitor",
};

/** The change, in one line. */
export const RECOMMENDATION_CHANGE_MAX = 90;

/** Where the change lands — a repository and a path. */
export const RECOMMENDATION_TARGET_MAX = 57;

/** Whose it is, as plain text. Never a mention: day one tags nobody. */
export const RECOMMENDATION_OWNER_MAX = 24;

/**
 * What the lead LINK reads as when the bot has already raised the pull request.
 *
 * 8 wide, against the widest act word's 15 — see the file overview's second sum. It names the thing it
 * points at rather than the act it replaces ("Raised" would leave a reader guessing what was raised), and
 * it says DRAFT because nobody is asked to review one (day one tags nobody).
 */
export const RAISED_PR_LABEL = "Draft PR";

/** How many recommendations one card carries: finding acts first, then opportunities. */
export const RECOMMENDATIONS_MAX = 5;

/** How many of those may be opportunities nothing alerted on — "one or two". */
export const RECOMMENDATION_OPPORTUNITIES_MAX = 2;

/** The marker an opportunity leads with, where a finding's act leads with that finding's severity glyph. */
export const OPPORTUNITY_MARKER = "💡";

/** The bold line above the list. */
export const RECOMMENDATIONS_HEADING = "Suggested next moves";

/**
 * A citation marker, and a bare `@handle` — the two shapes {@link scanRawMarkup} does not itself report.
 *
 * A marker becomes somebody else's chip; a bare handle is a request that a person be summoned, which is the
 * day-one rule's whole point even where Slack would not linkify it.
 */
const AUTHORED_MARKUP = /\[\d+\]|@/u;

/**
 * The context this schema scans bare references under: none at all.
 *
 * Candidacy is what matters here, not resolution — `scanBareRefs`'s own contract — and its two CONTEXT-FREE
 * producers (a `#N`, and a bare digit run inside a `merged: 4821, 4822` list) both report under an empty
 * context. So the scan sees every shape that could become a link without knowing anything about the install.
 */
const NO_REF_CONTEXT: BareRefContext = { repos: [] };

/**
 * A Linear key or a compliance control id — the two bare-reference producers that need a context this schema
 * does not have, so their SHAPE is matched instead.
 *
 * Deliberately WIDER than what resolves: a key whose team does not exist would stay prose, and refusing it
 * anyway costs an author one edit, while accepting it risks a card.
 */
const KEYED_REFERENCE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/u;

/**
 * A plain authored string, bounded, that cannot become anything but text.
 *
 * The URL half asks {@link scanRawMarkup} — the SCANNER the conversion itself runs — rather than matching a
 * second pattern here. A parallel regex drifts: its first version blocked `http://` and `https://` and
 * missed `mailto:`, which `typedRuns.ts` also converts, so an authored `mailto:payments-oncall` passed
 * every schema and rendered as a real link on a card that sent clean (found by an adversarial review pass).
 * Asking the scanner means a scheme added there is refused here with no second edit.
 */
function plainText({ max, references = "refused" }: { max: number; references?: "refused" | "allowed" }): z.ZodString {
  return z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        scanRawMarkup({ text: value }).length === 0 &&
        !AUTHORED_MARKUP.test(value) &&
        (references === "allowed" ||
          (scanBareRefs({ context: NO_REF_CONTEXT, text: value }).length === 0 && !KEYED_REFERENCE.test(value))),
      {
        error:
          "must be plain text: a mention, a broadcast, an angle form, a URL in any scheme the card converts, " +
          "a bare `@handle`, a `[n]` marker and a bare reference (`#N`, `CCCC-2225`) are all refused, " +
          "because the card would turn one into a ping, a link or somebody else's citation chip — and an " +
          "unresolvable reference refuses the whole send. Put a URL in `evidenceUrl` and a ticket in " +
          "`target`, which renders as code, is never converted, and therefore allows one",
      },
    );
}

/** The fields a recommendation renders, shared by the card form and the row the author writes. */
const renderedFields = {
  act: z.enum(RECOMMENDATION_ACTS),
  change: plainText({ max: RECOMMENDATION_CHANGE_MAX }),
  /** The evidence the recommendation stands on. Required: every line on the card cites something. */
  evidenceUrl: clickableUrlSchema,
  owner: plainText({ max: RECOMMENDATION_OWNER_MAX }).optional(),
  /**
   * The draft pull request the bot ALREADY RAISED to clear this recommendation. Absent on one nobody has
   * acted on yet, which is every recommendation until a session writes one back onto the row.
   */
  raisedPrUrl: clickableUrlSchema.optional(),
  // A target renders as a `code` run, which every conversion skips — so it is where a ticket key BELONGS,
  // and the reason the prose fields can refuse one outright.
  target: plainText({ max: RECOMMENDATION_TARGET_MAX, references: "allowed" }).optional(),
};

/**
 * The one cross-field rule both schemas carry: the pull request a recommendation PRODUCED is never also the
 * evidence it STANDS ON.
 *
 * Cheap to refuse and expensive to discover: the two fields are both clickable URLs on one object, so the
 * single way this lane can lie is a card presenting yesterday's own output as today's justification. The
 * chip and the lead link would then point at the same place and the line would read as grounded in itself.
 */
const sameUrlRefusal = {
  error:
    "raisedPrUrl is the pull request this recommendation PRODUCED and evidenceUrl is what JUSTIFIED it, so they may never be the same address — a card citing its own output reads as grounded in itself",
} as const;

/** Whether a recommendation keeps evidence and output apart. */
function evidenceIsNotTheOutput({
  evidenceUrl,
  raisedPrUrl,
}: {
  evidenceUrl: string;
  raisedPrUrl?: string | undefined;
}): boolean {
  return raisedPrUrl !== evidenceUrl;
}

/**
 * One recommendation as the CARD carries it.
 *
 * `finding` is the severity of the finding it clears, set by the verb that matched it — absent means an
 * opportunity. It is data rather than a key on purpose: the card has no business knowing which probe or
 * monitor a line came from, only how it should be coloured.
 */
export const recommendationFormSchema = strictForm({
  ...renderedFields,
  finding: z.enum(SEVERITIES).optional(),
}).refine(evidenceIsNotTheOutput, sameUrlRefusal);

/** One recommendation on a card. */
export type RecommendationForm = z.infer<typeof recommendationFormSchema>;

/** How long a `clears` key may be — a probe id or an alert's full stable name, never rendered.
 *
 * @internal — a field of {@link recommendationAuthorSchema}; callers read the schema, not the number.
 */
export const RECOMMENDATION_CLEARS_MAX = 200;

/**
 * One recommendation as its AUTHOR writes it on a recipe row.
 *
 * `clears` names the finding it clears — a probe `id` on a digest row, an alert's stable name (as
 * `slack alert-summary --json` prints it under `firedNames`) on an alert-summary row. Absent means an
 * opportunity. A second strict schema rather than an optional field on the card's, so a row cannot inject a
 * severity and a card cannot carry a key it has no use for.
 */
export const recommendationAuthorSchema = strictForm({
  ...renderedFields,
  clears: z.string().min(1).max(RECOMMENDATION_CLEARS_MAX).optional(),
}).refine(evidenceIsNotTheOutput, sameUrlRefusal);

/** One recommendation as a row carries it. */
export type RecommendationAuthored = z.infer<typeof recommendationAuthorSchema>;

/** The line's lead: the cleared finding's glyph, or the opportunity marker. */
function marker({ finding }: { finding: Severity | undefined }): string {
  if (finding === undefined) {
    return `${OPPORTUNITY_MARKER} `;
  }
  return `${SEVERITY_GLYPH[finding]} `;
}

/**
 * The runs a line OPENS with: the marker, then either the act word or — once the bot has raised the pull
 * request — a link standing in its place, and the change.
 *
 * Two runs when there is no pull request and three when there is, rather than a link whose label is the act
 * word: the act is what the reader was being asked to DO, and a line still saying "Raise PR" while linking a
 * raised one would be describing work that is no longer outstanding.
 */
function leadRuns({ recommendation }: { recommendation: RecommendationForm }): readonly InlineRun[] {
  const marked = marker({ finding: recommendation.finding });
  if (recommendation.raisedPrUrl === undefined) {
    return [
      {
        text: `${marked}${ACT_WORD[recommendation.act]}: ${recommendation.change}`,
        type: "text",
      },
    ];
  }
  return [
    { text: marked, type: "text" },
    { label: RAISED_PR_LABEL, type: "link", url: recommendation.raisedPrUrl },
    { text: `: ${recommendation.change}`, type: "text" },
  ];
}

/**
 * One recommendation's line, as runs.
 *
 * @param recommendation the recommendation to render
 * @param citationId the chip this line ends in
 * @returns the runs, widest case exactly `BULLET_ITEM_VISIBLE_MAX` with no pull request and 195 with one
 */
export function recommendationLine({
  recommendation,
  citationId,
}: {
  recommendation: RecommendationForm;
  citationId: string;
}): readonly InlineRun[] {
  const target: readonly InlineRun[] =
    recommendation.target === undefined
      ? []
      : [
          { text: " · ", type: "text" },
          { code: true, text: recommendation.target, type: "text" },
        ];
  const owner: readonly InlineRun[] =
    recommendation.owner === undefined ? [] : [{ text: ` · ${recommendation.owner}`, type: "text" }];
  return [
    ...leadRuns({ recommendation }),
    ...target,
    ...owner,
    { text: " ", type: "text" },
    { citationId, type: "citation" },
  ];
}

/** One recommendation, and the citation its line ends in. */
export interface CitedRecommendation {
  readonly recommendation: RecommendationForm;
  readonly citationId: string;
}

/**
 * The citations the recommendations need, continuing after the ones the card already declares.
 *
 * An `evidenceUrl` that is already cited — the finding's own monitor link, typically — REUSES that citation
 * rather than showing two numbers for one link. Only a citation some run already points at may be reused;
 * reusing a declared-but-uncited one would still leave it looking cited when nothing drew its chip.
 *
 * Ids are minted as `r1…rn`, a namespace no derivation uses, so they cannot collide with `c1…cn`.
 *
 * @param recommendations the recommendations in card order
 * @param existing the citations already declared AND cited by the card's other runs
 * @returns the citations to add, and each recommendation paired with the citation its line ends in
 */
export function recommendationCitations({
  recommendations,
  existing,
}: {
  recommendations: readonly RecommendationForm[];
  existing: readonly Citation[];
}): { readonly added: readonly Citation[]; readonly cited: readonly CitedRecommendation[] } {
  const added: Citation[] = [];
  const cited = recommendations.map((recommendation): CitedRecommendation => {
    const reused = [...existing, ...added].find((citation) => citation.url === recommendation.evidenceUrl);
    if (reused !== undefined) {
      return { citationId: reused.id, recommendation };
    }
    const position = existing.length + added.length + 1;
    const id = `r${String(added.length + 1)}`;
    added.push({ id, label: `[${String(position)}]`, url: recommendation.evidenceUrl });
    return { citationId: id, recommendation };
  });
  return { added, cited };
}

/**
 * The detail blocks a card's recommendations render as: a bold heading, then one list line each.
 *
 * Empty when there are none, so a card that never turned the lane on derives exactly what it did before.
 *
 * @param cited the recommendations in card order, each with its citation
 * @returns the blocks, or none
 */
export function recommendationsBlock({ cited }: { cited: readonly CitedRecommendation[] }): readonly DetailBlock[] {
  if (cited.length === 0) {
    return [];
  }
  const items = cited.map(({ recommendation, citationId }) => recommendationLine({ citationId, recommendation }));
  return [
    { runs: [{ bold: true, text: RECOMMENDATIONS_HEADING, type: "text" }], type: "paragraph" },
    { items, type: "list" },
  ];
}

/**
 * Add a card's recommendations to what it already derived: the blocks go FIRST in the detail, and their
 * citations are appended after the card's own.
 *
 * @param recommendations the form's recommendations, when it carries any
 * @param citations the citations the card already derived
 * @param detail the detail the card already derived
 * @returns the combined citations and detail
 */
export function withRecommendations({
  recommendations = [],
  citations,
  detail,
}: {
  recommendations?: readonly RecommendationForm[] | undefined;
  citations: readonly Citation[];
  detail: readonly DetailBlock[];
}): { readonly citations: readonly Citation[]; readonly detail: readonly DetailBlock[] } {
  const { added, cited } = recommendationCitations({ existing: citations, recommendations });
  return {
    citations: [...citations, ...added],
    detail: [...recommendationsBlock({ cited }), ...detail],
  };
}
