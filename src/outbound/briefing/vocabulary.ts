/**
 * The RUN, BLOCK and FOLD vocabulary every gated page in this repository is filled with — shared, so a
 * second page is a second SHAPE rather than a second copy of the rules.
 *
 * It was cut out of `./schema.ts` when a second gated page briefly existed, and it stayed split when that
 * page was folded back into the briefing's react-now block. The split is still the
 * right one, for the reason it was made: what a reader meets — the same runs, the same folds, the same
 * packed-enumeration refusal, the same word and sentence counters — is one question, and a page carrying its
 * OWN answers to it would be a second gate that drifts the moment a cap moves. Every cap lives in
 * `../../briefing/caps.ts`; nothing here restates a number.
 *
 * ## What belongs here, and what does not
 *
 * Here: anything a reader meets on any gated page — an inline run, a paragraph, a list, an image, a draft, a
 * `<details>` fold, and the two cap combinators every cell is built from. Not here: a section a particular
 * page happens to carry. A react-now card and a row of the owner's list are the briefing's own sections and live in
 * `./schema.ts`, so this file never becomes a union of pages rather than the thing they share.
 *
 * ## Sentences and words are counted with the CHECK's own counters
 *
 * `sentenceCount` and `wordCount` are imported from `../../briefing/text.ts` rather than reimplemented. A
 * second counter would be a second opinion about the same cap, and the whole claim of these forms is that
 * what they admit is what the gate over the rendered page passes.
 */
import { z } from "zod";

import { base64RunEnd } from "#lib/base64Run.js";

import {
  BLOCK_MAX_ENUMERATORS,
  FOLD_MAX_BLOCKS,
  FOLD_NEST_MAX_DEPTH,
  IMAGE_MAX_BYTES,
  PASTE_MAX_BYTES,
} from "../../briefing/caps.js";
import { endsInEllipsis, isBareKeyLabel, sentenceCount, wordCount } from "../../briefing/text.js";
import { cappedList } from "../cappedList.js";
import { SLACK_MESSAGE_TEXT_MAX } from "../slack/dripRender.js";
import { strictForm } from "../strictForm.js";
import type { BriefingBlock, BriefingContent, BriefingFold } from "./types.js";

/** One inline enumerator, the same shape `../../briefing/pageBudget.ts` refuses inside a paragraph. */
const INLINE_ENUMERATOR = /(?:^|\s)\d{1,2}[.)]\s+(?=[a-zA-Z])/g;

/**
 * The plain text of a content cell, which is what every cap is counted over.
 *
 * Two things make this the SAME text `../../briefing/check.ts` measures over the rendered page, which is the
 * whole claim of this form. Runs are concatenated with no separator, exactly as `./render.ts` emits them. A
 * link contributes its LABEL and not its URL, because the gate strips tags and an `<a href=…>` leaves only
 * the text a reader sees; counting the URL would refuse a card the check passes.
 *
 * @internal — the counter this file's caps share; `./render.ts` emits the same text as HTML.
 * @param content the cell's ordered runs
 * @returns the text a reader meets
 */
