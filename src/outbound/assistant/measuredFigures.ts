/**
 * The fourth show-your-work rule: a FIGURE the answer asserts carries the measurement that settles it.
 *
 * ## The asymmetry this closes
 *
 * A measured comment in CODE must already carry the command that reproduces it inline
 * (`.claude/rules/typescript-patterns.md` § Other rules: *"Measured comments carry an inline repro command,
 * not just a number/date"*). Nothing bound a number in an OUTBOUND ANSWER the same way, so the only thing
 * catching one was a reviewer's eye — and the eye is what was measured failing.
 *
 * MEASURED over every verdict this install holds (311 records across 130 threads): 619 of 4,468
 * reviewed claims are `support: "unsupported"`, and **319 of those 619 carry a digit in their own text**. The
 * figure class is the majority of the unsupported half rather than a tail. **The store grows, so the repro
 * below returns a LARGER pair every day and the absolutes above are a dated snapshot rather than a value to
 * re-derive** — the durable claim is the share, 14% of claims unsupported and 52% of those carrying a digit,
 * and it held to the point within hours of being taken. One unsupported claim text appears
 * twice verbatim and is the whole class in one line — `91,131 was the AU Notification daily max last week` —
 * a count with a date attached and nothing saying when 91,131 was read. Reproduce with:
 *
 * ```
 * jq -s '[.[] | .claims[]? | select(.support=="unsupported") | .text]
 *   | {total: length, withDigit: ([.[] | select(test("[0-9]"))] | length)}' \
 *   $(find "$SLOPWEAVER_HOME/live/slack/reviews" -name 'verdict.json' -o -name 'verdict-superseded-*.json')
 * ```
 *
 * ## The criterion is NARROW, and the narrowing is the measurement
 *
 * "Any number" is not a usable criterion, and this is not a judgement call — it was driven over the 180 real
 * reviewed answer forms on disk (`find "$SLOPWEAVER_HOME/live/slack/reviews" -name 'answer-reviewed-*.json'`,
 * scanning `text` runs of each item plus `lead`, counting DISTINCT tokens per answer):
 *
 * | criterion | answers owing nothing | median | p90 | worst |
 * | --- | --- | --- | --- | --- |
 * | any cardinal, any date form | 6 / 180 | 20 | — | 127 |
 * | + {@link FIGURE} 's magnitude floor, dated forms masked | 22 / 180 | 3 | 12 | 102 |
 * | + leading-zero runs masked | 34 / 180 | 3 | 11 | 101 |
 * | + bare runs of 5+ digits masked as identifiers, decimal percentages kept | 39 / 180 | 2 | 11 | 50 |
 *
 * The first three rows come from a standalone token pass over those files. **The last row is the SHIPPED
 * criterion, re-measured through {@link figuresInAnswer} itself** after the r1 review broke the decimal
 * percentage (see {@link MASKS}), which is why it is the one row a reader can reproduce exactly: call the
 * exported function over each form's `body`, `index` and `lead` and count the distinct figures. It moved by
 * one answer against the standalone pass, and that difference is the walk rather than the criterion —
 * {@link answerItems} decides what an item is, and the standalone pass guessed.
 *
 * A gate demanding a median of twenty measurement entries is a hatch that is always open, which is the
 * weaken-the-gate move arrived at by accident — the exact failure `./citedAndShown.ts`'s own
 * `citationBudgetCollision` records. A median of two is a rule a composer can meet.
 *
 * One answer in that set is the argument for the last row by itself. Its lead reads *"7,049 alerts in 30
 * days, 118 of your 236 monitors produced every one of them, and 72 have never fired once in their lives"*,
 * and under the broad criterion it owed **101** entries — ninety of them Datadog MONITOR IDS (`1000004`,
 * `50100`, `600105`, `600106`). Under {@link figuresInAnswer} it owes **23**, and every one of the
 * twenty-three is a real measurement: `1,008  1,771  118  14,180  189  200  236  256  257  3,349  321  357
 * 400  49%  570  59.8%  6,835  609  7,049  774  98%  99%  997`. Twenty-three figures is not twenty-three
 * entries: most of them came off one Datadog query, and {@link FigureMeasurement} holding a LIST is what
 * turns that into a handful.
 *
 * ## Four residues, stated rather than left to be discovered
 *
 * **A bare run of five or more digits is masked as an identifier**, so a composer who writes `10000` for a
 * measured cap buys silence. That is a real hole and it is the right trade on the evidence: across those 180
 * answers every measurement of that magnitude is written with separators (`7,049`, `14,180`, `91,131`) and
 * every bare 5+ run is an id. The mirror-image judgement is already in this tree —
 * `../linkify/bareRefs.ts`'s `PR_LIST_CONTEXT` treats a bare digit run as a reference in ONE narrow shape,
 * *"narrow on purpose so an ordinary sentence with a number in it is never mistaken for a PR list"*.
 *
 * **A decimal with no percent sign is masked.** `1,208.5` and `$1,250.00` are eaten by the decimal mask,
 * which keeps its right boundary only against `%`. Both measure ZERO across the 180 answers, so the narrow
 * reading is the measured one; a real decimal count would be a reason to revisit it, not a reason to guess now.
 *
 * **A figure split across two runs is read as its tail.** `{"1,"}{"208 rows"}` renders `1,208` to the reader
 * and {@link textRunTextOf} joins the runs with a space, so the scan sees `208` and demands a measurement for
 * a token the answer never shows. Nothing sensible authors that, and closing it means concatenating runs
 * without the separator that stopped an identifier's full stop welding two sentences together
 * (`.claude/rules/area-outbound.md` § The fold is a structure) — a worse trade than naming it here.
 *
 * **A date SPAN is not covered.** The finding named one ("a count, a date, a span, a roster size") and this
 * rule answers the count and the roster size only: a span's own components are one and two digits, below the
 * floor, and masking dated forms is what makes the count half usable at all. What settles a date in this
 * repository already exists and is elsewhere — `premiseCheckSchema`'s `checkedAtIso`, the evidence trail's
 * own instants, and `slopweaver slack when <ts>` for a Slack `ts`. Widening the floor to reach spans
 * reproduces the 20-median column above, which is why it was not done.
 *
 * ## Why per-FIGURE rather than per-ITEM, unlike rule one
 *
 * Rule one is per-item because a CITATION is a chip the reader follows from where they are standing, so its
 * position IS the grounding — *"a citation elsewhere in the message does not ground this claim"*. A repro is
 * not positional: it is a command, and running it once settles the number everywhere it appears. So coverage
 * matches on the figure's TEXT, and a figure repeated in five rows owes one entry, not five.
 *
 * ## Why one entry carries a LIST of figures
 *
 * One command usually produces several numbers at once — a whole table's worth. {@link FigureMeasurement}
 * therefore holds `figures` (non-empty) against one `repro`, which is what the code-comment precedent does
 * too: `../../devLint/namedObjectParamsHeap.ts`'s `HEAP_BUDGET_MIB` carries ONE repro for the measurement
 * history it holds. Without that, the 19-figure answer above owes 19 three-field entries — a wall of its own,
 * and a composer reaches for the hatch instead. With it, it owes a handful, and the entry count is bounded
 * by the number of distinct COMMANDS rather than by the number of figures, so `citationBudgetCollision`'s
 * class cannot re-form here. That bound is a MECHANISM and not a convention only because
 * {@link duplicateMeasurementIssues} exists: without it forty entries naming one figure passed everything,
 * which is what the r2 review found.
 */
