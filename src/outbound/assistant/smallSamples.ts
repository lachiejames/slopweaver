/**
 * The fifth show-your-work rule: a figure computed over a SMALL sample carries its `n` in the same sentence.
 *
 * ## The class, and the ruling
 *
 * Class C on the owner's `reviewer-catches-structurally-impossible` page: "a small sample read as a trend".
 * A reviewer repeatedly objected to a latency median because its sample was small, never because its
 * direction was wrong. The page offered three placements for the qualifier — inline in the sentence, down in
 * the fold, or leave it to review — and the owner took the inline one: it is the
 * only placement a reader who never expands still sees. So the rule is SAME SENTENCE, which is also why it
 * needs no notion of where the fold falls. A figure above the fold carries its qualifier above the fold,
 * and one below it carries its qualifier where it stands.
 *
 * ## Why `n < 50`
 *
 * MEASURED on that thread's verdicts. In the reproduced verdict evidence, every stable cell was above the
 * chosen boundary and every drifting cell below it; 50 is the separating integer selected from that observed
 * gap. Reproduce with:
 *
 * ```
 * jq -r '.claims[] | select(.text | test("slowest-operations")) | .evidence' \
 *   "$SLOPWEAVER_HOME/live/slack/reviews/C0SYN000015-1788757965.613679/"verdict-superseded-F4E08889-*.json
 * ```
 *
 * One thread is one data point. The threshold is a constant so the next measurement moves one number.
 *
 * ## Why a DECLARED sample, and not a scan of the prose
 *
 * `./measuredFigures.ts` finds its figures by scanning. That does not work here, for two reasons. First, its
 * criterion masks a decimal with no percent sign, and `12.4s` and `11.6s` are exactly that shape. Second, the
 * sample size of a number is not in the answer's bytes at all. The composer knows it, from the query that
 * produced the number, so `answerArmSchema.samples` is where the composer says it: `{ figure, n }`, with the
 * figure spelled exactly as the answer writes it.
 *
 * ## No hatch, on any leg
 *
 * Every refusal here has a fix that is always available: write `n=6` into that sentence, or delete an entry.
 * `./answerArm.ts`'s `answerDocumentsSchema` states the principle: a refusal whose fix is always available
 * needs no escape hatch. The two bounding legs are there for the reason `./measuredFigures.ts` gives for its
 * own. Every entry has to be used and no figure may appear twice, so the list cannot outgrow the answer.
 *
 * ## Residues, stated rather than left to be discovered
 *
 * **An undeclared sample is unchecked.** The form cannot know the n of a number it was not told about.
 * Inferring one from the prose was measured and rejected: 48 of 227 reviewed answer forms carry a sample
 * statistic word (p50, p95, median, mean, average), almost none carry an n, and many of them are metric
 * rollups with no n to state. Demanding one there would be a much broader rule than the one the owner ruled on.
 * Reproduce the 48 by running `jq` over every
 * `find "$SLOPWEAVER_HOME/live/slack/reviews" -name 'answer-reviewed-*.json'`, grepping the lead, index and
 * body text for `\b(p50|p75|p90|p95|p99|median|mean|average|avg)\b`.
 *
 * **The sentence split is punctuation.** The common abbreviations in {@link SENTENCE_BREAK} do not end a
 * sentence. The r1 review's counterexample was of the shape `12.4s vs. 3.2s (n=6)`, one sentence to any reader. An
 * abbreviation outside that list still ends one early. That errs the safe way: the n is demanded within a
 * shorter span, never a longer one.
 */
import { z } from "zod";

import type { DetailBlock, InlineRun } from "../artifact/types.js";
import type { BareRefIssue } from "../linkify/bareRefs.js";
import { strictForm } from "../strictForm.js";

import { type AnswerItem, answerItems } from "./citedAndShown.js";
import { EVIDENCE_LABEL_VISIBLE_MAX } from "./contentLimits.js";

/**
 * A sample of FEWER than this many observations owes its `n` inline. Measured — see this file's header.
 *
 * @internal — exported so the tests and the refusal text read the one number.
 */
export const SMALL_SAMPLE_THRESHOLD = 50;

/**
 * One declared sample: a figure as the answer writes it, and how many observations it was computed over.
 *
 * The shape {@link sampleSchema} parses, declared beside the checks so the two cannot drift.
 */
export interface FigureSample {
  readonly figure: string;
  readonly n: number;
}

/**
 * One `samples` entry as `./answerArm.ts`'s `answerArmSchema` parses it. Not rendered: the n a reader needs
 * is the one written into the sentence itself.
 */
