/**
 * The ALERT-SUMMARY form, and the pure derivation that turns it into a card.
 *
 * ## What this is, and why it is not {@link digestToUpdate}
 *
 * A digest is a TRIAGE LIST: a handful of issues, each with a severity, an owner and a ticket, ordered by how
 * badly it wants attention. An alert summary is a TALLY: what fired over a window and how often, ordered by
 * NOISE. They look alike in a screenshot and are different domain data, so folding one into the other would
 * have meant inventing a severity per tallied row — and severity is the digest's required discriminator, its
 * sort key and its glyph. Guessing it from a notification title is precisely the cleverness `./digest.ts`
 * refuses, because it is what turns a quiet window into a red alert.
 *
 * So this is a sibling form, not a variant. Both reach the same card anatomy through `slack post --as bot
 * --form -`, discriminated on `kind`, and neither knows anything about layout.
 *
 * ## The count is COMPUTED, never accepted — this is the whole point
 *
 * The form carries per-row counts, which the composer looked up. It carries NO total, and there is no field
 * with which to supply one: {@link deriveTotal} sums the rows, so a total that disagrees with its own rows is
 * UNREPRESENTABLE rather than merely discouraged. Every rendered row is the same control — each is a
 * projection of ONE row, so the one editorial sentence can always be checked against what is printed beside it.
 *
 * That is the ported principle. Prose about what fired is worth having and only a model can write it; a NUMBER
 * in that prose is worth nothing, because nobody reading it can tell whether it was counted or recalled. The
 * arithmetic therefore belongs to code, and this file is where it is kept.
 *
 * ## `skipped` is REQUIRED, and every unknown key is REFUSED
 *
 * This file used to argue the opposite of what it now does. It was written under `./schema.ts`'s old rule —
 * refuse where a human authors, STRIP where a model fills unattended — and reasoned that an invented field must
 * not cost a scheduled send. Field use refuted that, and `../strictForm.ts` records the case: a ported payload
 * reached the digest form under four foreign field names, every one was dropped, and the card posted without
 * its substance at exit 0. The unattended hour is not where a dropped field is a smaller failure; it is where
 * it is a SILENT one. So this form is declared with {@link strictForm} like every other outbound form, and a key
 * nobody declared is refused with the nearest valid field named.
 *
 * What survives that reversal intact is the reason every NUMBER here is required with no default. A defaulted
 * `skipped` would have quietly reported full coverage of a window it had not read — a wrong number rather than
 * an absent one. `lead` and `citationUrl` are the only optional fields, and both degrade VISIBLY: a missing
 * sentence, an absent chip, never a number that is wrong.
 *
 * ## The whole-form check, because per-field caps do not compose
 *
 * Each field's own bound can hold while the card they build together breaks one, since `label`, `window`, `lead`
 * and the noisiest rows' labels all land in the SAME above-fold region. {@link alertSummaryFormSchema} therefore
 * derives the card and validates it with `updateArtifactSchema` itself, so the refusal happens at FORM level
 * with the contributing fields named. It defers to the layout schema rather than re-adding the caps up here,
 * for the reason `./digest.ts` gives: a second copy of the composition rule is a copy that drifts.
 *
 * ## What is deliberately NOT here
 *
 * No ingestion. This file is handed a tally and does not know where it came from, which is what keeps it pure
 * and total — `../../live/slack/alertTally.ts` is what counts, and it never sees this schema. No prose scanning.
 * No owner ping, no ticket column — a tally has neither, and adding them would re-create the digest under a
 * second name.
 *
 * `severity` is the one exception, and it is not the exception it looks like: `./digest.ts` refuses severity as
 * AUTHORED data because guessing it from an arbitrary title is a semantic judgement — is THIS sentence bad
 * enough to be red? A row's severity here is a SHAPE lookup over the exact, closed lifecycle-word vocabulary
 * `alertName.ts` already depends on to recognise a notification at all (the same dozen words, not free text),
 * so nothing is classified by guessing at meaning. See `alertName.ts`'s own header for the full argument.
 */
import { z } from "zod";
import { BULLET_ITEM_VISIBLE_MAX, DETAIL_PROSE_VISIBLE_MAX } from "../assistant/contentLimits.js";
import { strictForm } from "../strictForm.js";

import { HEADLINE_SEPARATOR } from "./headline.js";
import { introSchema } from "./introAndRank.js";
import {
  impactBasisSentence,
  impactCell,
  impactFieldSchema,
  type RankedAlert,
  rankAlerts,
  topPriority,
} from "./priority.js";
import { RECOMMENDATIONS_MAX, recommendationFormSchema, withRecommendations } from "./recommendations.js";
import { INDEX_MAX_ITEMS, TABLE_MAX_ROWS, updateArtifactSchema } from "./schema.js";
import { SEVERITIES, SEVERITY_GLYPH, SEVERITY_WORD, type Severity } from "./severity.js";
import { ALERT_TREND_PRIOR_WINDOWS_MAX, type AlertTrend, deriveTrend, trendClause, trendSentence } from "./trend.js";
import type { Citation, DetailBlock, InlineRun, UpdateArtifact } from "./types.js";
import { clippedToWidth, visibleLengthOfDetail } from "./visibleLength.js";

/** The summary's subject label (e.g. a monitored system). Bounded because it prefixes the derived TL;DR. */
export const ALERT_SUMMARY_LABEL_MAX = 40;

/** The observation window as a human string (e.g. `7d`). Bounded for the same reason as the label. */
export const ALERT_SUMMARY_WINDOW_MAX = 12;

/**
 * The authored lead clause appended to the derived count sentence, bounded so the WHOLE TL;DR provably fits.
 *
 * The number is arithmetic, not taste, and the priority and trend tokens are what moved it from 80 down to here. The TL;DR now
 * carries two derived tokens it did not: the channel's TOP PRIORITY, which is the thing eleven of these cards
 * are scanned for, and the trend clause that says how this window compares with the ones before it. Worst case,
 * in the layout's own UTF-16 units: {@link ALERT_SUMMARY_LABEL_MAX} 40 + a space + {@link ALERT_SUMMARY_WINDOW_MAX}
 * 12 + ` {@link TLDR_SEPARATOR} ` 3 = 56; `P0 · ` 5; the count sentence at the `omitted` caps
 * (`11000000 fired across 1000010 monitors.`) 39; the trend clause at {@link ALERT_TREND_PRIOR_WINDOWS_MAX} and
 * the clamped ratio (` >99.9× the prior 9 windows.`) 28 — 128 of the layout's `TLDR_VISIBLE_MAX` 180, leaving 52
 * for a space plus this. 48 keeps headroom against that worst case, so a form which validates here cannot
 * derive an over-long TL;DR. `alertSummary/validCard.test.ts`'s maximal fixture pins the arithmetic rather than
 * trusting this comment, which is the practice this file's own history demands: every number restated in a
 * comment here has gone stale at least once.
 *
 * Narrowing it costs nothing live. `../../live/slack/alertLead.ts`'s `fitLead` TRIMS an over-long sentence with
 * a visible ellipsis rather than refusing it, and no scheduled row sets `lead` at all.
 */
export const ALERT_SUMMARY_LEAD_VISIBLE_MAX = 48;

/** One tallied row's label — a monitor name, not a sentence. Same bound as a digest item's title. */
export const ALERT_SUMMARY_ROW_LABEL_MAX = 80;

/**
 * The per-row ceiling on a count.
 *
 * A bound exists so the derived TL;DR's width is PROVABLE: without one, a row could carry an arbitrarily long
 * integer and push the count sentence past the layout's cap at the unattended hour. A million notifications
 * from one monitor over one window is orders of magnitude past anything real, so this bounds the arithmetic
 * without bounding any actual tally.
 */
export const ALERT_SUMMARY_COUNT_MAX = 1_000_000;

/**
 * How many rows ride above the fold. The noisiest {@link ALERT_SUMMARY_INDEXED_MAX} by count, because that is
 * the question an alert summary answers at a glance: what is making the most noise.
 */
export const ALERT_SUMMARY_INDEXED_MAX = INDEX_MAX_ITEMS;

