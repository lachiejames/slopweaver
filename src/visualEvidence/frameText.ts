/**
 * The TEXT that was in a captured frame, recorded by the verb that took the picture — so a publication scan can run
 * over exactly the text the frame was drawn from.
 *
 * ## Why the verb records it, beside the pixels being read
 *
 * The image check the owner settled has two layers: the session looks at the image itself, and a deterministic scan
 * runs over the same patterns as the description scan. A scan needs text. The verb that drew or photographed the
 * frame already HAS it — a terminal's screen is the text it was rendered from, a page's visible text is in its DOM —
 * exactly, with no confidence score, so a capture verb records it beside the picture's digest. What the DOM walk sees
 * as pixels (an `<img>`, a `<canvas>`, a background image) is not in it: `github attach` also reads the text the
 * pixels show on this machine (`./imageTextRecognition.ts`) and scans both, and pixels that are not text at all are left
 * to the viewing and the review.
 *
 * ## Positioned items, because redaction has to be able to remove one
 *
 * Every item carries the rectangle it occupies in the FINAL image's pixels. `./redact.ts` burns opaque rectangles
 * into a picture, and its child receipt drops exactly the items a burned rectangle wholly covers — so the scan that
 * refused a token can pass once the token is burned out, and still refuses when the burn missed part of it. An item
 * a rectangle covers only PARTLY stays whole: the visible remainder is unknown, so the conservative answer keeps all
 * of it.
 *
 * ## `incomplete` is a real arm, never a quiet `exact`
 *
 * A page can hold text this capture cannot reach — an iframe's document, a shadow root, more text nodes than the walk
 * reads. Calling that frame text `exact` would let a scan pass over a frame it never saw whole. So the verb says
 * `incomplete` and why, and `github attach` refuses anything short of `exact`.
 */
import { z } from "zod";

import type { PixelRect } from "./types.js";

/**
 * A rectangle in image pixels, as every visual-evidence document spells one.
 * @internal — exported so the capture record's schema reuses the one spelling rather than restating it.
 */
export const pixelRectSchema = z
  .object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

const frameTextItemSchema = z.object({ rect: pixelRectSchema, text: z.string().min(1) }).strict();

/**
 * Where a frame's text was read from: a terminal screen drawn from text, a page's DOM, or a recording's transcript —
 * every screen a terminal recording showed, as the recorder wrote it out beside the video.
 */
const frameTextOriginSchema = z.enum(["terminal-screen", "page-visible-text", "recording-transcript"]);

/**
 * The strict schema for one frame's recorded text.
 * @internal — parsed as part of a capture record; exported so the capture record's schema embeds it.
 */
export const frameTextSchema = z.discriminatedUnion("kind", [
  z
    .object({ items: z.array(frameTextItemSchema).readonly(), kind: z.literal("exact"), origin: frameTextOriginSchema })
    .strict(),
  z
    .object({
      items: z.array(frameTextItemSchema).readonly(),
      kind: z.literal("incomplete"),
      origin: frameTextOriginSchema,
      reasons: z.array(z.string().min(1)).min(1).readonly(),
    })
    .strict(),
]);

/** One piece of text and the rectangle it occupies in the final image. */
export interface FrameTextItem {
  readonly text: string;
  readonly rect: PixelRect;
}

/** A frame's recorded text: every item, or every item that could be read plus why the rest could not. */
export type FrameText = z.infer<typeof frameTextSchema>;

/**
 * The frame's text in reading order, as ONE string a scan reads.
 *
 * Items are ordered top to bottom then left to right; an item sharing a top edge with the one before it and sitting
 * to its right joins it with a space, and anything else starts a new line. Joining across items is deliberate: a
 * token never contains whitespace, so splitting the frame at item boundaries loses nothing a scan looks for, and the
 * newline keeps two unrelated cells from fusing into a false match. Items at the SAME place — a recording's lines,
 * each of which any frame may show — keep their recorded order and stay on lines of their own.
 *
 * @param frameText the recorded frame text
 * @returns the text, `""` for a frame with none
 */
