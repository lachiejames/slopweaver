/**
 * COMPUTED correction marks: where a republished page differs from the version the owner already read.
 *
 * The owner reacts to a briefing, is then asked to react to the corrected one, and finds it very difficult to
 * tell where the corrections are across multiple rounds of reacting. Every ruling stamps a corrected page, so this is the common case rather than an
 * edge one.
 *
 * ## The marks are COMPUTED, and that is the whole mechanism
 *
 * The first attempt at this was hand-authored: a published page carried `chosen` / `not taken` / `answered` tags
 * its author typed, and the publisher checked them by diffing the file against the published bytes. They
 * matched — but the check lived in the seat, not on the page. Had the author forgotten an edit the page
 * would have claimed three marked places while carrying four, and nothing on the page could have said so.
 * So the marks here come out of the diff between the previously published bytes and the new ones, never out
 * of a list somebody remembered. Same family as `./stamp.ts`'s instants and
 * `../../briefing/openArtifacts.ts`'s validity marks: a claim a composer can type is a claim that can be
 * wrong while reading right.
 *
 * ## Both shapes, because the owner asked for a decision between them and the answer is both
 *
 * The row named three candidate shapes — a mark per section, a folded diff, or both, never a second page.
 * A mark alone makes the owner scroll a 190 KB page hunting for highlights; a list alone makes the owner hold
 * positions in their head. So the page carries a per-spot mark AND a strip naming each marked spot as a jump link, and
 * there is exactly one page either way.
 *
 * ## The strip is chrome, and what that does and does not cost
 *
 * It sits beside the eyebrow and is a `<div>` of `<span>`s rather than paragraphs, so
 * `../../briefing/pageBudget.ts`'s unfolded-BLOCK count does not move — that count is over `div.need` opens
 * and the strip is not one. Its WORDS do count, exactly as the eyebrow's do, and that is right rather than a
 * leak: the owner reads them, so they are above the fold. What keeps that honest is a cap of this file's own
 * ({@link STRIP_MAX_JUMPS}). MEASURED on a consecutive briefing pair, reproduce with
 * `slopweaver briefing corrections --previous <a> --page <b> --out <c> && slopweaver briefing check <c>`:
 * a full stamp took the above-fold region from 148 words to 214, against a 1,000-word budget, and that 66
 * is the WORST case because the jump list stops at six however many spots moved.
 *
 * The budget is not what makes the strip trustworthy, though. That is the gate half in
 * `../../briefing/corrections.ts`, which refuses a strip whose own claims do not add up.
 *
 * ## Stamping is idempotent, which is a correctness requirement rather than a nicety
 *
 * Round three compares against a round-two page that is already marked. Left in, last round's marks and
 * strip would read as this round's changes and every spot would look touched. So {@link stripCorrections}
 * runs over BOTH sides before anything is compared, and over the new page again before it is re-stamped.
 *
 * Pure: bytes in, bytes out. No I/O, no clock. The edge in `../../cli/commands/briefing/correctionsRun.ts`
 * reads the two files and resolves the previously published bytes from the freeze store.
 */
import { diffArrays } from "diff";

import { sha256Text } from "../../lib/hash.js";
import { withoutPageReviewFold } from "../../pages/reviewFold.js";
import { withCorrectionChrome } from "./correctionsChrome.js";
import {
  AGAINST_ATTRIBUTE,
  CORRECTION_ATTRIBUTE,
  INSIDE_ATTRIBUTE,
  MARKED_ATTRIBUTE,
  MINTED_ANCHOR_FLAG,
  MINTED_ANCHOR_PREFIX,
  stripCorrections,
} from "./correctionsStrip.js";
import { declaredIds } from "./htmlTokens.js";
import { escapeAttribute, escapeText } from "./render.js";
import { enclosingFolds, type PageSpot, pageSpots } from "./spots.js";

/**
 * What happened to one spot between the version the owner read and this one.
 *
 * @internal — the vocabulary the compare and the stamp share; no caller outside this pair names it.
 */
export type SpotMark = "changed" | "new" | "gone" | "unchanged";

/**
 * One spot's verdict.
 *
 * @internal — the row shape {@link pageCorrections} returns; the CLI edge passes it straight through.
 */
export interface SpotCorrection {
  readonly mark: SpotMark;
  readonly label: string;
  /** Index into the NEW page's spots. Absent for a `gone` spot — it is not on this page to point at. */
  readonly spotIndex: number | undefined;
}

/** What comparing a republished page against the version the owner read found. */
export interface PageCorrections {
  readonly corrections: readonly SpotCorrection[];
  /** How many spots carry a visible mark: everything `changed` or `new`. */
  readonly marked: number;
  readonly changed: number;
  readonly added: number;
  readonly gone: number;
  readonly spotsCompared: number;
  /** `sha256:<hex>` of the previously published bytes, corrections stripped — which version this compared. */
  readonly against: string;
}