import { z } from "zod";

import type { DetailBlock, InlineRun } from "../artifact/types.js";
import { type BareRefContext, type BareRefIssue, scanBareRefs } from "../linkify/bareRefs.js";
import { strictForm } from "../strictForm.js";

import { type AnswerItem, answerItems } from "./citedAndShown.js";
import { EVIDENCE_LABEL_VISIBLE_MAX, PARAGRAPH_VISIBLE_MAX } from "./contentLimits.js";

/** The journalled hatch: send an answer asserting a figure with no measurement behind it, unchanged. */
export const UNMEASURED_FIGURES_HATCH = "unmeasured-figures";

/**
 * One measurement: the figures ONE command produced, the command itself, and when it ran.
 *
 * The shape {@link measurementSchema} parses, declared beside it so the scanner and the schema cannot drift.
 * `figures` is non-empty by the schema's `.min(1)`; the instant is required for the reason `premiseCheckSchema`
 * states about its own — an undated measurement is worthless, and the class's worked example (`91,131 … last
 * week`) is unsupported precisely because nothing says when it was read.
 */
export interface FigureMeasurement {
  readonly figures: readonly string[];
  readonly repro: string;
  readonly takenAtIso: string;
}

/**
 * One measurement: the figures ONE command produced, the command that produces them again, and when it ran.
 *
 * The third show-your-work rule's whole vocabulary, as `./answerForm.ts` parses it. This file's header carries
 * the criterion, the measurement that narrowed it and why one entry holds a LIST of figures rather than one;
 * read that header before changing a field here. `takenAtIso` is session-authored like every other instant in
 * this form — nothing in these modules reads a clock.
 */