export function textOfContent({ content }: { content: BriefingContent }): string {
  return content
    .map((run) => run.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether one string carries at most the allowed number of inline enumerators. */
function noPackedEnumeration(text: string): boolean {
  // A global `match` answers null rather than an empty list when nothing matches: no enumerator at all.
  const enumerators = text.match(INLINE_ENUMERATOR);
  return enumerators === null || enumerators.length <= BLOCK_MAX_ENUMERATORS;
}

/** The refusal for a packed enumeration, naming what to do instead. */
const PACKED_ENUMERATION = {
  message:
    `packs more than ${String(BLOCK_MAX_ENUMERATORS)} numbers into running prose. ` +
    'A numbered set of items is a real list — use a `{ "kind": "list" }` block, one item per entry.',
};

/**
 * The refusal for a run cut with an ellipsis, naming the fold the rest belongs in rather than the ellipsis
 * itself — the same fold every other over-length cell here is told to use.
 *
 * A session-start row that cut a headline mid-sentence left the rest nowhere on the page, so the rule is
 * that a rendered page never truncates. Real prose that trails off reads identically
 * to a cut one, so this refuses the shape rather than trying to tell them apart.
 */
const TRUNCATED_ELLIPSIS = {
  message:
    "ends in an ellipsis with nothing after it. A cut that drops the rest leaves it nowhere on the page to " +
    "read — write the whole thing, and fold it behind a `detail` if it runs long.",
};

/** One line of prose, refused when it packs a numbered list or trails off with a cut it does not recover. */
export const proseLine = z
  .string()
  .min(1)
  .refine(noPackedEnumeration, PACKED_ENUMERATION)
  .refine((text) => !endsInEllipsis({ text }), TRUNCATED_ELLIPSIS);

/** A section id: a lowercase slug, so an anchor's `href="#…"` is a fragment rather than a sentence. */
export const sectionId = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "a section id is a lowercase slug: letters, digits and single hyphens, as in `todays-rulings`.",
  });

const inlineSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("text"), text: proseLine }),
  strictForm({ kind: z.literal("strong"), text: proseLine }),
  strictForm({ kind: z.literal("code"), text: z.string().min(1) }),
  strictForm({ kind: z.literal("link"), text: proseLine, url: z.url() }),
  strictForm({ kind: z.literal("anchor"), target: sectionId, text: proseLine }),
]);

/** An ordered, non-empty list of runs. */
export const contentSchema = z.array(inlineSchema).min(1);

/**
 * One line of text NOBODY HERE COMPOSED — the owner's own recorded words, carried through unchanged.
 *
 * {@link proseLine}'s two refusals are both INSTRUCTIONS TO A COMPOSER, and each says so in its own message:
 * "use a `list` block, one item per entry", and "write the whole thing, and fold it behind a `detail`".
 * Neither is an act available to a projection, whose only way to satisfy either would be to rewrite what the
 * owner actually typed — the one thing a projection of their words must never do. So this is the non-empty
 * check and nothing else, scoped exactly the way {@link noBareKeyLinks} already is and for the identical
 * reason.
 *
 * MEASURED over the live tick ledger's 895 distinct recorded turns (repro:
 * `jq -r '.ownerTurns.turns[]?.text' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl" | sort -u`):
 * ONE ends in an ellipsis and ONE packs three inline enumerators. Under `proseLine` each of those would
 * refuse the whole briefing — a page taken away from the owner because of how they punctuated a sentence.
 */
const quotedLine = z.string().min(1);

/** The same five runs, over {@link quotedLine}: what a projection of the owner's own words may carry. */
const quotedInlineSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("text"), text: quotedLine }),
  strictForm({ kind: z.literal("strong"), text: quotedLine }),
  strictForm({ kind: z.literal("code"), text: z.string().min(1) }),
  strictForm({ kind: z.literal("link"), text: quotedLine, url: z.url() }),
  strictForm({ kind: z.literal("anchor"), target: sectionId, text: quotedLine }),
]);

/** An ordered, non-empty list of QUOTED runs — see {@link quotedLine}. */
const quotedContentSchema = z.array(quotedInlineSchema).min(1);

/** The refusal for a fold's link naming only its key, with no title beside it. */
const BARE_KEY_LINK = {
  message:
    "a link inside the fold carries only its bare key as the label — a reader has to open it to know what it " +
    "names. Put the title beside the key in the link text.",
};

/**
 * Whether a run of content carries a link whose visible text is nothing but a ticket or pull-request key.
 *
 * A row naming a ticket or pull request carries its title beside the key, so the reader never opens the
 * link to find out what it is. Scoped to
 * fold content, where a composer cites evidence, rather than every cell — a card's short above-the-fold
 * fields are not where a citation lives.
 */
function noBareKeyLinks(content: BriefingContent): boolean {
  return content.every((run) => run.kind !== "link" || !isBareKeyLabel({ text: run.text }));
}