export const sampleSchema = strictForm({
  /** The figure, spelled EXACTLY as the answer writes it — `12.4s`, `11.6s`. */
  figure: z.string().min(1).max(EVIDENCE_LABEL_VISIBLE_MAX),
  /** How many observations produced it. */
  n: z.number().int().min(1),
}) satisfies z.ZodType<FigureSample>;

/**
 * The small-sample rule's three legs as `./answerForm.ts`'s refusal lines, in reading order: a small-sample
 * figure whose sentence does not state its n, a declared figure the answer never asserts, and a figure
 * declared twice.
 *
 * None reads a hatch. The fix for each is always available — write `n=<n>` into that sentence, or delete an
 * entry — so an override would only ever let an unqualified number or an unbounded list through.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param samples the answer's declared samples, absent when it declares none
 * @returns one operator-facing refusal per violation
 */
export function smallSampleRefusals({
  body,
  index,
  lead,
  samples = [],
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
  samples?: readonly FigureSample[] | undefined;
}): readonly string[] {
  const parts = { body, index, lead, samples };
  return [...smallSampleIssues(parts), ...unusedSampleIssues(parts), ...duplicateSampleIssues(parts)].map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
}

/** One reader-visible sentence, and the field path a refusal points at. */
interface PlacedSentence {
  readonly path: readonly (string | number)[];
  readonly text: string;
}

/**
 * The reader-VISIBLE text of one item: text runs and link labels.
 *
 * Unlike `./measuredFigures.ts`'s `textRunTextOf`, a link label counts here. That rule exempts a linked
 * figure because the link points at what produced it. Here the question is what the reader SEES beside the
 * number, and a figure worn as a link label is seen with no n beside it all the same.
 */
function visibleTextOf({ runs }: { runs: readonly InlineRun[] }): string {
  return runs
    .flatMap((run) => {
      if (run.type === "text") {
        return [run.text];
      }
      if (run.type === "link") {
        return [run.label];
      }
      return [];
    })
    .join(" ");
}

/**
 * Where one sentence ends: `.`, `!` or `?` followed by whitespace, unless the full stop closes a common
 * abbreviation, and every line break.
 */
const SENTENCE_BREAK = /(?<=[.!?])(?<!\b(?:vs|e\.g|i\.e|etc|approx|cf|ca)\.)\s+|\n+/i;

/** Split prose into sentences at {@link SENTENCE_BREAK}. */
function sentencesOf({ text }: { text: string }): readonly string[] {
  return text.split(SENTENCE_BREAK).filter((sentence) => sentence.trim().length > 0);
}

/** Every sentence of the lead, the index and the body, in reading order, each with its field path. */
function sentencesInAnswer({
  body,
  index,
  lead,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
}): readonly PlacedSentence[] {
  const fromLead = sentencesOf({ text: lead }).map((text) => ({
    path: ["lead"] as readonly (string | number)[],
    text,
  }));
  const fromItems = answerItems({ body, index }).flatMap((item) =>
    itemSentences({ body, item }).map((text) => ({ path: item.path, text })),
  );
  return [...fromLead, ...fromItems];
}

/** Whether a table column header names the sample size: `n`, in any case, with surrounding space ignored. */
function isNColumn({ header }: { header: string }): boolean {
  return header.trim().toLowerCase() === "n";
}

/**
 * The sentences of one item, where a table ROW is always exactly one, with its `n` column spelled as the
 * qualifier it is.
 *
 * A row is one unit, never split at a full stop inside one of its cells, and its cells are read with the
 * table's headers. A cell under a column headed `n`
 * reads as `n=<cell>`, because that is what a reader sees: the number sits in the column the header names.
 * The r1 review found that the plain walk refused this layout, which is the most natural one for a table
 * of per-operation medians. The walk stays `./citedAndShown.ts`'s `answerItems`, so what an item IS stays
 * one definition. Only how a table row's text is READ changes here, and it looks the row up by the item's
 * own path.
 */
function itemSentences({ body, item }: { body: readonly DetailBlock[]; item: AnswerItem }): readonly string[] {
  const [field, blockIndex, rowsKey, rowIndex] = item.path;
  const isTableRow = field === "body" && typeof blockIndex === "number" && rowsKey === "rows";
  const block = isTableRow ? body[blockIndex] : undefined;
  if (block?.type !== "table" || typeof rowIndex !== "number") {
    return sentencesOf({ text: visibleTextOf({ runs: item.runs }) });
  }
  const row = block.rows[rowIndex]!;
  const text = row
    .map((cell, column) => {
      const cellText = visibleTextOf({ runs: cell });
      const header = block.columns[column];
      return header !== undefined && isNColumn({ header }) ? `n=${cellText.trim()}` : cellText;
    })
    .join(" ");
  return [text];
}