/**
 * The width one derived index line is trimmed to — TIGHTER than the layout's own `INDEX_ITEM_VISIBLE_MAX`, for
 * the same arithmetic reason `DIGEST_LINE_VISIBLE_MAX` is.
 *
 * The layout bounds the whole above-the-fold region at `ABOVE_FOLD_VISIBLE_MAX` (1080) as well as each line at
 * `INDEX_ITEM_VISIBLE_MAX` (120). Nine maximal lines plus a maximal TL;DR is 180 + 9x120 = 1260, which the
 * region check rejects — so a derivation respecting only the per-line cap could emit an invalid card from a
 * perfectly valid form. The region alone would allow `(1080 - 180) / 9 = 100`; this stays at 94, so a maximal row
 * line (96 untrimmed) still trims with a visible ellipsis and the worst case is 180 + 9x94 = 1026, inside the cap.
 * At 100 nothing the field caps admit would ever reach the trim, and an unreachable trim is an untested one.
 */
export const ALERT_SUMMARY_LINE_VISIBLE_MAX = 94;

/**
 * ONE tallied row.
 *
 * `label`, `count` and `severity` are FACTS — something counted or classified them. Nothing here is layout, and
 * nothing here is prose: the single editorial sentence in the whole card is the form's `lead`.
 */
const alertSummaryRowSchema = strictForm({
  /**
   * The query URL backing this row's number. Becomes a `[n]` citation chip, which is what makes the tally
   * independently checkable rather than merely assertive — the same reason a digest item carries one.
   */
  citationUrl: z.url().optional(),
  /** How many times this alert fired over the window. */
  count: z.number().int().min(0).max(ALERT_SUMMARY_COUNT_MAX),
  /**
   * The ESTIMATED blast radius: both counted numbers, never the share they make.
   *
   * Optional, and absent on every row nothing could measure — not a log alert, no census link, no Datadog
   * credential, the window past log retention, or the read threw. Absence degrades VISIBLY, to `impact ?` on
   * the line and the `unknown` band in `./priority.ts`'s matrix, which is the posture every other optional
   * field here takes: a missing number, never a wrong one.
   *
   * `matched` and `scope` are carried rather than their quotient for the reason this form carries per-row
   * counts and no total — a supplied share could disagree with the numbers it claims to be made of, and here
   * there is no field to supply one in. `../../live/slack/alertImpact.ts` is what fills this.
   */
  impact: impactFieldSchema.optional(),
  /** What fired, as a stable monitor name — never a per-occurrence title. */
  label: z.string().min(1).max(ALERT_SUMMARY_ROW_LABEL_MAX),
  /**
   * Optional, and degrades VISIBLY when absent — no glyph, never a wrong one — for a row a caller supplied
   * without going through `alertTally.ts`'s own classification.
   */
  severity: z.enum(SEVERITIES).optional(),
});

/** One tallied row of an alert summary. */
type AlertSummaryRow = z.infer<typeof alertSummaryRowSchema>;

/**
 * How many monitors get a "behind it" line.
 *
 * Two, because the section is a glance rather than a report: the tally above it already says WHICH monitors
 * fired, and this says what was under the two loudest. It is not a citation-budget constraint —
 * `updateArtifactSchema` puts no maximum on `citations`, and a review pass measured this lane emitting 17
 * chips once the recommendations lane is present.
 */
export const ALERT_SUMMARY_BEHIND_MAX = 2;

/** How many groups one "behind it" line names — the few that carry the count, never the tail. */
export const ALERT_SUMMARY_BEHIND_GROUPS_MAX = 3;

/**
 * ONE monitor's own query, rerun over the card's window and grouped — what the telemetry says behind the alert.
 *
 * A scheduled card that only counts notifications tells a reader what they already saw fire.
 * This is the half they did not see — which services the matching events came from — and every number in it is
 * a Datadog aggregate the tick took, never a sentence anybody wrote.
 */
const alertSummaryBehindSchema = strictForm({
  /** The console link that reproduces this aggregate, pinned to the same window. */
  citationUrl: z.url().optional(),
  /** How many events the monitor's query matched over the window. */
  events: z.number().int().min(0),
  /** The largest groups, noisiest first. */
  groups: z
    .array(strictForm({ count: z.number().int().min(0), name: z.string().min(1).max(ALERT_SUMMARY_ROW_LABEL_MAX) }))
    .max(ALERT_SUMMARY_BEHIND_GROUPS_MAX),
  /** The monitor, by the same label its tally row carries. */
  monitor: z.string().min(1).max(ALERT_SUMMARY_ROW_LABEL_MAX),
});

/** One "behind it" line of an alert summary. */
export type AlertSummaryBehind = z.infer<typeof alertSummaryBehindSchema>;

/**
 * The alert-summary form's FIELDS, before the whole-form check below is layered on.
 *
 * Split out for one reason, the same one `./digest.ts` splits for: the refinement calls
 * {@link alertSummaryToUpdate}, whose parameter is `AlertSummaryForm`. Inferring that type from the refined
 * schema would make the type circular, so it is inferred from the base instead. The split is mechanical, not a
 * second contract — nothing may reference this directly.
 *
 * `rows` may be EMPTY, and that is the difference from a digest, which requires at least one item. A quiet
 * window is the outcome an alert summary most wants to be able to report, and a form that could not express it
 * would either fail the scheduled send or invite a fabricated row. See {@link alertSummaryToUpdate}.
 *
 * `rows` is capped at `TABLE_MAX_ROWS` because every row lands somewhere — above the fold or below it, as its
 * own cited line — and a card is bounded by how many independently-clickable lines a reader can be handed.
 */
const alertSummaryFormFields = strictForm({
  /**
   * What the noisiest monitors' own queries matched over the window, when the tick could read Datadog. Absent
   * claims nothing: no credential, no census, or no monitor whose query could be rerun.
   */
  behind: z.array(alertSummaryBehindSchema).max(ALERT_SUMMARY_BEHIND_MAX).readonly().optional(),
  /** A scheduled summary's day-one opening lines, carried onto the card unchanged — `UpdateArtifact.intro`. */
  intro: introSchema.optional(),
  kind: z.literal("alert-summary"),
  /** The subject, used to build the TL;DR. */
  label: z.string().min(1).max(ALERT_SUMMARY_LABEL_MAX),
  /** The authored clause after the counts — the one editorial sentence in the whole card. */
  lead: z.string().min(1).max(ALERT_SUMMARY_LEAD_VISIBLE_MAX).optional(),
  /**
   * The quieter monitors the row cap left OUT of `rows`, and how many times they fired between them.
   *
   * Present only when something was actually folded away, and its absence therefore claims nothing. It exists
   * because `rows` is capped at ten while a real alerts channel over a week carries more distinct monitors than
   * that, so a summariser has to drop the quiet tail — and dropping it without saying so would make the card
   * read as complete coverage of a window it had only partly reported. `../../live/slack/alertTally.ts`'s
   * `foldTally` is what fills this.
   *
   * Both counts feed {@link deriveTotals}, so the TL;DR's total and monitor count describe the WHOLE window
   * rather than the part that fitted. That is the whole reason this is a form field and not a caller's footnote:
   * a total that silently meant "of the rows you can see" would be a wrong number, which is the one failure this
   * form is built to make unrepresentable.
   */
  // `monitors` is capped for the same reason `count` is, and a review pass is why it had to be: unbounded, it
  // reaches the derived TL;DR through `deriveTotals` and `countSentence`. MEASURED here, on this file, with
  // five values at once — `label` 40, `window` 12, `lead` 80, `omitted.count` at its own 1,000,000 cap and
  // `monitors: 9007199254740991` — the TL;DR came to 184 against the 180 cap and the card was REFUSED; with
  // `monitors` at the cap this line adds, the same form derives 175 and is accepted. Fewer than five takes it
  // under the cap on its own, which is why an earlier draft of this comment named four and could not be
  // reproduced. `alertSummary/validCard.test.ts`'s maximal fixture carries `omitted` for the same reason.

  omitted: strictForm({
    count: z.number().int().min(0).max(ALERT_SUMMARY_COUNT_MAX),
    monitors: z.number().int().min(1).max(ALERT_SUMMARY_COUNT_MAX),
  }).optional(),
  /**
   * The act that would clear each alert that fired, and the opportunities nothing alerted on — rendered first
   * below the fold (`./recommendations.ts`). The verb selects these; the form only carries what it chose.
   */
  recommendations: z.array(recommendationFormSchema).max(RECOMMENDATIONS_MAX).optional(),
  rows: z.array(alertSummaryRowSchema).max(TABLE_MAX_ROWS),
  /**
   * How many messages in the window were read but NOT recognised as alert notifications.
   *
   * Required, with no default, because it is the summary's own statement about its coverage — see the file
   * overview on why every number here is required. Rendered below the fold whenever it is non-zero, and in
   * the TL;DR itself when it is the only thing the window has to report ({@link countSentence}).
   *
   * CAPPED at {@link ALERT_SUMMARY_COUNT_MAX} for exactly the reason a row's `count` is, and it acquired the
   * cap the day it started reaching the TL;DR: an unbounded integer there makes the derived headline's width
   * unprovable, so a wide enough one would push the card past the layout cap at the unattended hour. It was
   * safe unbounded while it only ever rendered into a below-fold paragraph measured against a much larger
   * budget.
   */
  skipped: z.number().int().min(0).max(ALERT_SUMMARY_COUNT_MAX),
  /**
   * What the windows BEFORE this one counted — the baseline the TL;DR's `2.1×` clause is taken against.
   *
   * Two raw numbers and no ratio, for the reason every number on this card is raw: `./trend.ts`'s
   * {@link deriveTrend} divides them, so a ratio that disagreed with its own baseline is unrepresentable
   * rather than merely discouraged.
   *
   * Optional, and its absence claims nothing: a first firing, a crawl that stopped early, or a caller that
   * never read a wider span. An absent trend omits the TL;DR clause entirely rather than rendering a
   * "steady" nothing measured — see `./trend.ts`'s overview for why a zero baseline is not a quiet one.
   */
  trend: strictForm({
    /** How many notifications fired across the whole baseline. */
    priorTotal: z.number().int().min(0).max(ALERT_SUMMARY_COUNT_MAX),
    /** How many windows that total is spread over. Bounded so the derived clause's width is provable. */
    priorWindows: z.number().int().min(1).max(ALERT_TREND_PRIOR_WINDOWS_MAX),
  }).optional(),
  /** The observation window, rendered into the TL;DR and used as the count column's header. */
  window: z.string().min(1).max(ALERT_SUMMARY_WINDOW_MAX),
});

