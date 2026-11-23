/**
 * Content-aware truncation for the outbound artifact/answer forms — computed so a caller CAN post truncated
 * content, but refused by default so it never happens silently or by accident.
 *
 * `contentLimits.ts` carries two different kinds of cap. A WIDTH cap bounds one authored string — a
 * paragraph, a bullet, a table cell, the tldr/lead, one index line — and truncating a violation would cut it
 * mid-sentence, which is exactly the "nonsense" outcome the owner's own framing warned against. Those stay a
 * hard refusal, unconditionally. A COUNT or AGGREGATE cap bounds how MUCH content there is — how many table
 * rows, how many bullet items, how much total detail prose, how much sits above the fold — and the fix that
 * never mangles a single string is to drop whole units from the TAIL, in authored order, and say so where
 * the reader can see it.
 *
 * ## Refuse by default; truncated send is a break-glass, not the normal path
 *
 * An earlier version of this module ran the drop unconditionally and posted the result, reasoning that a
 * drop which announces itself in the posted message is not silent. Measured against real sends, that
 * shipped exactly the "…" mid-digest truncation the owner's own wall-of-text doctrine exists to prevent —
 * seeing it land live changed the call. So `./schema.ts`'s and `../assistant/answerForm.ts`'s `.transform()`
 * callbacks now REFUSE whenever this module reports {@link truncateFormForCaps}'s `truncated: true}`, unless
 * this session holds a `truncated-send` grant (`./truncatedSendHatch.ts`) — a block-by-default-with-break-glass
 * shape. GitHub's Proof-cell word cap deliberately does NOT get the same treatment: a local override there could
 * pass and still fail CI (which reads its own environment), so that cap stays a hard refusal with `<details>` as
 * the only overflow route — see `../../prformat/checkCore.ts`. What stays refused UNCONDITIONALLY here,
 * with no escape hatch at all, is precisely the case that would be silent or would mangle content: one
 * over-width string, or a citation whose removal would orphan a `[n]` chip elsewhere in the card — dropping
 * a citation is not implemented here at all, deliberately, because the SAME chip-integrity check that
 * already exists (`checkCitationRefs`/`checkCitations`) would have to be re-run against a body whose
 * citations changed shape, which is a bigger content edit than "drop a whole row" and stays out of scope.
 */
import { buildDetailTruncationWarning, capDetailProse, sumDetailProse } from "./detailProseCap.js";
import { TRUNCATED_SEND_ESCAPE } from "./truncatedSendHatch.js";
import type { CitationWidth, DetailBlock, InlineRun } from "./types.js";
import { visibleLengthOfRuns } from "./visibleLength.js";

/**
 * A cap a form's content went over, with the measurement that went over it.
 *
 * The whole point of this record is that a refusal can state a NUMBER. Measured on the
 * real-world tagging dogfood, two of the first three real questions died at validate time on a cap, and the
 * refusal string of the day — "this is over the count/aggregate cap" — named no figure at all, so it was not
 * a usable correction: the worker recovered only by opening `../assistant/answerForm.ts` and grepping the
 * constant out of the source, mid-turn, in front of a public channel. `cap` carries the exported constant's
 * own name for exactly that reason — a composer who wants the reasoning behind the number can grep one word
 * — and `measured`/`limit` are what turn a refusal into a single edit.
 *
 * @internal — shaped by this module and consumed through {@link truncatedSendRefusalMessage}; the two form
 * schemas pass and read it structurally rather than importing the name.
 */
export interface CapOverage {
  /** The name of the `../assistant/contentLimits.ts` (or `./schema.ts`) constant this limit came from. */
  readonly cap: string;
  /** The cap's value. */
  readonly limit: number;
  /** What the authored content actually measured, in the same units. */
  readonly measured: number;
  /** The noun phrase `measured` and `limit` count, e.g. `"body blocks"`. */
  readonly what: string;
}

/**
 * A count/aggregate cap as {@link truncateFormForCaps} is given it: the number, plus the name of the
 * constant it came from.
 *
 * The name is supplied by the CALLER rather than looked up here on purpose. This module is handed bare
 * numbers and cannot know which constant produced one; a mapping kept here would be a second source of
 * truth about the caller's own imports, and would drift silently the first time a call site swapped a
 * constant. Written as one literal beside the number, a mismatch is visible on the line it happens.
 *
 * @internal — the two form schemas build one inline at the call site rather than importing the name.
 */