/** A fold's own content: the shared vocabulary, plus the bare-key-link rule folded text alone carries. */
const foldContentSchema = contentSchema.refine(noBareKeyLinks, BARE_KEY_LINK);

/**
 * A resolved image's `data:` URI header: one of the four MIME types `../../briefing/images.ts` knows how to
 * embed. The header alone is a regular expression; the payload after it is not (see {@link base64ImagePayload}).
 */
const DATA_URI_IMAGE_HEADER = /^data:image\/(?:png|jpeg|gif|webp);base64,/;

/** The most `=` padding characters a base64 payload ends with. */
const BASE64_MAX_PADDING = 2;

/**
 * A resolved image's base64 payload — one or more base64 alphabet characters, then at most two `=`, then the
 * end of the string — or `undefined` when `dataUri` is not that shape behind {@link DATA_URI_IMAGE_HEADER}.
 *
 * The payload is checked by `base64RunEnd` and plain string reads rather than a regex quantified over it,
 * because an image at its cap is 5.6 million characters and a quantified regex over that many throws
 * `RangeError: Maximum call stack size exceeded` in a long-lived process (`#lib/base64Run.js` carries the
 * mechanism and its repro).
 */
function base64ImagePayload({ dataUri }: { dataUri: string }): string | undefined {
  const header = DATA_URI_IMAGE_HEADER.exec(dataUri);
  if (header === null) {
    return undefined;
  }
  const start = header[0].length;
  if (base64RunEnd({ from: start, text: dataUri }) !== dataUri.length) {
    return undefined;
  }
  let dataEnd = dataUri.length;
  while (dataEnd > start && dataUri.length - dataEnd < BASE64_MAX_PADDING && dataUri[dataEnd - 1] === "=") {
    dataEnd -= 1;
  }
  if (dataEnd === start || dataUri.slice(start, dataEnd).includes("=")) {
    return undefined;
  }
  return dataUri.slice(start);
}

/**
 * The raw byte length a resolved image's `data:` URI decodes to, or 0 for a string that never matched the
 * shape at all (a case {@link imageSchema}'s own `refine` above this one already rejects).
 *
 * @internal — read by this file's own per-image and page-total caps; no caller outside the form names it.
 * @param dataUri the image block's `data` field
 * @returns the decoded byte length
 */
export function decodedImageBytes({ dataUri }: { dataUri: string }): number {
  const payload = base64ImagePayload({ dataUri });
  if (payload === undefined) {
    return 0;
  }
  return Buffer.from(payload, "base64").length;
}

const imageSchema = strictForm({
  alt: z.string().min(1),
  caption: z.string().min(1).max(160).optional(),
  data: z
    .string()
    .refine((value) => base64ImagePayload({ dataUri: value }) !== undefined, {
      message:
        "an image's `data` must be a `data:image/(png|jpeg|gif|webp);base64,…` URI. Write `path` instead and " +
        "let `briefing render` embed the file, or fix the encoding.",
    })
    .refine((value) => decodedImageBytes({ dataUri: value }) <= IMAGE_MAX_BYTES, {
      message: `an image decodes to over the cap of ${String(IMAGE_MAX_BYTES)} bytes. Resize or recompress it.`,
    }),
  kind: z.literal("image"),
});

/**
 * A draft the owner is being asked to approve, shown the way its own surface would show it.
 *
 * `surface` carries one member today (`slack-as-me`), and `text`'s own cap is that surface's own cap rather
 * than a second number invented here — {@link SLACK_MESSAGE_TEXT_MAX} is Slack's documented ceiling on a
 * message's `text` field, imported from the module that already carries it for the as-me door.
 */
const draftSchema = strictForm({
  kind: z.literal("draft"),
  surface: z.literal("slack-as-me"),
  text: z.string().min(1).max(SLACK_MESSAGE_TEXT_MAX),
});