export function frameTextLines({ frameText }: { frameText: FrameText }): string {
  const ordered = frameText.items.toSorted((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const lines: string[] = [];
  let previous: PixelRect | null = null;
  for (const item of ordered) {
    const sideBySide = previous !== null && previous.y === item.rect.y && previous.x < item.rect.x;
    if (sideBySide) {
      lines[lines.length - 1] = `${lines.at(-1)!} ${item.text}`;
    } else {
      lines.push(item.text);
    }
    previous = item.rect;
  }
  return lines.join("\n");
}

/** A line of a recording transcript that is only box drawing — a frame separator, not anything a reader sees. */
const SEPARATOR_LINE = /^[\s─-╿]*$/u;

/**
 * The frame text of a terminal recording, from the transcript the recorder wrote beside the video: every distinct
 * non-blank line any frame showed, in the order first shown, each placed over the whole frame because any frame may
 * show it. No transcript, or one with no text at all, is `incomplete`: a recording whose screens were not written
 * out cannot be scanned, and an empty transcript of a recording that typed something is a transcript that failed.
 *
 * @param transcript the recorder's text output, `null` when it wrote none
 * @param frame the video's frame size in pixels
 * @returns the frame text
 */
export function transcriptFrameText({
  transcript,
  frame,
}: {
  transcript: string | null;
  frame: { readonly widthPx: number; readonly heightPx: number };
}): FrameText {
  const origin = "recording-transcript";
  if (transcript === null) {
    return { items: [], kind: "incomplete", origin, reasons: ["the recorder wrote no transcript beside the video"] };
  }
  const rect = { height: frame.heightPx, width: frame.widthPx, x: 0, y: 0 };
  const seen = new Set<string>();
  const items: FrameTextItem[] = [];
  for (const raw of transcript.split(/\r?\n/u)) {
    const text = raw.trimEnd();
    if (SEPARATOR_LINE.test(text) || seen.has(text)) {
      continue;
    }
    seen.add(text);
    items.push({ rect, text });
  }
  if (items.length === 0) {
    return { items, kind: "incomplete", origin, reasons: ["the recorder's transcript holds no text"] };
  }
  return { items, kind: "exact", origin };
}

/**
 * Whether one rectangle lies wholly inside another.
 *
 * @param inner the rectangle that must be covered
 * @param outer the rectangle that must cover it
 * @returns whether every pixel of `inner` is inside `outer`
 */
export function rectCovers({ inner, outer }: { inner: PixelRect; outer: PixelRect }): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * The frame text left once some rectangles have been burned out of the picture.
 *
 * An item goes only when ONE burned rectangle covers it wholly. Partly covered, it stays whole: what remains visible
 * is not known, and keeping it means the scan refuses until the burn covers the whole thing.
 *
 * @param frameText the parent frame's text
 * @param burned the rectangles painted solid, in the same image's pixels
 * @returns the child frame's text, the same arm as the parent's
 */
export function frameTextWithout({
  frameText,
  burned,
}: {
  frameText: FrameText;
  burned: readonly PixelRect[];
}): FrameText {
  const items = frameText.items.filter((item) => !burned.some((rect) => rectCovers({ inner: item.rect, outer: rect })));
  return { ...frameText, items };
}

/** One text node a page reported, in viewport CSS pixels — the page half of {@link pageFrameText}'s input. */
interface PageTextNode {
  readonly text: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/**
 * What the page walk reported beside its text nodes: whether it stopped early, and the regions whose text it cannot
 * read at all (an iframe's document, a shadow root), in viewport CSS pixels.
 */
export interface PageTextWalk {
  readonly nodes: readonly PageTextNode[];
  readonly truncated: boolean;
  readonly opaque: readonly PageTextNode["rect"][];
}

/**
 * Where a viewport rectangle lands in the crop, in the crop's own pixels, or `null` when it misses the crop.
 *
 * @param rect the rectangle in viewport CSS pixels
 * @param scale viewport CSS pixels to image pixels
 * @param crop the rectangle cut out of the raw image
 * @returns the clipped rectangle relative to the crop's origin, or `null`
 */
function intoCrop({
  rect,
  scale,
  crop,
}: {
  rect: PageTextNode["rect"];
  scale: number;
  crop: PixelRect;
}): PixelRect | null {
  const left = Math.max(Math.floor(rect.x * scale), crop.x);
  const top = Math.max(Math.floor(rect.y * scale), crop.y);
  const right = Math.min(Math.ceil((rect.x + rect.width) * scale), crop.x + crop.width);
  const bottom = Math.min(Math.ceil((rect.y + rect.height) * scale), crop.y + crop.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { height: bottom - top, width: right - left, x: left - crop.x, y: top - crop.y };
}

/**
 * The frame text of one cropped browser capture: every page text node the crop shows, then the caption lines the
 * pipeline drew in the band below it.
 *
 * A node the crop cuts through is kept WHOLE — the scan over a superset of the visible text refuses at least as much
 * as one over the exact visible part, which is the safe direction to be wrong in.
 *
 * @param walk the page's text nodes, whether the walk stopped early, and the regions it cannot read
 * @param scale viewport CSS pixels to raw image pixels, the same scale the crop was decided at
 * @param crop the rectangle cut out of the raw image
 * @param caption the caption lines drawn below the crop, and the band's height in pixels
 * @returns the frame text, `incomplete` when the walk stopped early or an unreadable region sits in the crop
 */
export function pageFrameText({
  walk,
  scale,
  crop,
  caption,
}: {
  walk: PageTextWalk;
  scale: number;
  crop: PixelRect;
  caption: { readonly lines: readonly string[]; readonly bandHeightPx: number };
}): FrameText {
  const pageItems = walk.nodes.flatMap((node): FrameTextItem[] => {
    const rect = intoCrop({ crop, rect: node.rect, scale });
    return rect === null || node.text.trim() === "" ? [] : [{ rect, text: node.text }];
  });
  // Each caption line gets its own slice of the band, so reading order keeps the lines apart rather than fusing them.
  const sliceHeight = Math.floor(caption.bandHeightPx / Math.max(caption.lines.length, 1));
  const captionItems =
    sliceHeight > 0
      ? caption.lines.map((text, index) => ({
          rect: { height: sliceHeight, width: crop.width, x: 0, y: crop.height + index * sliceHeight },
          text,
        }))
      : [];
  const items = [...pageItems, ...captionItems];
  const reasons = [
    ...(walk.truncated ? ["the page held more text nodes than the capture walks, so the rest were not read"] : []),
    ...(walk.opaque.some((rect) => intoCrop({ crop, rect, scale }) !== null)
      ? ["an iframe or shadow root sits inside the crop, and its text is not readable from the page"]
      : []),
  ];
  if (reasons.length > 0) {
    return { items, kind: "incomplete", origin: "page-visible-text", reasons };
  }
  return { items, kind: "exact", origin: "page-visible-text" };
}

/**
 * {@link pageFrameText} for a capture whose snippet may have reported no walk at all. No walk is `incomplete`, never
 * an empty `exact` — an empty list would read as a frame with no text in it, which the walk's absence cannot support.
 *
 * @param walk the page's text nodes, or `null` when the capture reported none
 * @param scale viewport CSS pixels to raw image pixels
 * @param crop the rectangle cut out of the raw image
 * @param caption the caption lines drawn below the crop, and the band's height in pixels
 * @returns the frame text
 */
export function capturedPageFrameText({
  walk,
  scale,
  crop,
  caption,
}: {
  walk: PageTextWalk | null;
  scale: number;
  crop: PixelRect;
  caption: { readonly lines: readonly string[]; readonly bandHeightPx: number };
}): FrameText {
  if (walk !== null) {
    return pageFrameText({ caption, crop, scale, walk });
  }
  const { items } = pageFrameText({ caption, crop, scale, walk: { nodes: [], opaque: [], truncated: false } });
  const reasons = ["the capture reported no walk of the page's visible text"];
  return { items, kind: "incomplete", origin: "page-visible-text", reasons };
}