export interface CapSpec {
  /** The exported constant's name, verbatim — what a composer greps. */
  readonly cap: string;
  /** Its value. */
  readonly limit: number;
}

/** `overage` when `measured` is over `spec.limit`, nothing when it fits. */
function overageOf({ measured, spec, what }: { measured: number; spec: CapSpec; what: string }): readonly CapOverage[] {
  if (measured <= spec.limit) {
    return [];
  }
  return [{ cap: spec.cap, limit: spec.limit, measured, what }];
}

/** The largest `rows.length` across every table block, or 0 when there is no table. */
function longestTableRows({ detail }: { detail: readonly DetailBlock[] }): number {
  return detail.reduce((most, block) => (block.type === "table" ? Math.max(most, block.rows.length) : most), 0);
}

/** The largest `items.length` across every bullets/list block, or 0 when there is none. */
function longestListItems({ detail }: { detail: readonly DetailBlock[] }): number {
  return detail.reduce(
    (most, block) => (block.type === "bullets" || block.type === "list" ? Math.max(most, block.items.length) : most),
    0,
  );
}

/**
 * The refusal a schema's `.transform()` reports when content is over a count/aggregate cap and this session
 * holds no `truncated-send` grant — one string, shared by `./schema.ts` and `../assistant/answerForm.ts`, so
 * the two never drift into saying this differently.
 *
 * Every overage is named with its own measurement and limit. A refusal that says only "over the cap" tells a
 * composer nothing it can act on — see {@link CapOverage} for the measured failure that changed this.
 *
 * @param overages every cap the content went over, in the order the passes measure them
 * @returns the message, naming each measurement against its limit and both ways out
 */
export function truncatedSendRefusalMessage({ overages }: { overages: readonly CapOverage[] }): string {
  const measured =
    overages.length === 0
      ? "this is over a count/aggregate cap"
      : `over the outbound size caps — ${overages
          .map((o) => `${String(o.measured)} ${o.what} against the ${o.cap} limit of ${String(o.limit)}`)
          .join("; ")}`;
  return (
    `${measured}, and posting as-is would need to drop content — trim to the limits above, move detail into ` +
    `a collapsed section, or run ${TRUNCATED_SEND_ESCAPE} to post it truncated with a visible warning instead.`
  );
}

/**
 * The count cap a caller passed, floored at 1 — never zero, negative, or `NaN`. A table/bullets/list block
 * with no rows/items is not a smaller block, it is a shape `updateArtifactSchema`'s own `.min(1)` refuses
 * outright, so 1 is the true floor regardless of what an arbitrary caller supplies. `Number.isFinite` closes
 * `NaN` (which `Math.max(1, NaN)` alone does not: it stays `NaN`, and `[].slice(0, NaN)` returns `[]`).
 *
 * PRECONDITION this floor cannot itself supply: it assumes `rows`/`items` was already non-empty on entry.
 * Both real callers guarantee that structurally — `rows: z.array(…).min(1)` and `items: z.array(…).min(1)`
 * in `schema.ts` are enforced on the base object schema, which Zod validates BEFORE `.transform()` (and so
 * before `capTableRows`/`capBulletItems`) ever runs — so an already-empty block is unreachable through
 * either real schema's parse. An adversarial pass found that calling these exported functions DIRECTLY with
 * a hand-built, already-empty block bypasses that guarantee, and there is no fix for it inside this floor:
 * dropping content can only shrink a block, never manufacture the row/item `.min(1)` requires. Rejected as
 * out of scope rather than patched, because inventing placeholder content to satisfy a shape a real caller
 * cannot produce would be a worse defect than the one being chased.
 */
function effectiveCountFloor({ requested }: { requested: number }): number {
  return Number.isFinite(requested) ? Math.max(1, requested) : 1;
}

/**
 * Drop trailing rows off every table block past `maxRows` — never down to zero, see {@link effectiveCountFloor}.
 *
 * @param detail the ordered detail/body sub-blocks
 * @param maxRows the row-count cap ({@link "./contentLimits.js".TABLE_MAX_ROWS} / its answer-form re-export)
 * @returns the same blocks with any over-long table trimmed, and how many rows were dropped in total
 */
export function capTableRows({ detail, maxRows }: { detail: readonly DetailBlock[]; maxRows: number }): {
  detail: readonly DetailBlock[];
  rowsDropped: number;
} {
  const effectiveMax = effectiveCountFloor({ requested: maxRows });
  let rowsDropped = 0;
  const capped = detail.map((block) => {
    if (block.type !== "table" || block.rows.length <= effectiveMax) {
      return block;
    }
    rowsDropped += block.rows.length - effectiveMax;
    return { ...block, rows: block.rows.slice(0, effectiveMax) };
  });
  return { detail: capped, rowsDropped };
}