/** The refusal for a fold carrying more blocks than a reader meets at a glance. */
const FOLD_TOO_MANY_BLOCKS = {
  message:
    `this fold carries more than ${String(FOLD_MAX_BLOCKS)} blocks. ` +
    "Depth goes DOWN a level rather than sideways — group the tail behind a nested `fold`, which counts as one block.",
};

/**
 * Every block a fold may hold, over one content vocabulary.
 *
 * A factory rather than a constant because a fold has two audiences — see {@link quotedFoldSchema}. What
 * varies is the content rule and whether the block COUNT is held; the block kinds and their shapes never do.
 * Nothing here counts words or sentences: the loosening (`../../briefing/caps.ts`, § "The three per-cell
 * fold caps that stood here for one day") left the prose inside a fold alone.
 *
 * @param content the run vocabulary this fold's prose is held to
 * @param composed whether a session here wrote these blocks, rather than a projection of the owner's own words
 * @returns the block union
 */
function blocksOver({
  content,
  composed,
  depth,
}: {
  content: z.ZodType<BriefingContent>;
  composed: boolean;
  depth: number;
}): z.ZodType<BriefingBlock> {
  const para = strictForm({ content, kind: z.literal("para") });
  const list = strictForm({
    items: z.array(content).min(1),
    kind: z.literal("list"),
    ordered: z.boolean(),
  });
  if (depth >= FOLD_NEST_MAX_DEPTH) {
    return z.discriminatedUnion("kind", [para, list, imageSchema, draftSchema, pasteSchema]);
  }
  const nested = strictForm({
    fold: foldOver({ composed, content, depth: depth + 1 }),
    kind: z.literal("fold"),
  });
  return z.discriminatedUnion("kind", [para, list, nested, imageSchema, draftSchema, pasteSchema]);
}

/**
 * Whether a fold's blocks read text then images, never the reverse — an image may only follow another image
 * or every para/list block that precedes it, never sit ahead of one.
 *
 * A drafted Slack post's screenshots read the way the Slack post would if sent — a message's own text
 * first, its attachments after. Making the shape a refine rather than a documentation
 * note is the same call {@link optionsSchema}'s no-gap rule makes: a composer cannot get this wrong by hand.
 */
function textThenImages({ blocks }: { blocks: readonly BriefingBlock[] }): boolean {
  let seenImage = false;
  for (const block of blocks) {
    if (block.kind === "image") {
      seenImage = true;
      continue;
    }
    if (seenImage) {
      return false;
    }
  }
  return true;
}

/**
 * A fold's own summary — the one line a reader clicks, and the only part of a fold that is above the fold.
 *
 * Its 120 characters are what a reader spends before deciding to open anything — the ONE part of a fold a
 * reader cannot choose to skip — which is why it carries a cap at all while the body it opens no longer does
 * (`../../briefing/caps.ts`, § "The three per-cell fold caps that stood here for one day"). Characters
 * rather than words, because what it has to fit is a line, not a breath.
 */
export const FOLD_SUMMARY_MAX = 120;

/** A fold's summary line, held to {@link FOLD_SUMMARY_MAX} and refused when it ends in a truncation ellipsis. */
export const foldSummary = z
  .string()
  .min(1)
  .max(FOLD_SUMMARY_MAX)
  .refine((text) => !endsInEllipsis({ text }), TRUNCATED_ELLIPSIS);

/**
 * A value the owner has to move somewhere else verbatim, handed over as one click.
 *
 * `text` carries no run vocabulary and no prose rules at all — it is the bytes the owner pastes, so the packed
 * enumeration and ellipsis refusals `proseLine` applies to composed prose would be this schema refusing the
 * content for being what it is. What DOES apply is a size: {@link PASTE_MAX_BYTES}, measured over the card
 * that produced this block kind. `label` is held to {@link foldSummary} rather than a second number about
 * the same thing — both are one short line naming what a reader is about to meet.
 */