export const measurementSchema = strictForm({
  /** Every figure this one command produced, spelled EXACTLY as the answer writes it — `1,771`, `49%`. */
  figures: z.array(z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX)).min(1),
  /** The command that produces them again, runnable as written. */
  repro: z.string().min(1).max(PARAGRAPH_VISIBLE_MAX),
  /** When that command ran, so a reader knows how stale the number is. */
  takenAtIso: z.iso.datetime(),
}) satisfies z.ZodType<FigureMeasurement>;

/** One figure asserted in one place, and the path a refusal points at. */
interface FigureSpan {
  readonly figure: string;
  readonly path: readonly (string | number)[];
}

/** A half-open character range of text that is masked out before figures are scanned. */
interface MaskedRange {
  readonly start: number;
  readonly end: number;
}

/**
 * What counts as a FIGURE: a thousands-separated run, a bare run of three or four digits, or a percentage
 * (which may carry a decimal, because `98.7%` is a proportion and the corpus is full of them).
 *
 * Ordered longest-form-first so a single left-to-right pass cannot let a later arm fire inside an earlier
 * one's match — the same trick `../linkify/bareRefs.ts`'s `GITHUB_HASH_REF` uses. Every quantifier is over a
 * fixed-width group, so this is linear and the `redos-check` gate has nothing to find.
 *
 * The percentage arm leads for that reason and the r2 review is why: with the thousands arm first, `1,200%`
 * reported `1,200`, so a composer copying their own text into `figures` tripped {@link
 * unusedMeasurementIssues} — the half with NO hatch — while the demand for `1,200` still stood.
 */
const FIGURE = /\d{1,3}(?:,\d{3})*(?:\.\d+)?%|\d{1,3}(?:,\d{3})+|\d{3,4}/g;

/**
 * Every shape that LOOKS like a figure and is not one, masked before {@link FIGURE} runs.
 *
 * Mask-then-scan rather than a pattern full of lookarounds: each entry states one exclusion a reader can
 * check against the measurement table in this file's header, and a variable-width lookbehind would state the
 * same thing unreadably.
 */
const MASKS: readonly RegExp[] = [
  /** An ISO date or datetime — the answer's own dating vocabulary, never a quantity. */
  /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g,
  /** A `HH:MM[:SS]` clock. */
  /\d{1,2}:\d{2}(?::\d{2})?/g,
  /**
   * A dotted version or decimal — `6.0`, `v4.5.1`, and the fractional tail of a masked timestamp.
   *
   * The `(?!%)` right boundary is load-bearing and was measured missing. Without it this mask swallows the
   * digits of `98.7%`, and since every figure span overlapping a mask is dropped, a decimal PERCENTAGE — a
   * proportion, which is the centre of this rule rather than its edge — owed nothing at all. MEASURED over
   * the same 180 answer forms as the table above: 31 mentions across 7 distinct values, `98.7%` fourteen
   * times. Reproduce with
   * `grep -ohE '[0-9]+\.[0-9]+%' $(find "$SLOPWEAVER_HOME/live/slack/reviews" -name 'answer-reviewed-*.json') | sort | uniq -c`.
   * A decimal with no percent sign (`1,208.5`, `$1,250.00`) stays masked: it measures ZERO in that corpus,
   * so keeping it would be the unmeasured widening this file's header argues against everywhere else.
   */
  /v?\d+\.\d+(?:\.\d+)?(?!%)/g,
  /** A bare year. `2026` is when, not how many. */
  /(?<!\d)(?:19|20)\d{2}(?!\d)/g,
  /**
   * A leading-zero run: a padded field or a fragment of one, never a measurement.
   *
   * The left boundary is load-bearing and BOTH characters in it were measured missing, in two rounds of the
   * same failure. Without `\d` this mask matches `08` inside `108`; without `,` it matches `049` inside
   * `7,049`, which is a thousands GROUP and the most common shape a real count takes. Either way every
   * figure overlapping the mask is dropped silently, and
   * `unit/outbound/assistant/measuredFigures.test.ts` holds a case for each.
   */
  /(?<![\d,])0\d+/g,
  /** A bare run of five or more digits — an identifier. See this file's header on the residue this buys. */
  /(?<!\d)\d{5,}/g,
  /**
   * A digit run welded to a preceding word or an unknown `ABC-123` key: `sha256`, `p90`, `claude-opus-5`.
   *
   * Only that DIRECTION. A digit run followed by letters is a quantity wearing its unit — `500ms`, `30d`,
   * `5x` — and masking those would drop exactly the measurements this rule exists to bind.
   */
  /[A-Za-z_]-?\d+/g,
];