/**
 * How many marked spots the strip names as jump links before it says "and N more".
 *
 * Rule 7 in one number. A page where forty spots moved is a rewrite, and a strip listing forty links is the
 * wall this whole surface refuses — every mark is still on the page, so nothing is hidden by stopping the
 * list.
 */
export const STRIP_MAX_JUMPS = 6;

/**
 * The key a spot is matched on across the two versions: its own `id` where it has one, its text where it
 * does not.
 *
 * An id survives a total rewrite of the text under it, so a card whose every field changed is still the same
 * card. A spot with no id has nothing stable to be, so its text IS its identity and a rewrite reads as one
 * spot leaving and another arriving in the same place — which the pairing below reads back as a change.
 */
function matchKey({ spot }: { spot: PageSpot }): string {
  return spot.id === undefined ? `text:${spot.kind}:${spot.text}` : `id:${spot.id}`;
}

/**
 * A removed run and an added run standing at the same point, read back as edits rather than as churn.
 *
 * An LCS reports an edited spot as one removal and one addition. A reader needs to be told "this moved", so
 * the two runs are paired index-wise: every pair is a change, and whichever side is longer contributes its
 * surplus as arrivals or departures.
 */
function pairRuns({
  removed,
  added,
  addedBase,
}: {
  removed: readonly PageSpot[];
  added: readonly PageSpot[];
  addedBase: number;
}): readonly SpotCorrection[] {
  const paired = Math.min(removed.length, added.length);
  const out: SpotCorrection[] = [];
  added.forEach((spot, offset) => {
    out.push({ label: spot.label, mark: offset < paired ? "changed" : "new", spotIndex: addedBase + offset });
  });
  for (const spot of removed.slice(paired)) {
    out.push({ label: spot.label, mark: "gone", spotIndex: undefined });
  }
  return out;
}

/**
 * A run the LCS called common, re-judged on TEXT.
 *
 * A common run means the keys matched, and an id key says nothing about what sits under it. So a card whose
 * id held while its every field was rewritten arrives here, and reporting it unchanged would be the whole
 * defect. A text key can only match identical text, so those come back unchanged by construction.
 */
function unchangedRun({
  previous,
  next,
  nextBase,
}: {
  previous: readonly PageSpot[];
  next: readonly PageSpot[];
  nextBase: number;
}): readonly SpotCorrection[] {
  return next.map((spot, offset) => {
    const was = previous[offset];
    const moved = was !== undefined && was.text !== spot.text;
    return { label: spot.label, mark: moved ? "changed" : "unchanged", spotIndex: nextBase + offset } as const;
  });
}

/**
 * Compare a republished page against the version the owner already read, spot by spot.
 *
 * The alignment is a longest-common-subsequence over the match keys, from the pinned `diff` package rather
 * than hand-rolled — the same reason `../../lib/textDiff.ts` gives.
 *
 * @param previous the previously published bytes, stamped or not
 * @param next the new page, stamped or not
 * @returns every spot's verdict in document order, the four counts, and which version this compared against
 */
export function pageCorrections({ previous, next }: { previous: string; next: string }): PageCorrections {
  // A page's review fold is the verb's account of its review, never the author's prose: a new review on a
  // republished page is not a changed passage. It is the last thing in the body, so stripping it here leaves every
  // spot index `stampCorrections` reads from the unstripped page unchanged.
  const before = stripCorrections({ html: withoutPageReviewFold({ html: previous }) });
  const after = stripCorrections({ html: withoutPageReviewFold({ html: next }) });
  const previousSpots = pageSpots({ html: before });
  const nextSpots = pageSpots({ html: after });
  const parts = diffArrays(
    previousSpots.map((spot) => matchKey({ spot })),
    nextSpots.map((spot) => matchKey({ spot })),
  );
  const corrections: SpotCorrection[] = [];
  let previousIndex = 0;
  let nextIndex = 0;
  let pendingRemoved: readonly PageSpot[] = [];
  for (const part of parts) {
    // `count` is always the run length for an array diff; reading `value.length` keeps that a fact of the
    // data rather than of the library's optional field.
    const count = part.value.length;
    if (part.removed === true) {
      pendingRemoved = previousSpots.slice(previousIndex, previousIndex + count);
      previousIndex += count;
      continue;
    }
    const taken = nextSpots.slice(nextIndex, nextIndex + count);
    if (part.added === true) {
      corrections.push(...pairRuns({ added: taken, addedBase: nextIndex, removed: pendingRemoved }));
    } else {
      corrections.push(...pairRuns({ added: [], addedBase: nextIndex, removed: pendingRemoved }));
      corrections.push(
        ...unchangedRun({
          next: taken,
          nextBase: nextIndex,
          previous: previousSpots.slice(previousIndex, previousIndex + count),
        }),
      );
      previousIndex += count;
    }
    nextIndex += count;
    pendingRemoved = [];
  }
  corrections.push(...pairRuns({ added: [], addedBase: nextIndex, removed: pendingRemoved }));
  return summarise({ against: sha256Text({ text: before }), corrections, spotsCompared: nextSpots.length });
}