/**
 * Whether a sentence asserts a figure as a whole token, not as part of a longer number or word.
 *
 * Bounded on both sides, so `12.4s` is not found inside `112.4s` and `12` is not found inside `12%` or `1,012`.
 */
function assertsFigure({ sentence, figure }: { sentence: string; figure: string }): boolean {
  let from = sentence.indexOf(figure);
  while (from !== -1) {
    const before = sentence.charAt(from - 1);
    const after = sentence.charAt(from + figure.length);
    if (!/[\w.,]/.test(before) && !/[\w%]/.test(after)) {
      return true;
    }
    from = sentence.indexOf(figure, from + 1);
  }
  return false;
}

/** An `n=<digits>` qualifier, either case, spaces around the `=` allowed, not welded to a word on its left. */
const N_QUALIFIER = /(?<!\w)n\s*=\s*(\d+)(?![\d,.]\d)/gi;

/** Whether a sentence states `n=<n>` for exactly this n. */
function statesN({ sentence, n }: { sentence: string; n: number }): boolean {
  return [...sentence.matchAll(N_QUALIFIER)].some((match) => Number(match[1]) === n);
}

/**
 * Every sentence asserting a small-sample figure without its `n`.
 *
 * One refusal per figure per item rather than per sentence, because the path is what a composer fixes by,
 * and two sentences in one bullet are one edit. A sample at or above {@link SMALL_SAMPLE_THRESHOLD} owes
 * nothing inline, and declaring it is harmless.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param lead the answer's lead line
 * @param samples the answer's declared samples
 * @returns one issue per small-sample figure per item that states it without its n, in reading order
 */
export function smallSampleIssues({
  body,
  index,
  lead,
  samples,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
  samples: readonly FigureSample[];
}): readonly BareRefIssue[] {
  const small = samples.filter((sample) => sample.n < SMALL_SAMPLE_THRESHOLD);
  const reported = new Set<string>();
  const issues: BareRefIssue[] = [];
  for (const sentence of sentencesInAnswer({ body, index, lead })) {
    for (const sample of small) {
      const key = `${sample.figure}\u0000${sentence.path.join(".")}`;
      if (
        reported.has(key) ||
        !assertsFigure({ figure: sample.figure, sentence: sentence.text }) ||
        statesN({ n: sample.n, sentence: sentence.text })
      ) {
        continue;
      }
      reported.add(key);
      issues.push({
        message:
          `${JSON.stringify(sample.figure)} was computed over n=${sample.n}, under the small-sample threshold ` +
          `of ${SMALL_SAMPLE_THRESHOLD}, and the sentence stating it does not say so: ` +
          `${JSON.stringify(sentence.text)}. Write \`n=${sample.n}\` into that same sentence, so a reader who ` +
          "never expands the fold still sees how few observations the number stands on.",
        path: sentence.path,
      });
    }
  }
  return issues;
}

/**
 * Every declared sample whose figure the answer never asserts.
 *
 * Hatchless, and it is half of what bounds the array: see this file's header.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param lead the answer's lead line
 * @param samples the answer's declared samples
 * @returns one issue per unused entry, in `samples` order
 */
export function unusedSampleIssues({
  body,
  index,
  lead,
  samples,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  lead: string;
  samples: readonly FigureSample[];
}): readonly BareRefIssue[] {
  const sentences = sentencesInAnswer({ body, index, lead });
  return samples.flatMap((sample, entry) =>
    sentences.some((sentence) => assertsFigure({ figure: sample.figure, sentence: sentence.text }))
      ? []
      : [
          {
            message:
              `${JSON.stringify(sample.figure)} is declared as a sample and asserted nowhere in the lead, the ` +
              "index or the body. Spell the figure exactly as the answer writes it, or delete the entry.",
            path: ["samples", entry, "figure"],
          },
        ],
  );
}

/**
 * Every figure declared as a sample more than once. One figure has one n.
 *
 * Hatchless, and the other half of what bounds the array: see this file's header.
 *
 * @param samples the answer's declared samples
 * @returns one issue per repeated entry, in `samples` order
 */
export function duplicateSampleIssues({ samples }: { samples: readonly FigureSample[] }): readonly BareRefIssue[] {
  const seen = new Set<string>();
  const issues: BareRefIssue[] = [];
  samples.forEach((sample, entry) => {
    if (!seen.has(sample.figure)) {
      seen.add(sample.figure);
      return;
    }
    issues.push({
      message:
        `${JSON.stringify(sample.figure)} is already declared by an earlier \`samples\` entry. One figure has ` +
        "one n: delete this entry.",
      path: ["samples", entry, "figure"],
    });
  });
  return issues;
}