/**
 * Drop trailing items off every bullets/list block past `maxItems` — independent of total character count,
 * because a list of nine one-word items is still too many items to scan even though it is short. Never down
 * to zero, see {@link effectiveCountFloor}.
 *
 * @param detail the ordered detail/body sub-blocks
 * @param maxItems the per-block item-count cap ({@link "./contentLimits.js".BULLETS_MAX_ITEMS})
 * @returns the same blocks with any over-long bullets/list trimmed, and how many items were dropped in total
 */
export function capBulletItems({ detail, maxItems }: { detail: readonly DetailBlock[]; maxItems: number }): {
  detail: readonly DetailBlock[];
  itemsDropped: number;
} {
  const effectiveMax = effectiveCountFloor({ requested: maxItems });
  let itemsDropped = 0;
  const capped = detail.map((block) => {
    if ((block.type !== "bullets" && block.type !== "list") || block.items.length <= effectiveMax) {
      return block;
    }
    itemsDropped += block.items.length - effectiveMax;
    return { ...block, items: block.items.slice(0, effectiveMax) };
  });
  return { detail: capped, itemsDropped };
}

/**
 * Drop trailing above-the-fold index lines until the count, PLUS one slot reserved for the "+N more" line
 * this truncation will append, is within `maxItems`, and the whole region — `leadLength` plus the surviving
 * lines plus that exact warning line's own width — is within `maxAboveFold`. Checking the real warning's
 * width at each candidate stop, rather than reserving a fixed estimate up front, is what guarantees the
 * appended line can never itself push the region back over the cap it is reporting. `leadLength` alone is
 * already bounded by its own hard per-item cap elsewhere ({@link "./contentLimits.js".TLDR_VISIBLE_MAX}), so
 * this can always succeed down to an empty index. A no-op when the region already fits.
 *
 * @param index the ordered above-the-fold index lines
 * @param citations the artifact's citations, used to measure visible width
 * @param leadLength the visible width of the tldr/lead, which shares the same above-the-fold budget
 * @param maxItems the index line-count cap ({@link "./contentLimits.js".INDEX_MAX_ITEMS})
 * @param maxAboveFold the whole-region width cap ({@link "./contentLimits.js".ABOVE_FOLD_VISIBLE_MAX})
 * @returns the trimmed index, and how many lines were dropped
 */
export function capIndex({
  index,
  citations,
  leadLength,
  maxItems,
  maxAboveFold,
}: {
  index: readonly (readonly InlineRun[])[];
  citations: readonly CitationWidth[];
  leadLength: number;
  maxItems: number;
  maxAboveFold: number;
}): { index: readonly (readonly InlineRun[])[]; linesDropped: number } {
  const width = ({ lines }: { lines: readonly (readonly InlineRun[])[] }): number =>
    leadLength + lines.reduce((total, line) => total + visibleLengthOfRuns({ citations, runs: line }), 0);
  if (index.length <= maxItems && width({ lines: index }) <= maxAboveFold) {
    return { index, linesDropped: 0 };
  }
  const working = [...index];
  const fitsWithWarning = (): boolean => {
    if (working.length > maxItems - 1) {
      return false;
    }
    const linesDropped = index.length - working.length;
    const warningWidth = visibleLengthOfRuns({ citations: [], runs: buildIndexTruncationLine({ linesDropped }) });
    return width({ lines: working }) + warningWidth <= maxAboveFold;
  };
  while (!fitsWithWarning() && working.length > 0) {
    working.pop();
  }
  return { index: working, linesDropped: index.length - working.length };
}

/**
 * The synthetic above-the-fold line a truncated index carries, naming how many lines were dropped.
 *
 * @param linesDropped how many index lines were dropped
 * @returns a one-line run sequence reporting the drop
 */
export function buildIndexTruncationLine({ linesDropped }: { linesDropped: number }): readonly InlineRun[] {
  return [{ text: `⚠️ +${String(linesDropped)} more, truncated over the above-the-fold cap`, type: "text" }];
}

/**
 * Every count/aggregate cap the AUTHORED detail/body went over, in the order the passes measure them —
 * computed before any pass has dropped a thing, because the number a composer can act on is what it wrote.
 *
 * @param detail the ordered detail/body sub-blocks, as authored
 * @param citations the artifact's citations, used to measure visible width
 * @param field what this half is called on the caller's own form — `"body"` or `"detail"`
 * @returns the overages, empty when nothing was over cap
 */