/** The counts a strip states, derived from the rows rather than tracked alongside them. */
function summarise({
  against,
  corrections,
  spotsCompared,
}: {
  against: string;
  corrections: readonly SpotCorrection[];
  spotsCompared: number;
}): PageCorrections {
  const count = ({ mark }: { mark: SpotMark }): number => corrections.filter((row) => row.mark === mark).length;
  const changed = count({ mark: "changed" });
  const added = count({ mark: "new" });
  return {
    added,
    against,
    changed,
    corrections,
    gone: count({ mark: "gone" }),
    marked: changed + added,
    spotsCompared,
  };
}

/**
 * The anchor each MARKED spot is reachable at: its own id, or one minted free of every id on the page.
 *
 * Computed once and shared by the splice and the jump list, because the two have to agree on every value —
 * they are a link and its target. And minted against what the page already carries, because
 * `${MINTED_ANCHOR_PREFIX}` is a readable prefix rather than a reservation: a page authoring `id="corr-1"`
 * of its own would otherwise be given a second element with that id, and the jump would land on whichever
 * came first rather than on the spot that moved.
 */
function plannedAnchors({
  corrections,
  html,
  spots,
}: {
  corrections: readonly SpotCorrection[];
  html: string;
  spots: readonly PageSpot[];
}): ReadonlyMap<number, string> {
  // Read off the scan rather than by pattern: under-counting hands out an id the page already uses.
  // Copied rather than read through, because each id minted below joins it and the next mint must see it.
  const taken = new Set(declaredIds({ html }));
  const anchors = new Map<number, string>();
  for (const row of corrections) {
    const spotIndex = row.spotIndex;
    if (spotIndex === undefined || row.mark === "unchanged" || row.mark === "gone") {
      continue;
    }
    const spot = spots[spotIndex];
    if (spot === undefined) {
      continue;
    }
    if (spot.id !== undefined) {
      anchors.set(spotIndex, spot.id);
      continue;
    }
    let minted = `${MINTED_ANCHOR_PREFIX}${String(spotIndex)}`;
    let suffix = 2;
    while (taken.has(minted)) {
      minted = `${MINTED_ANCHOR_PREFIX}${String(spotIndex)}-${String(suffix)}`;
      suffix += 1;
    }
    taken.add(minted);
    anchors.set(spotIndex, minted);
  }
  return anchors;
}

/** One spot's opening tag with `attributes` spliced into it, just before the `>` that closes the tag. */
function spliceIntoOpeningTag({
  attributes,
  html,
  spot,
}: {
  attributes: string;
  html: string;
  spot: PageSpot;
}): string {
  // Splicing before `openEnd`'s `>` keeps a self-closing form intact and never touches what the element
  // already declares.
  const insertAt = spot.openEnd - 1;
  return html.slice(0, insertAt) + attributes + html.slice(insertAt);
}

/**
 * Count one marked spot into each fold enclosing it, as that spot is reached. The first marked spot inside a fold
 * starts its count at one and every later one adds to it, so a fold enclosing no marked spot is never counted.
 */
function countInside({ folds, insideCounts }: { folds: readonly number[]; insideCounts: Map<number, number> }): void {
  for (const fold of folds) {
    const counted = insideCounts.get(fold);
    insideCounts.set(fold, counted === undefined ? 1 : counted + 1);
  }
}

/**
 * Every splice one stamp makes, keyed by the spot it writes into, so the write can run once per spot from
 * the last byte backwards.
 *
 * A fold can enclose several marked spots and must still be written into once — `${INSIDE_ATTRIBUTE}` states
 * how many, so a collapsed line says "three changed inside" rather than being stamped three times.
 */