/** Whether a match at `[start, end)` overlaps anything masked. */
function overlapsMask({ start, end, masked }: { start: number; end: number; masked: readonly MaskedRange[] }): boolean {
  return masked.some((range) => start < range.end && range.start < end);
}

/**
 * Every masked range in one string: the identifier spans `scanBareRefs` recognises, plus every {@link MASKS}
 * hit. Unsorted and possibly overlapping — {@link overlapsMask} only ever asks whether a point falls inside
 * one, so merging them would be work with no consumer.
 */
function maskedRangesOf({ text, context }: { text: string; context: BareRefContext }): readonly MaskedRange[] {
  const ranges: MaskedRange[] = scanBareRefs({ context, text }).map((span) => ({ end: span.end, start: span.start }));
  for (const mask of MASKS) {
    for (const match of text.matchAll(mask)) {
      ranges.push({ end: match.index + match[0].length, start: match.index });
    }
  }
  return ranges;
}

/** Every figure asserted in one string, in first-appearance order, repeats included. */
function figuresInText({ text, context }: { text: string; context: BareRefContext }): readonly string[] {
  const masked = maskedRangesOf({ context, text });
  const found: string[] = [];
  for (const match of text.matchAll(FIGURE)) {
    if (!overlapsMask({ end: match.index + match[0].length, masked, start: match.index })) {
      found.push(match[0]);
    }
  }
  return found;
}

/**
 * The TEXT-run text of one item — link labels and citation chips deliberately excluded.
 *
 * This is where it departs from `./citedAndShown.ts`'s `visibleTextOf`, which folds a link's LABEL in
 * because a control id wears one once the linkifier has run. A linked figure is the opposite case: it
 * already points at whatever produced it, so linking a number is the composer's natural second route out of
 * this rule and reading the label back would close it.
 */
function textRunTextOf({ runs }: { runs: readonly InlineRun[] }): string {
  // One `flatMap` rather than filter-then-map: after a `filter` the narrowing is gone by the time `map` runs,
  // so the second comparison reads as dead to a type-aware linter while still being the thing that types
  // `run.text`.
  return runs.flatMap((run) => (run.type === "text" ? [run.text] : [])).join(" ");
}

/**
 * Every figure the answer asserts, with the path each was asserted at.
 *
 * `lead` is scanned, which is the one place this rule reaches further than the bare-reference pass can. A
 * reference in the lead is residue by construction — `lead` is a plain string with nowhere to put a `link`
 * run — while a figure there is fixable, because its measurement lives in a separate array. It is also where
 * the headline number sits, so it is where a wrong one does the most damage. Measured over the same 180
 * answers: including `lead` moves none of the header's four columns, because every lead figure in them also
 * appears in the body. It costs nothing and closes an above-the-fold hole.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param lead the answer's lead line
 * @param context the same context the bare-reference pass used, so both agree on what an identifier is
 * @returns one entry per asserted figure, in reading order, repeats included
 */
export function figuresInAnswer({
  body,
  index,
  lead,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
  context: BareRefContext;
}): readonly FigureSpan[] {
  const items: readonly AnswerItem[] = answerItems({ body, index });
  const fromLead = figuresInText({ context, text: lead }).map((figure) => ({
    figure,
    path: ["lead"] as readonly (string | number)[],
  }));
  const fromItems = items.flatMap((item) =>
    figuresInText({ context, text: textRunTextOf({ runs: item.runs }) }).map((figure) => ({
      figure,
      path: item.path,
    })),
  );
  return [...fromLead, ...fromItems];
}

/** Every figure one measurement list covers, deduped. */
function coveredFigures({ measurements }: { measurements: readonly FigureMeasurement[] }): ReadonlySet<string> {
  return new Set(measurements.flatMap((measurement) => measurement.figures));
}

/**
 * Every figure the answer asserts with no measurement covering it.
 *
 * Reported once per DISTINCT figure rather than once per mention: the correction is one `measurements` entry
 * whichever row the number sits in, so five refusals for one uncovered number would be five copies of the
 * same instruction. The path named is the first place it appears.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param lead the answer's lead line
 * @param measurements the answer's measurement entries
 * @param context the same context the bare-reference pass used
 * @returns one issue per uncovered figure, in reading order
 */