function detailOverages({
  detail,
  citations,
  field,
  maxDetailBlocks,
  maxTableRows,
  maxBulletItems,
  maxProse,
}: {
  detail: readonly DetailBlock[];
  citations: readonly CitationWidth[];
  field: string;
  maxDetailBlocks?: CapSpec | undefined;
  maxTableRows: CapSpec;
  maxBulletItems: CapSpec;
  maxProse: CapSpec;
}): readonly CapOverage[] {
  return [
    ...(maxDetailBlocks === undefined
      ? []
      : overageOf({ measured: detail.length, spec: maxDetailBlocks, what: `${field} blocks` })),
    ...overageOf({
      measured: longestTableRows({ detail }),
      spec: maxTableRows,
      what: `rows in the longest ${field} table`,
    }),
    ...overageOf({
      measured: longestListItems({ detail }),
      spec: maxBulletItems,
      what: `items in the longest ${field} bullet list`,
    }),
    ...overageOf({
      measured: sumDetailProse({ citations, detail }),
      spec: maxProse,
      what: `visible characters of ${field} prose`,
    }),
  ];
}

/**
 * The `detail`/`body` half of {@link truncateFormForCaps}: block-count, row-count, item-count and prose caps,
 * in that order, with a warning appended once any of them actually dropped something.
 *
 * Overages are measured against the content as AUTHORED, before any pass has dropped anything — that is the
 * number the composer can act on. A later pass shrinking the content does not change what was written.
 *
 * @param detail the ordered detail/body sub-blocks
 * @param citations the artifact's citations, used to measure visible width
 * @param field what this half is called on the form the caller is parsing — `"body"` or `"detail"`
 * @param maxDetailBlocks the total block-count cap, when the form has one
 * @param maxTableRows the row-count cap per table
 * @param maxBulletItems the item-count cap per bullets/list block
 * @param maxProse the aggregate prose cap
 * @returns the truncated `detail` (with its warning block appended when truncation occurred), whether
 *   anything was actually dropped, and every cap the authored content went over
 */
function truncateDetailForCaps({
  detail,
  citations,
  field,
  maxDetailBlocks,
  maxTableRows,
  maxBulletItems,
  maxProse,
}: {
  detail: readonly DetailBlock[];
  citations: readonly CitationWidth[];
  field: string;
  maxDetailBlocks?: CapSpec | undefined;
  maxTableRows: CapSpec;
  maxBulletItems: CapSpec;
  maxProse: CapSpec;
}): { detail: readonly DetailBlock[]; overages: readonly CapOverage[]; truncated: boolean } {
  const overages = detailOverages({
    citations,
    detail,
    field,
    maxBulletItems,
    maxDetailBlocks,
    maxProse,
    maxTableRows,
  });
  let working = detail;
  let blocksDropped = 0;
  if (maxDetailBlocks !== undefined && working.length > maxDetailBlocks.limit) {
    blocksDropped += working.length - maxDetailBlocks.limit;
    working = working.slice(0, maxDetailBlocks.limit);
  }

  const rowStep = capTableRows({ detail: working, maxRows: maxTableRows.limit });
  const itemStep = capBulletItems({ detail: rowStep.detail, maxItems: maxBulletItems.limit });
  const proseStep = capDetailProse({
    baseBlocksDropped: blocksDropped,
    baseItemsDropped: itemStep.itemsDropped,
    citations,
    detail: itemStep.detail,
    maxProse: maxProse.limit,
    rowsDropped: rowStep.rowsDropped,
  });
  blocksDropped += proseStep.blocksDropped;
  const itemsDropped = itemStep.itemsDropped + proseStep.itemsDropped;
  const rowsDropped = rowStep.rowsDropped;
  const truncated = blocksDropped > 0 || itemsDropped > 0 || rowsDropped > 0;

  return {
    detail: truncated
      ? [
          ...proseStep.detail,
          buildDetailTruncationWarning({ blocksDropped, cap: maxProse.limit, itemsDropped, rowsDropped }),
        ]
      : proseStep.detail,
    overages,
    truncated,
  };
}