/** The alert-summary form: a tally plus one bounded sentence, with no layout and no total in it. */
export type AlertSummaryForm = z.infer<typeof alertSummaryFormFields>;

/**
 * The whole-form check: derive the card and let the LAYOUT schema judge it, naming the fields that combine.
 *
 * ## What per-field caps miss, and why this one is a RATCHET rather than a live check
 *
 * `./digest.ts` carries the same check because per-field caps genuinely do not compose there — ten maximal
 * `owner.ask`s measured 2040 against an 1800 cap. This form used to claim the opposite — "no form the field
 * caps admit can currently reach the refusal below. The pressure here is all above the fold" — and a review
 * pass falsified it: with the `recommendations` lane and the `behind` lane both below the fold, ten maximal
 * rows plus five maximal recommendations measured 1308 of the 1800 prose budget, two maximal behind entries
 * added 489, and a longer `skipped` tipped the total to 1801. The card was REFUSED and the refusal named the
 * above-fold fields, none of which a caller could shorten to fix it.
 *
 * So BOTH regions are now live pressure. Below the fold {@link fittedLane} drops behind entries until the
 * derived detail fits, and on the SCHEDULED path `withSummaryRecommendations`
 * (`cli/commands/slack/alertSummaryCore.ts`) sheds recommendations after it — `withRecommendations` itself
 * measures nothing, so a hand-composed form gets the behind shed and no recommendation shed. Above the fold
 * the bound is `ABOVE_FOLD_VISIBLE_MAX` (1080) over the TL;DR and every index line together; what pins it is
 * `alertSummary/validCard.test.ts`'s own maximal fixture rather than a number restated here, because the last two
 * numbers restated in this comment were both stale — `omitted`'s counts reach the TL;DR too, which is why
 * that field is capped and why the fixture now carries it.
 *
 * So this is not decoration and not a live guard. It is the thing that fails if
 * {@link ALERT_SUMMARY_LEAD_VISIBLE_MAX} or {@link ALERT_SUMMARY_LINE_VISIBLE_MAX} is ever loosened without
 * redoing the arithmetic that justifies it — which is exactly how the digest's guarantee came to be false while
 * its comment still claimed otherwise. A comment cannot notice a constant changing under it.
 *
 * ## Why it derives rather than re-adding the fields up
 *
 * It calls the real {@link alertSummaryToUpdate} and validates with the real layout schema. The digest's first
 * version of this check enumerated one cap and an adversarial review immediately found the cap it had not
 * mirrored, so this defers entirely: it holds for every cap the layout has, including ones added later.
 *
 * ## Why the logic is here and not inline in the refinement
 *
 * Because the refinement cannot be driven past its own field caps, so a check written only inside it would be a
 * branch no test could reach — and an unreachable branch is indistinguishable from a broken one. This takes an
 * `AlertSummaryForm`, which is a shape rather than a proof, so a test hands it an over-long `lead` directly and
 * proves the refusal fires and says something useful.
 *
 * @param form the alert-summary form, field-validated or not
 * @returns the refusal message naming the contributing fields, or undefined when the derived card is accepted
 */
export function alertSummaryCardRefusal({ form }: { form: AlertSummaryForm }): string | undefined {
  const derived = updateArtifactSchema.safeParse(withoutQuotedFlags({ artifact: alertSummaryToUpdate({ form }) }));
  if (derived.success) {
    return undefined;
  }
  // This is the refusal a caller actually READS — `cli/commands/slack/coreForm.ts`'s own remedy string is
  // unreachable, because the form schema's `superRefine` runs this check first. A review pass caught the
  // distinction while the fix for the sentence below had landed only on that unreachable copy.
  return (
    "these fields each sit inside their own limits, but the card they derive does not, and BOTH regions can " +
    "be the cause. Above the fold: `label`, `window` and `lead` build the TL;DR, `omitted`'s two counts " +
    "reach it through the derived total, and the noisiest rows' `label`s build the index lines beside it, " +
    "all under one region cap. Below it: the rows the index had no room for, every `recommendations` entry " +
    "and the `behind` reading share the detail-prose budget. Shorten `lead`, `label`, `window`, a row label " +
    `or a recommendation, or drop an item. What the layout refused: ${z.prettifyError(derived.error)}`
  );
}

/** One run with the derivation-only `quoted` flag removed; every other run passes through untouched. */
function withoutQuoted({ run }: { run: InlineRun }): InlineRun {
  if (run.type !== "text" || run.quoted === undefined) {
    return run;
  }
  const { quoted: _quoted, ...rest } = run;
  return rest;
}

/** Whether a run's text is a row's label, whole or as `fittedRowLine` trimmed it (a prefix plus an ellipsis). */
function isRowLabel({ labels, text }: { labels: readonly string[]; text: string }): boolean {
  if (labels.includes(text)) {
    return true;
  }
  const trimmed = text.endsWith("…") ? text.slice(0, -1) : undefined;
  return trimmed !== undefined && trimmed.length > 0 && labels.some((label) => label.startsWith(trimmed));
}

/**
 * The VALIDATED card with each row's label marked `quoted` again, so the send door's voice rules skip a
 * monitor's own title exactly as the derivation meant them to.
 *
 * `slack post` validates {@link withoutQuotedFlags}'s copy — the layout schema refuses the flag — and the
 * validated card is what it sends and what the voice rules read. Without this the flags are gone by then, and a
 * title carrying an em dash refuses the whole daily card again. A bold text run is re-marked when its text is a row's label,
 * whole or trimmed with an ellipsis above the fold, which is the run `rowLine` built; a label the schema's own typing split into pieces (a bare URL
 * inside a title) is left unmarked, so the voice rules still read those pieces and say so rather than passing.
 *
 * The "behind it" lines carry the same kind of borrowed words — a monitor's title again, and each SERVICE
 * name the aggregate grouped by — so their labels join the set. They are quoted for one reason and it is not
 * convenience: the voice rules would otherwise read a Datadog service tag as this file's own prose.
 *
 * @param artifact the card the layout schema accepted
 * @param form the alert-summary form it was derived from
 * @returns the same card, with every row-label and behind-label run marked `quoted`
 */