function plannedSplices({
  anchors,
  corrections,
  spots,
}: {
  anchors: ReadonlyMap<number, string>;
  corrections: readonly SpotCorrection[];
  spots: readonly PageSpot[];
}): ReadonlyMap<number, string> {
  const splices = new Map<number, string>();
  const insideCounts = new Map<number, number>();
  for (const row of corrections) {
    const spotIndex = row.spotIndex;
    if (spotIndex === undefined || row.mark === "unchanged" || row.mark === "gone") {
      continue;
    }
    const spot = spots[spotIndex];
    if (spot === undefined) {
      continue;
    }
    const minted = ` id="${anchors.get(spotIndex)!}" ${MINTED_ANCHOR_FLAG}="1"`;
    const anchor = spot.id === undefined ? minted : "";
    splices.set(spotIndex, `${anchor} ${CORRECTION_ATTRIBUTE}="${row.mark}"`);
    countInside({ folds: enclosingFolds({ index: spotIndex, spots }), insideCounts });
  }
  for (const [fold, count] of insideCounts) {
    // Every splice starts with the space that separates it from whatever the opening tag already declares,
    // and a fold that carries a mark of its own is appended to rather than replaced. Trimming here instead
    // produced `<details id="f1"data-corr-inside="…">` — which `INSIDE_MARK_ATTRIBUTE` then could not take
    // back, because it needs that space, so every republish stamped one more copy onto the same tag.
    const inside = ` ${INSIDE_ATTRIBUTE}="${String(count)} changed inside"`;
    const existing = splices.get(fold);
    if (existing === undefined) {
      splices.set(fold, inside);
      continue;
    }
    splices.set(fold, `${existing}${inside}`);
  }
  return splices;
}

/** The strip's jump links, capped, plus the "and N more" span when the cap cut the list. */
function stripJumps({
  anchors,
  corrections,
}: {
  anchors: ReadonlyMap<number, string>;
  corrections: readonly SpotCorrection[];
}): readonly string[] {
  const marked = corrections.filter((row) => row.mark === "changed" || row.mark === "new");
  const shown = marked.slice(0, STRIP_MAX_JUMPS);
  const links = shown.map((row) => {
    const href = escapeAttribute({ text: `#${anchors.get(row.spotIndex!)!}` });
    return `<span class="corr-jump"><a href="${href}">${escapeText({ text: row.label })}</a></span>`;
  });
  if (marked.length <= shown.length) {
    return links;
  }
  const more = marked.length - shown.length;
  return [
    ...links,
    `<span class="corr-more">${escapeText({ text: `and ${String(more)} more, marked on the page` })}</span>`,
  ];
}

/** The strip's lead sentence: what moved, in the words the owner asked the page to answer with. */
function stripLead({ result }: { result: PageCorrections }): string {
  if (result.marked === 0 && result.gone === 0) {
    return "nothing changed since the version you read";
  }
  const parts = [
    `${String(result.changed)} changed`,
    ...(result.added > 0 ? [`${String(result.added)} new`] : []),
    ...(result.gone > 0 ? [`${String(result.gone)} gone`] : []),
  ];
  return `${parts.join(", ")} since the version you read`;
}

/** The whole strip element, counts and jumps, as one line of chrome. */
function renderStrip({ anchors, result }: { anchors: ReadonlyMap<number, string>; result: PageCorrections }): string {
  const lead = `<span class="corr-lead">${escapeText({ text: stripLead({ result }) })}</span>`;
  const body = result.marked === 0 ? [] : stripJumps({ anchors, corrections: result.corrections });
  const empty =
    result.marked === 0 && result.gone === 0
      ? ['<span class="corr-none">every spot on this page reads as you left it</span>']
      : [];
  return (
    `<div class="corr" ${MARKED_ATTRIBUTE}="${String(result.marked)}" ` +
    `${AGAINST_ATTRIBUTE}="${escapeAttribute({ text: result.against })}">` +
    [lead, ...body, ...empty].join("") +
    "</div>"
  );
}

/**
 * Write the computed marks onto the new page: a mark per changed or new spot, and one strip of chrome naming
 * them as jump links.
 *
 * Marks are spliced from the LAST spot backwards, so every offset the scan produced still points at the same
 * byte when its turn comes.
 *
 * @param previous the previously published bytes, stamped or not
 * @param next the new page, stamped or not
 * @returns the page to publish, and what the compare found
 */
export function stampCorrections({ previous, next }: { previous: string; next: string }): {
  html: string;
  result: PageCorrections;
} {
  const result = pageCorrections({ next, previous });
  const clean = stripCorrections({ html: next });
  const spots = pageSpots({ html: clean });
  const anchors = plannedAnchors({ corrections: result.corrections, html: clean, spots });
  const splices = plannedSplices({ anchors, corrections: result.corrections, spots });
  let html = clean;
  // Last spot first, so every offset the scan produced still points at the same byte when its turn comes.
  for (const spotIndex of [...splices.keys()].toSorted((left, right) => right - left)) {
    html = spliceIntoOpeningTag({ attributes: splices.get(spotIndex)!, html, spot: spots[spotIndex]! });
  }
  return { html: withCorrectionChrome({ html, strip: renderStrip({ anchors, result }) }), result };
}