/**
 * The `index` half of {@link truncateFormForCaps}: count and above-the-fold-width caps, with a "+N more" line
 * appended once truncation actually dropped something.
 *
 * @param index the ordered above-the-fold index lines
 * @param citations the artifact's citations, used to measure visible width
 * @param leadLength the visible width of the tldr/lead
 * @param maxIndexItems the index line-count cap
 * @param maxAboveFold the whole above-the-fold region width cap
 * @returns the truncated `index` (with its warning line appended when truncation occurred), whether anything
 *   was actually dropped, and every cap the authored index went over
 */
function truncateIndexForCaps({
  index,
  citations,
  leadLength,
  maxIndexItems,
  maxAboveFold,
}: {
  index: readonly (readonly InlineRun[])[];
  citations: readonly CitationWidth[];
  leadLength: number;
  maxIndexItems: CapSpec;
  maxAboveFold: CapSpec;
}): { index: readonly (readonly InlineRun[])[]; overages: readonly CapOverage[]; truncated: boolean } {
  const aboveFold =
    leadLength + index.reduce((total, line) => total + visibleLengthOfRuns({ citations, runs: line }), 0);
  const overages: readonly CapOverage[] = [
    ...overageOf({ measured: index.length, spec: maxIndexItems, what: "index lines" }),
    ...overageOf({
      measured: aboveFold,
      spec: maxAboveFold,
      what: "visible characters above the fold (lead + index)",
    }),
  ];
  const indexStep = capIndex({
    citations,
    index,
    leadLength,
    maxAboveFold: maxAboveFold.limit,
    maxItems: maxIndexItems.limit,
  });
  const truncated = indexStep.linesDropped > 0;
  return {
    index: truncated
      ? [...indexStep.index, buildIndexTruncationLine({ linesDropped: indexStep.linesDropped })]
      : indexStep.index,
    overages,
    truncated,
  };
}

/**
 * The one entry point either form schema calls: truncate a card/answer's `detail`/`body` and `index` down to
 * every count and aggregate cap, appending a warning wherever it actually dropped something. A no-op when
 * nothing was over cap — the returned blocks/lines are the same content, unchanged.
 *
 * Each cap arrives as a {@link CapSpec} rather than a bare number so the refusal this feeds can name the
 * constant a composer should grep as well as the figure it broke — see {@link CapOverage}.
 *
 * @param detail the ordered detail/body sub-blocks
 * @param index the ordered above-the-fold index lines
 * @param citations the artifact's citations, used to measure visible width
 * @param field what the detail half is called on the caller's own form — `"body"` or `"detail"`
 * @param leadLength the visible width of the tldr/lead
 * @param maxDetailBlocks the total block-count cap, when the form has one (the answer arm's `BODY_MAX_BLOCKS`; absent for `updateArtifactSchema`, which has none)
 * @param maxTableRows the row-count cap per table
 * @param maxBulletItems the item-count cap per bullets/list block
 * @param maxProse the aggregate prose cap
 * @param maxIndexItems the index line-count cap
 * @param maxAboveFold the whole above-the-fold region width cap
 * @returns the truncated `detail` and `index` (each with its own warning appended when truncation occurred),
 *   `truncated` — true if EITHER half actually dropped anything, which the caller reads to decide whether to
 *   refuse this content rather than post it truncated — and `overages`, every cap the AUTHORED content went
 *   over, which is what {@link truncatedSendRefusalMessage} turns into a correctable refusal. See this
 *   module's own doc for why the default flipped to refusing.
 */
export function truncateFormForCaps({
  detail,
  index,
  citations,
  field,
  leadLength,
  maxDetailBlocks,
  maxTableRows,
  maxBulletItems,
  maxProse,
  maxIndexItems,
  maxAboveFold,
}: {
  detail: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly CitationWidth[];
  field: string;
  leadLength: number;
  maxDetailBlocks?: CapSpec | undefined;
  maxTableRows: CapSpec;
  maxBulletItems: CapSpec;
  maxProse: CapSpec;
  maxIndexItems: CapSpec;
  maxAboveFold: CapSpec;
}): {
  detail: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  overages: readonly CapOverage[];
  truncated: boolean;
} {
  const detailStep = truncateDetailForCaps({
    citations,
    detail,
    field,
    maxBulletItems,
    maxDetailBlocks,
    maxProse,
    maxTableRows,
  });
  const indexStep = truncateIndexForCaps({ citations, index, leadLength, maxAboveFold, maxIndexItems });
  return {
    detail: detailStep.detail,
    index: indexStep.index,
    overages: [...detailStep.overages, ...indexStep.overages],
    truncated: detailStep.truncated || indexStep.truncated,
  };
}