export function withQuotedLabels({
  artifact,
  form,
}: {
  artifact: UpdateArtifact;
  form: AlertSummaryForm;
}): UpdateArtifact {
  // A destructured default rather than `??`: the house rule bans a silent coalesce, and oxlint reads the
  // ternary spelling as one it would rather see written this way. Both are satisfied here.
  const { behind = [] } = form;
  // A row label and a behind MONITOR are the bold run `rowLine`/`behindLine` built, so `bold` is what
  // identifies them. A behind GROUP name is a plain run in the middle of the line, so it is matched on its
  // text alone — the exact strings the form carries, never a substring of the prose around them.
  const bold = [...form.rows.map((row) => row.label), ...behind.map((entry) => entry.monitor)];
  const plain = new Set(behind.flatMap((entry) => entry.groups.map((group) => group.name)));
  const mark = ({ run }: { run: InlineRun }): InlineRun => {
    if (run.type !== "text") {
      return run;
    }
    if (run.bold === true && isRowLabel({ labels: bold, text: run.text })) {
      return { ...run, quoted: true };
    }
    return plain.has(run.text) ? { ...run, quoted: true } : run;
  };
  return {
    ...artifact,
    detail: artifact.detail.map((block) =>
      block.type === "list" || block.type === "bullets"
        ? { ...block, items: block.items.map((runs) => runs.map((run) => mark({ run }))) }
        : block,
    ),
    index: artifact.index.map((runs) => runs.map((run) => mark({ run }))),
  };
}

/**
 * The derived card with every `quoted` flag removed, so the strict layout schema — which refuses the flag on a
 * COMPOSED form, where it would let an author exempt their own prose — can still validate the card's caps.
 *
 * Only the runs this file builds carry the flag, in the index lines and the below-fold list, so those are the
 * two places walked; a paragraph or table would pass through unchanged if one were ever added here. The width
 * arithmetic is unaffected: a quoted run costs its text like any other, which is what the schema measures.
 *
 * @param artifact the card {@link alertSummaryToUpdate} derived
 * @returns the same card, with no run carrying `quoted`
 */
export function withoutQuotedFlags({ artifact }: { artifact: UpdateArtifact }): UpdateArtifact {
  return {
    ...artifact,
    detail: artifact.detail.map((block) =>
      block.type === "list" || block.type === "bullets"
        ? { ...block, items: block.items.map((runs) => runs.map((run) => withoutQuoted({ run }))) }
        : block,
    ),
    index: artifact.index.map((runs) => runs.map((run) => withoutQuoted({ run }))),
  };
}

/** The alert-summary form: field caps, plus {@link alertSummaryCardRefusal} over the card they derive. */
export const alertSummaryFormSchema = alertSummaryFormFields.superRefine((form, ctx) => {
  const refusal = alertSummaryCardRefusal({ form });
  if (refusal === undefined) {
    return;
  }
  // Attached to the FORM rather than to a field, because no single field is at fault — and `lead`, the most
  // likely candidate, is optional, so pointing there would name a field the caller may not have written.
  ctx.addIssue({ code: "custom", message: refusal, path: [] });
});

/**
 * The tally's total, monitor count and unrecognised count, SUMMED — never accepted.
 *
 * Exported because it is the anti-hallucination control itself, and a control nobody can call is a control nobody
 * can test. There is deliberately no inverse: nothing in this module accepts a total.
 *
 * ## Why every number comes from ONE function
 *
 * Because the first two both have to count `omitted`, and two functions that each had to remember to would be
 * a known failure shape — a fact consulted twice, disagreeing once. A total of "just the rows you can
 * see", beside a monitor count of "all of them", is a card that contradicts itself; a total that quietly
 * excluded a folded tail is worse, because it reads as complete. So the set is computed together or not at all.
 *
 * `unrecognised` joined them for the same reason rather than a new one. {@link countSentence} has to decide
 * between a window that held nothing and a window whose every message went unrecognised, and that decision
 * reads `monitors` and the skip count TOGETHER — a second read of `form.skipped` at the call site is exactly
 * the "consulted twice" shape. It is `form.skipped` unchanged, carried here so the pair cannot be split.
 *
 * @param form the alert-summary form
 * @returns the total alerts, the number of distinct monitors — both across the WHOLE window — and how many
 *   messages were read without being recognised as an alert notification
 */
export function deriveTotals({ form }: { form: AlertSummaryForm }): {
  readonly total: number;
  readonly monitors: number;
  readonly unrecognised: number;
} {
  const rowTotal = form.rows.reduce((total, row) => total + row.count, 0);
  const { omitted } = form;
  const omittedMonitors = omitted === undefined ? 0 : omitted.monitors;
  const omittedCount = omitted === undefined ? 0 : omitted.count;
  return {
    monitors: form.rows.length + omittedMonitors,
    total: rowTotal + omittedCount,
    unrecognised: form.skipped,
  };
}

/**
 * The card's ranking: most urgent priority first, then the widest blast radius, then the loudest, then the
 * label — a TOTAL order, so the derivation is deterministic.
 *
 * This REPLACED a noise ordering. Ties still break on the label rather than on the
 * form's original position, which is the one ordering choice here that differs from the digest's: a tally has
 * no authored order to be stable against — the composer emitted a map's entries, so "as supplied" is not a fact
 * about the alerts, and two runs over the same window would shuffle equal rows against each other. Ranking the
 * same window renders byte-identically, which the edit path in PR5.2 relies on.
 *
 * The matrix itself is `./priority.ts`, which knows nothing about a card.
 */
function byPriority({ rows }: { rows: readonly AlertSummaryRow[] }): readonly RankedAlert<AlertSummaryRow>[] {
  return rankAlerts({ alerts: rows });
}

/**
 * `12 fired across 3 monitors.` — or one of the two things a tally can honestly say when no row survived.
 *
 * ## `nothing fired.` is a CLAIM, and it is unreachable when the tally recognised none of its input
 *
 * MEASURED on the Knock alerts channel: 18 messages read, 18 skipped, 0 recognised over 14 days,
 * and the card led above the fold with `nothing fired.` while the honest line — {@link skippedParagraph}'s
 * "18 messages in this window were not recognised as alert notifications" — sat below Show more, where the
 * reader who had already believed the headline never went. A reader cannot be expected to expand a card to
 * find out that its headline was unfounded.
 *
 * The two cases are genuinely different facts and the card now says which one it has. A window with nothing
 * in it PROVES nothing fired: there was nothing to read and nothing to miss. A window whose every message
 * went unrecognised proves only what this reader could parse, so the sentence describes the READ rather than
 * the world, and it says so in the TL;DR where the claim used to be.
 *
 * `unrecognised` IS the read count in this branch, by the field's own definition — `skipped` counts messages
 * read but not recognised, and no row was recognised here, so every message read is in it. That is why there
 * is no second `read` field to supply: a second number is a number that can disagree with this one.
 *
 * ## Why the sentence is four words rather than a full explanation
 *
 * ARITHMETIC, and it is why `skipped` gained a cap the day this branch was written. The sentence now reaches
 * the TL;DR, whose budget is 180: the label and window prefix take 56, the trend clause 27 and an authored
 * `lead` 49, leaving 48. `1000000 messages read, none recognised as an alert notification.` is 64 and
 * DERIVES A CARD THE LAYOUT REFUSES at the unattended hour; `1000000 messages read, none recognised.` is 39.
 * Reproduce either with `yarn vitest run --config config/vitest/unit.ts alertSummary` over the maximal
 * fixture. The long form of the sentence is not lost — it is {@link skippedParagraph}, below the fold, which
 * is the progressive disclosure rule 7 asks for rather than a compromise against it.
 */
function countSentence({ form }: { form: AlertSummaryForm }): string {
  const { total, monitors, unrecognised } = deriveTotals({ form });
  if (monitors === 0 && unrecognised === 0) {
    return "nothing fired.";
  }
  if (monitors === 0) {
    const read = unrecognised === 1 ? "1 message" : `${String(unrecognised)} messages`;
    return `${read} read, none recognised.`;
  }
  const named = monitors === 1 ? "1 monitor" : `${String(monitors)} monitors`;
  return `${String(total)} fired across ${named}.`;
}

/**
 * What separates the subject from the counts in the TL;DR.
 *
 * A middle dot rather than the em dash this used to hard-code, and the reason is measured rather than
 * aesthetic: the operator's voice rules (`slopweaver slack voice-rules`) carry a case-sensitive literal rule
 * for the em dash, `outbound/voice` checks the DERIVED card, and so every alert-summary card this file has
 * ever produced was refused by `slack post` before any network call — including the empty one, whose only
 * authored text is this separator. Measured the first time a scheduled row tried to send one;
 * reproduce it by putting the em dash back and running `slopweaver automation run-due --dry-run` over an
 * `alert-summary` row. The dot is already this card's own separator idiom (a row line ends `· 3×`) and is
 * the same one character wide, so the above-fold arithmetic {@link alertSummaryCardRefusal} pins is
 * unchanged.
 *
 * A row's own `label` is a different matter and is deliberately NOT rewritten anywhere: it is a monitor's
 * name, quoted rather than authored, and {@link rowLine} says so with `quoted: true` so the voice rules pass
 * over it — measured when two of ten team alerts channels could not take their first daily card
 * because a Datadog monitor title held an em dash. Rewriting the title would misquote the monitor; refusing
 * the card would post nothing at the hour nobody is watching.
 *
 * The character itself now comes from `./headline.ts`, which generalised this lane's move — take the ideas as
 * fields and the separator stops being anybody's to type — to every card a composer builds by hand. The local name stays because this file's width arithmetic is written in terms of
 * it.
 */