const pasteSchema = strictForm({
  kind: z.literal("paste"),
  label: foldSummary,
  text: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value, "utf8") <= PASTE_MAX_BYTES, {
      message:
        `a paste block's text runs over the cap of ${String(PASTE_MAX_BYTES)} bytes. A paste block is one ` +
        "value the owner moves into one box — link the file instead when it is bigger than that.",
    }),
});

/** The refusal for a fold whose images read ahead of its prose. */
const IMAGE_BEFORE_TEXT = {
  message:
    "an image block sits ahead of a para, list, draft or paste block in the same fold. A card reads text " +
    "then images, the way the Slack post it describes would — move every image to the end of `blocks`.",
};

/**
 * A fold over one content vocabulary: the summary a reader clicks, and the blocks behind it.
 *
 * @param content the run vocabulary this fold's prose is held to
 * @param composed whether a session here wrote these blocks, rather than a projection of the owner's own words
 * @returns the fold schema
 */
function foldOver({
  content,
  composed,
  depth,
}: {
  content: z.ZodType<BriefingContent>;
  composed: boolean;
  depth: number;
}): z.ZodType<BriefingFold> {
  const blocks = z.array(blocksOver({ composed, content, depth })).min(1);
  // `cappedList` rather than `.max()`, because a fold sits inside the section's plain `z.union` of note arms.
  return strictForm({
    blocks: composed ? cappedList({ list: blocks, max: FOLD_MAX_BLOCKS, ...FOLD_TOO_MANY_BLOCKS }) : blocks,
    summary: foldSummary,
  }).refine((fold) => textThenImages({ blocks: fold.blocks }), IMAGE_BEFORE_TEXT);
}

/**
 * A COMPOSED fold: everything a session writes, held to the bare-key-link rule and to the fold's own SHAPE.
 *
 * Shape is {@link FOLD_MAX_BLOCKS} at every level of nesting, the text-then-images order, and the packed
 * enumeration and ellipsis rules every run carries wherever it sits. It is deliberately not a length: the
 * per-cell word and sentence caps that briefly stood here came off, and `../../briefing/caps.ts` carries
 * what was measured on both sides of that.
 *
 * What still stops a fold becoming a wall is the arrangement rather than the counting — four blocks, and a
 * fifth thing goes DOWN into a nested fold a reader opens separately.
 */
export const foldSchema = foldOver({ composed: true, content: foldContentSchema, depth: 1 });

/**
 * A QUOTED fold: one built from text nobody here composed, so the bare-key-link rule does not apply to it.
 *
 * The one real case is a projected row's own detail (`../../briefing/yourList.ts`), whose blocks are the
 * owner's own recorded question with its references promoted to links. MEASURED over a real list: two of
 * the top ten rows quote a bare numeric reference, and the composed rule refused both.
 * Reproduce with `slopweaver session-start --json --no-record | slopweaver session-start page --list -`.
 *
 * That refusal was right about composed prose and wrong here, and the difference is who wrote the words.
 * "Put the title beside the key" is an instruction to a session citing evidence; there is nobody to instruct
 * on a projection, and the only way to satisfy it would be to rewrite what the owner actually recorded — which is
 * the one thing a projection must never do. So the rule is scoped to composed folds, exactly as its own
 * reasoning always said, rather than weakened for everyone.
 *
 * **{@link FOLD_MAX_BLOCKS} follows the same split, for a related reason.** A quoted fold's block count is
 * `../../briefing/yourList.ts`'s `rowFold` deciding how many parts of the owner's own row to show, and it already
 * emits five when the row carries background — so counting them here would refuse a real row of the owner's
 * list to enforce a shape nobody composed. The per-cell length caps were split the same way while they
 * stood, and came off entirely.
 *
 * **The run vocabulary is {@link quotedContentSchema} rather than {@link contentSchema}.**
 * The same split, one level down: `proseLine`'s packed-enumeration and truncated-ellipsis refusals are both
 * worded as instructions to a composer, and a projection has nobody to instruct. The measurement that
 * forced it — one turn of the owner's in 895 ending in an ellipsis, one packing three enumerators, each of which
 * refused the whole page — is on `quotedLine`.
 */