export function unmeasuredFigureIssues({
  body,
  index,
  lead,
  measurements,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
  measurements: readonly FigureMeasurement[];
  context: BareRefContext;
}): readonly BareRefIssue[] {
  const covered = coveredFigures({ measurements });
  const seen = new Set<string>();
  const issues: BareRefIssue[] = [];
  for (const span of figuresInAnswer({ body, context, index, lead })) {
    if (covered.has(span.figure) || seen.has(span.figure)) {
      continue;
    }
    seen.add(span.figure);
    issues.push({
      message:
        `${JSON.stringify(span.figure)} is asserted here with nothing saying how it was measured — add a ` +
        `\`measurements\` entry whose \`figures\` includes ${JSON.stringify(span.figure)}, whose \`repro\` is ` +
        "the command that produces it again, and whose `takenAtIso` is when that command ran. One entry may " +
        "carry every figure ONE command produced. A figure written as a link to whatever produced it is not " +
        "checked at all.",
      path: span.path,
    });
  }
  return issues;
}

/**
 * Every figure covered more than once — across two entries, or twice inside one.
 *
 * The r2 review's counterexample, and the reason this exists at all: forty entries each naming the single
 * asserted figure `227` passed both halves, because {@link coveredFigures} is a flat union and
 * {@link unusedMeasurementIssues} only ever asks membership. So "the entry count is bounded by the number of
 * distinct COMMANDS" was a convention three canon surfaces asserted and nothing enforced — the shape this
 * repository refuses everywhere else. One figure has one repro; a second entry for it is a duplicate, and the
 * bound is now real: at most one covering position per distinct asserted figure.
 *
 * Hatchless for the same reason as {@link unusedMeasurementIssues} — the fix is always to delete a line.
 *
 * @param measurements the answer's measurement entries
 * @returns one issue per duplicate covering position, in `measurements` order
 */
export function duplicateMeasurementIssues({
  measurements,
}: {
  measurements: readonly FigureMeasurement[];
}): readonly BareRefIssue[] {
  const seen = new Set<string>();
  const issues: BareRefIssue[] = [];
  measurements.forEach((measurement, entry) => {
    measurement.figures.forEach((figure, position) => {
      if (!seen.has(figure)) {
        seen.add(figure);
        return;
      }
      issues.push({
        message:
          `${JSON.stringify(figure)} is already covered by an earlier \`measurements\` entry — one figure has ` +
          "one repro, and a second entry for it is what lets the list grow without bound while every other " +
          "check passes. Delete this position, or move the figure it really measures here.",
        path: ["measurements", entry, "figures", position],
      });
    });
  });
  return issues;
}

/**
 * Every measurement entry naming a figure the answer does not assert.
 *
 * A HARD refusal with no way past it, for the reason `./answerArm.ts`'s `answerDocumentsSchema` states
 * about its own extension list: a refusal whose fix is always "delete the entry" needs no escape hatch. It
 * is also what BOUNDS the array — no `.max()` is declared on `measurements`, deliberately, because a flat
 * ceiling on a per-figure obligation is exactly the mutually-exclusive pair `citationBudgetCollision`
 * measured. This and {@link duplicateMeasurementIssues} together are what make the array self-bounding — every
 * position must be used, and no figure twice, so the list cannot exceed the answer's own distinct figure
 * count, which the body's caps already bound. Neither alone does it: the r2 review shipped forty entries past
 * this one.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param lead the answer's lead line
 * @param measurements the answer's measurement entries
 * @param context the same context the bare-reference pass used
 * @returns one issue per unused figure name, in `measurements` order
 */
export function unusedMeasurementIssues({
  body,
  index,
  lead,
  measurements,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
  measurements: readonly FigureMeasurement[];
  context: BareRefContext;
}): readonly BareRefIssue[] {
  const asserted = new Set(figuresInAnswer({ body, context, index, lead }).map((span) => span.figure));
  return measurements.flatMap((measurement, entry) =>
    measurement.figures.flatMap((figure, position) =>
      asserted.has(figure)
        ? []
        : [
            {
              message:
                `${JSON.stringify(figure)} is measured here and asserted nowhere in the answer — an entry ` +
                "for a figure the reader never sees inflates the apparent working. Delete it, or write the " +
                "figure into the answer. A number this rule does not check at all (a bare run of five or " +
                "more digits, a year, a version, an id) never needs an entry.",
              path: ["measurements", entry, "figures", position],
            },
          ],
    ),
  );
}