const TLDR_SEPARATOR = HEADLINE_SEPARATOR;

/**
 * The derived TL;DR: the subject, the channel's WORST priority, the counts, and how they compare with the
 * windows before them. Bounded by construction — see {@link ALERT_SUMMARY_LEAD_VISIBLE_MAX}.
 *
 * The priority token is the whole point of the priority ordering, and it sits this early for one reason: the owner
 * reads eleven of these down a sidebar, and the question they are answering is which channel is worse than the
 * others. A `P2` four words in is visible in that scan; the same fact inside the ranked list below is not.
 *
 * A window with no ranked row carries no priority token at all, because nothing was recognised for one to be
 * about. What {@link countSentence} then says depends on whether anything was READ — see its own doc; either
 * way a priority token would be a severity attached to no alert.
 */
function deriveTldr({
  form,
  ranked,
  trend,
}: {
  form: AlertSummaryForm;
  ranked: readonly RankedAlert<AlertSummaryRow>[];
  trend: AlertTrend | undefined;
}): string {
  const worst = topPriority({ ranked });
  const priority = worst === undefined ? "" : `${worst} ${TLDR_SEPARATOR} `;
  const clause = trendClause({ trend });
  const counts = `${form.label} ${form.window} ${TLDR_SEPARATOR} ${priority}${countSentence({ form })}`;
  const withTrend = clause === undefined ? counts : `${counts}${clause}`;
  return form.lead === undefined ? withTrend : `${withTrend} ${form.lead}`;
}

/**
 * ONE row's line: the severity glyph, the `[n]` citation chip, the label in bold, then the count as a plain
 * trailing clause — no Slack-drawn bullet in front (the derived card sets `indexStyle: "plain"`), because the
 * glyph and the chip already lead every line themselves.
 *
 * This is the shape confirmed against a real reference message, read through the door rather than assumed:
 * glyph, space, citation, space, a bold lead run, then a plain trailing run. The count moved from the FRONT of
 * the line (the original design, before there was a glyph or a chip to lead with) to the END, as a trailing
 * fact rather than the thing a reader scans for first — the glyph and the label are what triage happens over
 * now, and the count is context once you have decided a row is worth reading.
 */
function rowLine({
  ranked,
  citationId,
}: {
  ranked: RankedAlert<AlertSummaryRow>;
  citationId: string | undefined;
}): readonly InlineRun[] {
  const row = ranked.alert;
  const glyph: readonly InlineRun[] = [
    { text: stateGlyph({ severity: row.severity }), type: "text" },
    { text: " ", type: "text" },
  ];
  const chip: readonly InlineRun[] =
    citationId === undefined
      ? []
      : [
          { citationId, type: "citation" },
          { text: " ", type: "text" },
        ];
  return [
    ...glyph,
    ...chip,
    { text: `${ranked.priority} · `, type: "text" },
    { bold: true, quoted: true, text: row.label, type: "text" },
    { text: ` · ${impactCell({ share: ranked.share })} · ${String(row.count)}×`, type: "text" },
  ];
}

/**
 * The colour one row's line opens with: its most recent state, or YELLOW when nothing said what that was.
 *
 * ## Why the glyph is severity and not priority
 *
 * The card names three columns — impact, severity, priority — and only one of them can be the colour.
 * Severity keeps it, because that is what the colour has always meant on this card and because
 * the priority is already spelled on the line as `P2`, where a colour would be a second encoding of a fact the
 * reader can already see. Ranking is carried by Slack's own numbering instead: the derived card sets
 * `indexStyle: "ordered"`, so the list reads 1. 2. 3. down the priority order.
 *
 * ## Why an unknown state gets its own colour rather than no glyph
 *
 * The line used to carry NO glyph when `../../live/slack/alertTally.ts` found no lifecycle word on the most
 * recent occurrence. An `ordered` index cannot do that: `./introAndRank.ts`'s `orderedIndexIssues` refuses a
 * line that does not open with a `RANK_GLYPHS` member, so a glyph-less line would refuse the whole card at the
 * unattended hour. Yellow is the honest fourth colour — `./severity.ts` puts it in `RANK_GLYPHS` and NOT in
 * {@link SEVERITIES}, so it cannot be read as one of the three states, and green would have claimed the alert
 * had recovered when nothing said it had.
 */
function stateGlyph({ severity }: { severity: Severity | undefined }): string {
  if (severity === undefined) {
    return STATE_UNKNOWN_GLYPH;
  }
  return SEVERITY_GLYPH[severity];
}

/** The colour a row whose most recent occurrence carried no lifecycle word opens with. */
const STATE_UNKNOWN_GLYPH = "\u{1F7E1}";

/** The visible width of a derived line, by the same rule the caps use: a chip costs its `[n]`. */
function lineWidth({ runs, chipWidth }: { runs: readonly InlineRun[]; chipWidth: number }): number {
  return runs.reduce((total, run) => (run.type === "text" ? total + run.text.length : total + chipWidth), 0);
}

/**
 * An above-the-fold row line, TRIMMED to fit rather than allowed to fail the send.
 *
 * An alert summary is UNATTENDED. Refusing to post because a monitor's name ran four characters long would turn
 * a cosmetic problem into no summary at all, at the exact hour nobody is watching — so the one thing that gives
 * is the label. The glyph, the chip and the count are load-bearing and are never cut, and the ellipsis makes the
 * trim visible rather than silent. That is what separates this from the dropped field `../strictForm.ts` exists
 * to stop: a trim you can SEE is a degrade the reader is told about.
 *
 * Only applied above the fold, where the region cap is tight. Below the fold a row line has no such pressure —
 * {@link BULLET_ITEM_VISIBLE_MAX} (200) is generous enough that no combination the field caps admit reaches it,
 * so `alertSummaryToUpdate` uses {@link rowLine} directly there.
 *
 * The label is still the only thing that gives. The priority ordering added two load-bearing cells in front of it —
 * the priority and the estimated share — and neither may be cut: a matrix missing a column is not a matrix, and
 * a share cut to `~3.` is a wrong number rather than a short one.
 *
 * @param ranked the row and the cells it derived
 * @param citationId the citation this row resolved to, or undefined
 * @param chipWidth the widest citation label in the whole card, charged to every line uniformly
 * @returns the row's line, trimmed to fit when the untrimmed line would not
 */
function fittedRowLine({
  ranked,
  citationId,
  chipWidth,
}: {
  ranked: RankedAlert<AlertSummaryRow>;
  citationId: string | undefined;
  chipWidth: number;
}): readonly InlineRun[] {
  const line = rowLine({ citationId, ranked });
  const overBy = lineWidth({ chipWidth, runs: line }) - ALERT_SUMMARY_LINE_VISIBLE_MAX;
  if (overBy <= 0) {
    return line;
  }
  // Through {@link clippedToWidth} for the reason that helper exists: a raw `slice` splits a surrogate pair,
  // so a 40-emoji monitor title came out with half a character in front of the ellipsis. A review pass found
  // the fix had landed on the behind line and not on this one, which is the same cut.
  const label = ranked.alert.label;
  const room = Math.max(1, label.length - overBy);
  return rowLine({
    citationId,
    ranked: { ...ranked, alert: { ...ranked.alert, label: clippedToWidth({ room, text: label }) } },
  });
}

/**
 * One citation per row that supplied a query URL, labelled `[n]` in ranked order.
 *
 * The id is POSITIONAL (`c1`, `c2`) rather than derived from the label, so uniqueness is guaranteed by
 * construction rather than by the composer having picked distinct names.
 *
 * @param ranked the rows in their final, priority-ranked position
 * @returns the citations, and the per-row id map the index lines reference
 */