export const quotedFoldSchema = foldOver({ composed: false, content: quotedContentSchema, depth: 1 });

/**
 * A cell's word cap, counted over the text a reader meets.
 *
 * @param words the cap
 * @param field the cell's name, as it appears in the refusal a composer reads
 * @returns the content schema, refusing anything over the cap
 */
export function cappedContent({ words, field }: { words: number; field: string }): z.ZodType<BriefingContent> {
  return contentSchema.refine((content) => wordCount({ text: textOfContent({ content }) }) <= words, {
    message:
      `${field} runs over the cap of ${String(words)} words above the fold. ` +
      "Cut it, or move the rest into the card's `detail` fold.",
  });
}

/**
 * A cell's sentence cap, counted the same way the gate counts one.
 *
 * @param schema the cell's schema so far, so word and sentence caps stack on one cell
 * @param sentences the cap
 * @param field the cell's name, as it appears in the refusal a composer reads
 * @returns the content schema, refusing anything over the cap
 */
export function cappedSentences({
  schema,
  sentences,
  field,
}: {
  schema: z.ZodType<BriefingContent>;
  sentences: number;
  field: string;
}): z.ZodType<BriefingContent> {
  const unit = sentences === 1 ? "sentence" : "sentences";
  return schema.refine((content) => sentenceCount({ text: textOfContent({ content }) }) <= sentences, {
    message:
      `${field} runs over the cap of ${String(sentences)} ${unit} above the fold. ` +
      "Keep the ones a reader has to read to decide, and fold the rest.",
  });
}

/**
 * A note inside a collapsed section: its `headline` carrying no length cap, its `detail` a composed fold.
 *
 * The headline stays uncapped because a section behind a `<details>` is one a reader chose to open, and the
 * gate over the rendered page does not measure it either — capping it here would refuse the real page's own
 * history while the shipped check passes it, which is the two halves disagreeing. `proseLine`'s
 * packed-enumeration rule still applies to every run, folded or not.
 *
 * The DETAIL is a {@link foldSchema}, so it is held to that fold's SHAPE and to no length at all. This is
 * where the no-length-cap rule bites hardest and it is the section it was measured over: `earlierToday` and
 * `history` are the archive, 148 of one dry render's 169 refusals were in them, and a 376-word paragraph
 * that read as a wall was inside one of these notes rather than inside a card. What keeps the archive
 * affordable is `../../briefing/caps.ts`'s `SECTION_MAX_NOTES` and `PAGE_TEXT_MAX_BYTES`, which bound how
 * many of these a page carries and what they weigh — never how a single note reads.
 *
 * **What DOES reach a note is vocabulary rather than length.**
 * `../../briefing/sectionQuality.ts` reads every note of a section for a fleet word the section never
 * explains. That is not a length cap creeping back: a length cap asks for a re-composition, and this asks for one
 * word to be swapped or defined.
 */
export const foldedNoteSchema = strictForm({
  detail: foldSchema.optional(),
  headline: contentSchema,
});

/**
 * A QUOTED note: the same headline, and a detail holding words nobody here composed.
 *
 * The one difference from {@link foldedNoteSchema} is which fold the detail is held to, and it is the same
 * split `yourRowSchema` already takes for the owner's list. A projection of the supervisor tick ledger
 * renders each recorded owner turn exactly as typed (`../../briefing/narrative.ts`), and a composed fold's
 * bare-key-link rule would refuse a turn that cites a bare number — which could only be satisfied by rewriting
 * the owner.
 *
 * `lane` is REQUIRED on this arm and absent on the other, so the union discriminates without any existing
 * form having to learn a field: every note written before this arm existed still parses as the composed one.
 */
export const quotedNoteSchema = strictForm({
  detail: quotedFoldSchema.optional(),
  headline: contentSchema,
  lane: z.literal("quoted"),
});