function deriveCitations({ ranked }: { ranked: readonly RankedAlert<AlertSummaryRow>[] }): {
  readonly citations: readonly Citation[];
  readonly idFor: ReadonlyMap<number, string>;
} {
  const citations: Citation[] = [];
  const idFor = new Map<number, string>();
  ranked.forEach((entry, position) => {
    const { citationUrl } = entry.alert;
    if (citationUrl === undefined) {
      return;
    }
    const id = `c${String(citations.length + 1)}`;
    idFor.set(position, id);
    citations.push({ id, label: `[${String(citations.length + 1)}]`, url: citationUrl });
  });
  return { citations, idFor };
}

/**
 * The below-fold coverage note, emitted only when something was skipped.
 *
 * A zero is not rendered, for the reason the digest does not advertise three empty severity buckets: a line
 * saying nothing was missed is noise on every well-behaved run, and its absence is not a claim anybody has to
 * read. When it IS non-zero it says so in the message itself, so a reader can tell a quiet window from an
 * unparsed one — which is the difference the count alone hides.
 */
function skippedParagraph({ skipped }: { skipped: number }): readonly DetailBlock[] {
  if (skipped === 0) {
    return [];
  }
  // Both numbers get a whole sentence rather than one sentence with a spliced-in count, because every word after
  // the number has to agree with it — and this is a card the owner reads, so "1 message were not recognised as
  // alert notifications" is exactly the seam a reader trips on.
  const sentence =
    skipped === 1
      ? "1 message in this window was not recognised as an alert notification and is not counted above."
      : `${String(skipped)} messages in this window were not recognised as alert notifications and are not counted above.`;
  return [
    {
      runs: [{ text: sentence, type: "text" }],
      type: "paragraph",
    },
  ];
}

/**
 * The below-fold note for the quiet tail the row cap left out, emitted only when there IS one.
 *
 * It says the monitors are absent from the LIST, and deliberately does not say they are absent from the counts —
 * because they are not. {@link deriveTotals} adds them in, so the TL;DR already describes the whole window, and a
 * note claiming otherwise would contradict the number directly above it. That distinction is the entire reason
 * this sentence is worded so carefully: the tail is missing from the LIST, not from the ARITHMETIC.
 */
function omittedParagraph({ omitted }: { omitted: AlertSummaryForm["omitted"] }): readonly DetailBlock[] {
  if (omitted === undefined) {
    return [];
  }
  // One whole sentence per case, for the reason `skippedParagraph` gives: with a count spliced into a single
  // template, the verb after it disagrees with the number in front of it on one of the two branches.
  const fired = omitted.count === 1 ? "once" : `${String(omitted.count)} times`;
  const sentence =
    omitted.monitors === 1
      ? `1 quieter monitor fired ${fired} and is counted in the total above, but is not listed.`
      : `${String(omitted.monitors)} quieter monitors fired ${fired} between them and are counted in the total ` +
        "above, but are not listed.";
  return [{ runs: [{ text: sentence, type: "text" }], type: "paragraph" }];
}

/**
 * `2 red, 3 orange, 5 green` — non-zero buckets only, over the rows actually SHOWN.
 *
 * Scoped to `rows` rather than the whole window on purpose: a folded tail (see `omittedParagraph`) carries a
 * count and a monitor total but no per-row severity, because {@link foldTally} drops the row along with it. A
 * breakdown that silently included the tail would be counting something it cannot see.
 *
 * @param rows the kept rows, each optionally carrying a severity
 * @returns the breakdown clause, or undefined when no row carries a severity to bucket
 */
function severityBreakdown({ rows }: { rows: readonly AlertSummaryRow[] }): string | undefined {
  const parts = SEVERITIES.filter((severity) => rows.some((row) => row.severity === severity)).map((severity) => {
    const count = rows.filter((row) => row.severity === severity).length;
    return `${String(count)} ${SEVERITY_WORD[severity]}`;
  });
  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * The below-fold paragraph naming the severity split, emitted only when at least one row carries one.
 *
 * Scoped to every row this card is showing SOMEWHERE — above the fold or below it, now that both render as
 * cited lines rather than only the index being scannable. A row built without going through `alertTally.ts`'s
 * classification may carry no severity at all, and a breakdown of zero rows would be a paragraph saying
 * nothing — so this degrades to nothing rather than to an empty sentence, the same posture `skippedParagraph`
 * and `omittedParagraph` take for their own zero cases.
 */
function severityParagraph({ rows }: { rows: readonly AlertSummaryRow[] }): readonly DetailBlock[] {
  const breakdown = severityBreakdown({ rows });
  if (breakdown === undefined) {
    return [];
  }
  return [
    {
      runs: [{ text: `Most recent state across the rows shown: ${breakdown}.`, type: "text" }],
      type: "paragraph",
    },
  ];
}

/**
 * `2 of 485` as a share a reader scans — one decimal, and `<0.1%` rather than a misleading `0.0%`.
 *
 * @returns the share, written as a percentage
 */
function shareOf({ count, total }: { count: number; total: number }): string {
  if (total === 0) {
    return "0%";
  }
  const percent = (count / total) * 100;
  if (percent > 0 && percent < 0.1) {
    return "<0.1%";
  }
  return `${percent.toFixed(1)}%`;
}

/**
 * The group clause's runs: each service NAME its own `quoted` run, every separator and share plain.
 *
 * Split that finely on purpose. `quoted` means "somebody else's words, so the voice rules skip it", and a
 * service name is exactly that while the sentence around it is this file's own — one `quoted` run over the
 * whole clause would exempt derived prose from the rules it is meant to be held to.
 *
 * @param entry the aggregate, whose `events` is the denominator of every share
 * @param groups how many of its groups to render — the caller drops the tail until the line fits
 * @returns the runs, empty when the aggregate named no group
 */
function behindGroupRuns({ entry, groups }: { entry: AlertSummaryBehind; groups: number }): readonly InlineRun[] {
  return entry.groups.slice(0, groups).flatMap((group, position) => [
    { text: position === 0 ? ": " : ", ", type: "text" as const },
    { quoted: true, text: group.name, type: "text" as const },
    { text: ` ${shareOf({ count: group.count, total: entry.events })}`, type: "text" as const },
  ]);
}

/**
 * The widest a `[n]` chip can render on THIS card, in characters.
 *
 * Four: two brackets and a two-digit number. The card's citation count is bounded by what can carry a chip —
 * `TABLE_MAX_ROWS` rows plus `RECOMMENDATIONS_MAX` plus {@link ALERT_SUMMARY_BEHIND_MAX} — which is well
 * inside two digits, and a review pass measured this lane emitting 17 chips with the recommendations lane
 * present. It used to be computed from `../assistant/contentLimits.ts`'s `CITATIONS_MAX`, which happened to
 * give the same 4 and read as a claim that the constant bounded this card; it never did — see
 * {@link behindSection}.
 */
const CHIP_VISIBLE_WIDTH = 4;

/** The visible width of one run sequence, charging a chip its widest possible `[n]` label. */
function runsWidth({ runs }: { runs: readonly InlineRun[] }): number {
  return runs.reduce((total, run) => (run.type === "text" ? total + run.text.length : total + CHIP_VISIBLE_WIDTH), 0);
}

/**
 * The fewest characters of monitor label a line is allowed to keep.
 *
 * A trim floor below this reads as a typo rather than a trim, and the whole point of the line is to say WHICH
 * monitor. When even this will not fit, the group clause is what gives way — see {@link behindLine}.
 */
const BEHIND_MONITOR_MIN_CHARS = 24;

/**
 * ONE "behind it" line: the chip, the monitor quoted in bold, the event count, then the largest groups with
 * their share.
 *
 * ## Why the GROUPS give way, and why that is not a detail
 *
 * The first version budgeted the monitor label alone and let the group clause take whatever width it wanted.
 * A group name is clipped to {@link ALERT_SUMMARY_ROW_LABEL_MAX} (80) — this repo's own cap, not a Datadog
 * one — and three of them ride one line, so MEASURED on the installed census's three longest service names
 * (54, 50 and 48 characters) the derived item came to 206
 * against a 200 cap — and because the whole card is refused rather than truncated, a SUCCESSFUL Datadog read
 * was what stopped the tally posting at the unattended hour. Reproduce by putting those three names in a
 * `behind` entry's `groups` and running `slack post --as bot --form … --dry-run`.
 *
 * So the order of giving way is: trim the monitor label down to {@link BEHIND_MONITOR_MIN_CHARS}, then drop
 * group NAMES from the tail, one at a time, until the line fits — and the count clause, which is the claim
 * the line exists to make, is never touched. A dropped group is visible as a shorter list rather than as a
 * wrong number, and the reader still has the chip to open the aggregate itself.
 *
 * @param entry the aggregate one monitor's query produced
 * @param citationId the chip this entry resolved to, or undefined when the card's citation budget was spent
 * @returns the line's runs, never wider than {@link BULLET_ITEM_VISIBLE_MAX}
 */
function behindLine({
  entry,
  citationId,
}: {
  entry: AlertSummaryBehind;
  citationId: string | undefined;
}): readonly InlineRun[] {
  const chip: readonly InlineRun[] =
    citationId === undefined
      ? []
      : [
          { citationId, type: "citation" },
          { text: " ", type: "text" },
        ];
  const count = ` · ${String(entry.events)} matching event(s)`;
  const fixedWidth = runsWidth({ runs: chip }) + count.length;
  for (let groups = entry.groups.length; groups >= 0; groups -= 1) {
    const groupRuns = behindGroupRuns({ entry, groups });
    const room = BULLET_ITEM_VISIBLE_MAX - fixedWidth - runsWidth({ runs: groupRuns });
    if (room < BEHIND_MONITOR_MIN_CHARS && groups > 0) {
      continue;
    }
    const monitor = clippedToWidth({ room, text: entry.monitor });
    return [
      ...chip,
      { bold: true, quoted: true, text: monitor, type: "text" },
      { text: count, type: "text" },
      ...groupRuns,
    ];
  }
  // Unreachable: the loop's last pass carries no group, and the count clause plus a one-character monitor is
  // 30-odd characters against a 200 cap. Spelled rather than asserted, because a `!` here would be a lie
  // about which branch is impossible.
  return [...chip, { bold: true, quoted: true, text: entry.monitor, type: "text" }, { text: count, type: "text" }];
}

/**
 * The "behind it" section: one sentence saying what the numbers are, then one cited line per monitor.
 *
 * Its chips continue the rows' numbering, and EVERY entry that carries a `citationUrl` gets one.
 *
 * ## The budget this used to keep, and what removing it actually bought
 *
 * It used to drop a chip once the running number passed `../assistant/contentLimits.ts`'s `CITATIONS_MAX`
 * (12). That constant is the FLOOR under the answer arm's citation budget (`../assistant/citedAndShown.ts`'s
 * `citationsCeiling`) and bounds NOTHING here: `./schema.ts`'s `updateArtifactSchema` puts no maximum on
 * `citations` at all, which {@link ALERT_SUMMARY_BEHIND_MAX}'s own comment already said out loud.
 *
 * **State what it was, not a harm it never did.** The branch was UNREACHABLE at today's caps and no card ever
 * lost a chip to it: `firstCitation` is the ROW count, capped at `TABLE_MAX_ROWS` (10), and this section adds
 * at most {@link ALERT_SUMMARY_BEHIND_MAX} (2), so the highest number it could reach was exactly 12. The
 * recommendations lane numbers AFTER this one, so its five chips never pushed these two past the ceiling
 * either — an earlier draft of this comment claimed they did, and `alertSummary/behind.test.ts`'s 17-chip case
 * is what disproved it.
 *
 * What the removal buys is therefore a coupling, not a rendered chip: a constant from a different schema sat
 * in a branch that read as though it bounded this card, and one more row cap or one reordering of the lanes
 * would have turned it into a silent drop on the biggest, noisiest tally — the one whose numbers most need a
 * link. The card's own bound is {@link ALERT_SUMMARY_BEHIND_MAX}, and that is what is left holding it.
 *
 * @param behind the aggregates, or undefined when the tick read none
 * @param window the card's window, which every aggregate was taken over
 * @param firstCitation how many citations the rows already hold
 * @returns the detail blocks and the citations they reference
 */
function behindSection({
  behind,
  window,
  firstCitation,
}: {
  behind: AlertSummaryForm["behind"];
  window: string;
  firstCitation: number;
}): { readonly blocks: readonly DetailBlock[]; readonly citations: readonly Citation[] } {
  if (behind === undefined || behind.length === 0) {
    return { blocks: [], citations: [] };
  }
  const citations: Citation[] = [];
  const items = behind.map((entry) => {
    const next = firstCitation + citations.length + 1;
    if (entry.citationUrl === undefined) {
      return behindLine({ citationId: undefined, entry });
    }
    const id = `c${String(next)}`;
    citations.push({ id, label: `[${String(next)}]`, url: entry.citationUrl });
    return behindLine({ citationId: id, entry });
  });
  return {
    blocks: [
      {
        runs: [
          {
            text: `Behind the noisiest monitors: each one's own Datadog query, rerun over the last ${window}, by service.`,
            type: "text",
          },
        ],
        type: "paragraph",
      },
      { items, type: "list" },
    ],
    citations,
  };
}

/**
 * The detail: the severity split, then every row the fold left OUT of the index as its own cited line, or a
 * stated absence when nothing fired.
 *
 * The detail cannot simply be empty when there IS a tally, because the `Details` label needs something behind it and the
 * chrome is exactly five — the detail is what supplies the sixth. A quiet window therefore renders as a
 * paragraph SAYING it was quiet, which is both a legal card and the honest rendering of the result.
 *
 * A second fallback stood here — `Every alert this window fired is listed above.` — for the case where every
 * row fit above the fold AND none carried a severity to summarise. It is GONE rather than kept beside the new
 * lane, because `basis` is emitted unconditionally (the trend sentence states its own absent
 * case), so that branch became unreachable. An unreachable branch is indistinguishable from a broken one, and
 * the filler line it printed said less than the sentence that replaced it.
 *
 * @param rows every row the form carries, in their final ranked order — for the severity breakdown, which
 *   covers rows shown anywhere, not just the ones below the fold
 * @param belowFold the rows the index did not have room for, already rendered as their own lines
 * @param behind the "behind it" blocks, which count as detail so the "listed above" line never sits beside them
 * @param basis the impact-basis and trend sentences, which say what every number above the fold is
 * @returns the detail blocks, never empty while `rows` is non-empty
 */
function deriveDetail({
  rows,
  belowFold,
  behind,
  basis,
}: {
  rows: readonly AlertSummaryRow[];
  belowFold: readonly (readonly InlineRun[])[];
  behind: readonly DetailBlock[];
  basis: readonly DetailBlock[];
}): readonly DetailBlock[] {
  if (rows.length === 0) {
    // The behind blocks ride a QUIET window too, and dropping them here is what made the card unsendable: a
    // review pass measured `rows: []` plus one behind entry deriving a citation nothing cites, which
    // `updateArtifactSchema` refuses — so a successful Datadog read stopped the card again, by another route.
    // Keeping them is also the better card: a quiet window with a telemetry reading under it is information.
    return [
      { runs: [{ text: "No alerts fired in this window.", type: "text" }], type: "paragraph" },
      ...basis,
      ...behind,
    ];
  }
  return [
    ...severityParagraph({ rows }),
    ...(belowFold.length === 0 ? [] : [{ items: belowFold, type: "list" as const }]),
    ...basis,
    ...behind,
  ];
}

/**
 * The two sentences that say what every number above the fold IS: the impact basis, and the trend baseline.
 *
 * Below the fold and once per card, rather than as a qualifier on each of ten lines. The above-fold region is
 * the scarcest thing on this card and a reader who wants the basis expands the detail; a reader who does not
 * still sees the tilde on every share, which is the mark that says estimate on the line itself.
 *
 * The trend sentence is emitted even when there is NO trend, because its absent case is the informative one —
 * a card silently not comparing itself with anything reads exactly like a card that compared itself and found
 * no change.
 *
 * @param form the validated form
 * @param ranked the rows in their final ranked order, whose readings the basis sentence counts
 * @param trend the judged trend, absent when no baseline was read
 * @returns the paragraphs, in the order they render
 */
function basisBlocks({
  form,
  ranked,
  trend,
}: {
  form: AlertSummaryForm;
  ranked: readonly RankedAlert<AlertSummaryRow>[];
  trend: AlertTrend | undefined;
}): readonly DetailBlock[] {
  const measured = ranked.filter((entry) => entry.share !== undefined).length;
  const basis = impactBasisSentence({ measured, query: "monitor", total: ranked.length });
  const trendText = trendSentence({
    counted: "alerts",
    current: deriveTotals({ form }).total,
    trend,
    window: form.window,
  });
  return [
    ...(basis === undefined ? [] : [{ runs: [{ text: basis, type: "text" as const }], type: "paragraph" as const }]),
    { runs: [{ text: trendText, type: "text" as const }], type: "paragraph" as const },
  ];
}

/** The detail and citations one KEPT number of behind entries derives, recommendations lane included. */
function laneFor({
  behindEntries,
  belowFold,
  form,
  ranked,
  rowCitations,
  trend,
}: {
  behindEntries: readonly AlertSummaryBehind[];
  belowFold: readonly (readonly InlineRun[])[];
  form: AlertSummaryForm;
  ranked: readonly RankedAlert<AlertSummaryRow>[];
  rowCitations: readonly Citation[];
  trend: AlertTrend | undefined;
}): { readonly citations: readonly Citation[]; readonly detail: readonly DetailBlock[] } {
  const behind = behindSection({ behind: behindEntries, firstCitation: rowCitations.length, window: form.window });
  return withRecommendations({
    citations: [...rowCitations, ...behind.citations],
    detail: [
      ...deriveDetail({
        basis: basisBlocks({ form, ranked, trend }),
        behind: behind.blocks,
        belowFold,
        rows: ranked.map((entry) => entry.alert),
      }),
      ...omittedParagraph({ omitted: form.omitted }),
      ...skippedParagraph({ skipped: form.skipped }),
    ],
    recommendations: form.recommendations,
  });
}

/**
 * The card's detail with as many behind entries as the below-fold PROSE budget affords, noisiest first.
 *
 * ## Why the behind section sheds, and why the budget is the thing it must not blow
 *
 * A `list` block counts in full against `DETAIL_PROSE_VISIBLE_MAX` (only a `table` is free —
 * `./visibleLength.ts`), and this card's detail now carries three below-fold lanes: the folded rows, the
 * recommendations, and this one. MEASURED by a review pass: ten maximal rows
 * plus five maximal recommendations came to 1308, two maximal behind entries added 489, and a wider `window`
 * or a longer `skipped` tipped the total to 1801 against the 1800 cap — so the card was REFUSED, and the
 * refusal named the above-fold fields, none of which a caller could shorten to fix it. Reproduce with the
 * form in that pass's report through `slack post --as bot --form … --dry-run`.
 *
 * The recommendations lane already sheds from its own tail to fit. This does the same, and it sheds FIRST in
 * the sense that matters: an entry dropped here frees the budget the recommendations lane then measures
 * itself against, so the two cannot fight over the same characters. A dropped entry is a shorter section
 * rather than a refused card — and the alternative was the scheduled card silently losing a recommendation
 * to make room for a telemetry reading nobody asked to prioritise.
 *
 * @param belowFold the row lines the index had no room for
 * @param form the validated form
 * @param ranked the rows in their final ranked order
 * @param rowCitations the citations the rows already hold
 * @param trend the judged trend, absent when no baseline was read
 * @returns the fitted detail and its citations
 */
function fittedLane({
  belowFold,
  form,
  ranked,
  rowCitations,
  trend,
}: {
  belowFold: readonly (readonly InlineRun[])[];
  form: AlertSummaryForm;
  ranked: readonly RankedAlert<AlertSummaryRow>[];
  rowCitations: readonly Citation[];
  trend: AlertTrend | undefined;
}): { readonly citations: readonly Citation[]; readonly detail: readonly DetailBlock[] } {
  const { behind = [] } = form;
  // Down to and INCLUDING zero, so the last attempt is measured like every other one rather than returned on
  // the argument that it must fit. Why the zero case cannot breach the budget is a BOUND rather than a
  // reading, because two review passes restated a reading and both were stale: the base lane is one heading
  // (20) plus at most `RECOMMENDATIONS_MAX` items at `BULLET_ITEM_VISIBLE_MAX` (1,000), at most
  // `TABLE_MAX_ROWS - INDEX_MAX_ITEMS` below-fold row lines at that same per-item cap (200), and five
  // derived paragraphs — the three coverage notes, plus the impact-basis and trend sentences the priority
  // ordering added, whose templates plus their widest counts leave each under 220 — so under 1,800 of the 1,800
  // budget, whatever the fields are. That is now a TIGHT bound rather than a comfortable one, which is
  // exactly why the loop still measures its own last pass instead of returning it on the argument that it
  // must fit: an unreachable branch nobody measures is how this property comes back the next time a lane
  // lands below the fold.

  let leanest: { readonly citations: readonly Citation[]; readonly detail: readonly DetailBlock[] } | undefined;
  for (let kept = behind.length; kept >= 0; kept -= 1) {
    const lane = laneFor({ behindEntries: behind.slice(0, kept), belowFold, form, ranked, rowCitations, trend });
    if (visibleLengthOfDetail({ citations: lane.citations, detail: lane.detail }) <= DETAIL_PROSE_VISIBLE_MAX) {
      return lane;
    }
    leanest = lane;
  }
  // Nothing fitted, behind entries included or not: the rows, the coverage notes and the recommendations lane
  // are over the budget on their own. The caller gets the lane with NO telemetry reading — the loop's own last
  // pass, kept rather than rebuilt — and the layout schema refuses it by its own cap rather than this
  // deriving something it believes is legal. The `!` is honest: the loop always runs its `kept = 0` pass.
  return leanest!;
}
/**
 * Derive the card from the alert-summary form. PURE and total: every valid form yields a valid
 * {@link UpdateArtifact}, which the test suite asserts over the boundary cases.
 *
 * The structural decisions, all made here rather than by a composer:
 *
 * - rows are RANKED by derived priority, then blast radius, then count, then label, so the same window renders
 *   identically — which replaced the noise ordering this card had before it;
 * - the most urgent {@link ALERT_SUMMARY_INDEXED_MAX} go above the fold as their own cited lines, as a
 *   Slack-numbered `ordered` list, because a ranked list a reader is meant to scan top-down should be
 *   numbered by the client rather than merely happen to be in order;
 * - every line carries a colour for its state, the derived `P0`-`P4`, the label, an estimated blast radius and
 *   the count — the three columns of item 18's matrix plus what fired and how often;
 * - EVERY remaining row still goes below the fold as its OWN cited line, never a table, so nothing loses its
 *   citation by not being urgent enough;
 * - a severity breakdown earns its own paragraph over every row shown, above the fold or below it;
 * - the impact basis and the trend baseline earn one paragraph each, so no number above the fold is
 *   unexplained and none of them is presented as measured when it is estimated;
 * - the total in the TL;DR is summed from the rows PLUS `omitted`, and cannot be supplied;
 * - an `omitted` tail earns its own paragraph saying it is missing from the list and not from the total;
 * - a non-zero `skipped` earns its own paragraph, and a zero earns nothing.
 *
 * Unlike `digestToUpdate` this takes no `isKnownPerson`, because the form has no owner to ping: a tally names
 * monitors, not people. That is a scope statement rather than an omission — routing a noisy monitor to whoever
 * owns it needs an ownership fact this form does not carry.
 *
 * @param form the validated alert-summary form
 * @returns the card artifact
 */
export function alertSummaryToUpdate({ form }: { form: AlertSummaryForm }): UpdateArtifact {
  const ranked = byPriority({ rows: form.rows });
  const trend = deriveTrend({ current: deriveTotals({ form }).total, reading: form.trend });
  const { citations: rowCitations, idFor } = deriveCitations({ ranked });
  const indexed = ranked.slice(0, ALERT_SUMMARY_INDEXED_MAX);
  const rest = ranked.slice(ALERT_SUMMARY_INDEXED_MAX);
  const belowFold = rest.map((entry, restPosition) =>
    rowLine({ citationId: idFor.get(ALERT_SUMMARY_INDEXED_MAX + restPosition), ranked: entry }),
  );
  const withLane = fittedLane({ belowFold, form, ranked, rowCitations, trend });
  // Every chip renders as `[n]`, so its visible width is that label's length — taken from the widest derived
  // label rather than assumed to be 3, which would understate it past nine citations.
  const chipWidth = withLane.citations.reduce((widest, citation) => Math.max(widest, citation.label.length), 0);
  return {
    citations: withLane.citations,
    detail: withLane.detail,
    index: indexed.map((entry, position) =>
      fittedRowLine({ chipWidth, citationId: idFor.get(position), ranked: entry }),
    ),
    indexStyle: "ordered",
    intro: form.intro,
    kind: "update",
    media: [],
    tldr: deriveTldr({ form, ranked, trend }),
  };
}
