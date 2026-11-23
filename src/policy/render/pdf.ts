/**
 * Emitting the laid-out policy as a PDF — the one effectful half of the render.
 *
 * `pdf-lib` is asked for a page, three standard fonts, `drawText` and `drawImage`, and for nothing else.
 * Where each word goes was already decided by `layout.ts`, which is pure; this walks that list, breaks it
 * into pages when the cursor runs past the bottom margin, and writes the bytes.
 *
 * ## What the render can lose
 *
 * Rendering markdown OUT to PDF is not lossy the way reading a PDF back is (a page carries no cell
 * boundaries), because the markdown is the source and this decides the typography. What it can still do is DROP
 * something, so `layout.ts` refuses an unsupported construct rather than skipping it, and
 * {@link renderPolicyPdf} carries that refusal out whole — a figure that will not load included.
 *
 * The standard Helvetica and Courier faces are used rather than embedded ones. They are in every PDF reader
 * by definition, so the file cannot render differently on a machine that lacks a font — which for a
 * document an auditor opens is worth more than matching Vanta's own Inter. Their price is the WinAnsi
 * character set, and `undrawableCharacters` names anything outside it before a single page is drawn.
 *
 * ## The bytes are a pure function of the markdown, and that is load-bearing
 *
 * `pdf-lib` stamps a creation and modification date from the clock unless told otherwise, so two renders of
 * the same markdown produced different bytes. MEASURED, and it was found by the door rather
 * than by a test: `write vanta upload-policy-version` binds its approval digest to the PDF's own SHA-256,
 * the dry run printed one digest, the real run computed another from an identical document, and the hold
 * refused an approval that could never have been satisfied. So both dates are pinned to
 * {@link RENDER_EPOCH} and the producer strings are fixed, which makes the digest stable, makes the same
 * markdown diffable against its own previous render, and makes the refusal above mean what it says: the
 * bytes moved because the POLICY moved — or a figure it names did.
 */
import { PDFDocument, type PDFFont, type PDFImage, rgb, StandardFonts } from "pdf-lib";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { ImageLoader } from "./figures.js";
import { type FontFace, layoutPolicy, PAGE, type RenderedBlock } from "./layout.js";
import { type RenderRefusal, undrawableCharacters } from "./source.js";

/**
 * The instant every rendered policy records as its creation and modification date.
 *
 * A constant rather than the clock, so the bytes are a function of the markdown alone. The value is
 * arbitrary and deliberately not "now": a PDF's own metadata dates say when the FILE was made, which for a
 * re-rendered policy is meaningless, while the dates that matter to a reader are the effective date and the version
 * history inside the policy itself.
 */
const RENDER_EPOCH = new Date(Date.UTC(2000, 0, 1));

/** What one render produced. */
export interface RenderedPolicy {
  readonly bytes: Uint8Array;
  readonly pages: number;
  readonly lines: number;
}

/** One refusal as the line a caller prints: the construct, and which line of the markdown carries it.
 * @internal
 *
 * @param refusal the construct the layout would not draw
 * @returns the line a caller prints
 */
export function refusalLine({ refusal }: { refusal: RenderRefusal }): string {
  return `  line ${String(refusal.line)}: ${refusal.reason}`;
}

/**
 * Which image format a file's leading bytes declare, read from its signature rather than its extension.
 * @internal
 *
 * @param bytes the whole file
 * @returns `png`, `jpeg`, or null for anything `pdf-lib` cannot embed
 */
export function imageFormatOf({ bytes }: { bytes: Uint8Array }): "png" | "jpeg" | null {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) {
    return "png";
  }
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg ? "jpeg" : null;
}

/**
 * The most pixels a PNG may declare before it is refused unread. `pdf-lib` decodes a PNG whole, so a header
 * claiming 65535x65535 spun the render indefinitely in review rather than throwing; a full-page retina
 * screenshot is about 8 million, so this leaves a wide margin for any real figure.
 */
const MAX_PNG_PIXELS = 50_000_000;

/**
 * How many pixels a PNG's header declares, read from the IHDR chunk that must come first, or null when the
 * file is too short to carry one.
 * @internal
 *
 * @param bytes the whole PNG file
 * @returns width times height, as the header states it
 */
export function pngPixels({ bytes }: { bytes: Uint8Array }): number | null {
  if (bytes.length < 24) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) * view.getUint32(20);
}

/**
 * The characters every face encodes but the read-back returns as a DIFFERENT character, so a faithful render
 * of one could never verify: U+00AD comes back as `-`, U+00B5 (micro) as U+03BC (Greek mu). Measured in
 * review by rendering each of the 217 characters the three faces share, in each face, and reading it back;
 * these two were the only ones that did not survive.
 */
const NOT_READ_BACK: readonly number[] = [0x00ad, 0x00b5];

/**
 * The code points every face the render uses can encode, so a character is checked once against all three,
 * less the ones the read-back cannot return as themselves.
 */
function drawableBy({ fonts }: { fonts: readonly PDFFont[] }): ReadonlySet<number> {
  const [first, ...rest] = fonts.map((font) => new Set(font.getCharacterSet()));
  const common = new Set(first);
  for (const code of common) {
    if (!rest.every((set) => set.has(code))) {
      common.delete(code);
    }
  }
  for (const code of NOT_READ_BACK) {
    common.delete(code);
  }
  return common;
}

/** Embed one image block's file, or say at its line why it cannot be. */
async function embedOne({
  document,
  block,
  loadImage,
}: {
  document: PDFDocument;
  block: Extract<RenderedBlock, { kind: "image" }>;
  loadImage: ImageLoader | undefined;
}): Promise<Result<PDFImage, RenderRefusal>> {
  if (loadImage === undefined) {
    return err({ line: block.line, reason: `an image (${block.source}), which this render has no way to load` });
  }
  const loaded = loadImage({ source: block.source });
  if (loaded.isErr()) {
    return err({ line: block.line, reason: `the image ${block.source} could not be read: ${loaded.error.message}` });
  }
  const format = imageFormatOf({ bytes: loaded.value });
  if (format === null) {
    return err({ line: block.line, reason: `the image ${block.source} is neither a PNG nor a JPEG` });
  }
  const pixels = format === "png" ? pngPixels({ bytes: loaded.value }) : null;
  const unsizedPng = format === "png" && (pixels === null || pixels === 0 || pixels > MAX_PNG_PIXELS);
  if (unsizedPng) {
    return err({
      line: block.line,
      reason: `the image ${block.source} declares no size, a zero size, or more than ${String(MAX_PNG_PIXELS)} pixels`,
    });
  }
  try {
    const image = format === "png" ? await document.embedPng(loaded.value) : await document.embedJpg(loaded.value);
    return ok(image);
  } catch (error: unknown) {
    return err({ line: block.line, reason: `the image ${block.source} would not embed: ${errorMessage({ error })}` });
  }
}

/** Embed every image the layout placed, in order, collecting every one that would not load. */
async function embedImages({
  document,
  blocks,
  loadImage,
}: {
  document: PDFDocument;
  blocks: readonly RenderedBlock[];
  loadImage: ImageLoader | undefined;
}): Promise<Result<ReadonlyMap<RenderedBlock, PDFImage>, readonly RenderRefusal[]>> {
  const images = new Map<RenderedBlock, PDFImage>();
  const refusals: RenderRefusal[] = [];
  for (const block of blocks) {
    if (block.kind !== "image") {
      continue;
    }
    const embedded = await embedOne({ block, document, loadImage });
    if (embedded.isErr()) {
      refusals.push(embedded.error);
      continue;
    }
    images.set(block, embedded.value);
  }
  return refusals.length > 0 ? err(refusals) : ok(images);
}

/** The refusal list as the lines a caller prints, under the heading that says nothing was drawn. */
function refused({ refusals }: { refusals: readonly RenderRefusal[] }): Result<RenderedPolicy> {
  return err([
    "this markdown carries constructs this renderer will not silently drop:",
    ...refusals.map((refusal: RenderRefusal) => refusalLine({ refusal })),
  ]);
}

/** Walk the blocks down the pages: text at its indent and face, an image scaled into the column. */
function drawBlocks({
  document,
  blocks,
  images,
  fonts,
}: {
  document: PDFDocument;
  blocks: readonly RenderedBlock[];
  images: ReadonlyMap<RenderedBlock, PDFImage>;
  fonts: Readonly<Record<FontFace, PDFFont>>;
}): void {
  const column = PAGE.width - PAGE.margin * 2;
  const textArea = PAGE.height - PAGE.margin * 2;
  let page = document.addPage([PAGE.width, PAGE.height]);
  let cursor = PAGE.height - PAGE.margin;
  for (const block of blocks) {
    cursor -= block.spaceBefore;
    if (block.kind === "image") {
      const image = images.get(block)!;
      const scale = Math.min(1, column / image.width, textArea / image.height);
      const height = image.height * scale;
      if (cursor - height < PAGE.margin) {
        page = document.addPage([PAGE.width, PAGE.height]);
        cursor = PAGE.height - PAGE.margin;
      }
      cursor -= height;
      page.drawImage(image, { height, width: image.width * scale, x: PAGE.margin, y: cursor });
      continue;
    }
    const step = block.size * PAGE.leading;
    if (cursor - step < PAGE.margin) {
      page = document.addPage([PAGE.width, PAGE.height]);
      cursor = PAGE.height - PAGE.margin;
    }
    cursor -= step;
    page.drawText(block.text, {
      color: rgb(0.08, 0.09, 0.11),
      font: fonts[block.font],
      size: block.size,
      x: PAGE.margin + block.indent,
      y: cursor,
    });
  }
}

/**
 * Render one policy or evidence document's markdown as a PDF.
 *
 * @param markdown the file's whole contents, front matter included
 * @param loadImage reads a figure's bytes by the path the markdown wrote; without one, any image refuses
 * @returns the PDF bytes and its page count, or every reason the render did not happen — a construct the
 *   renderer refuses to drop included, each naming the markdown line that carries it
 */
export async function renderPolicyPdf({
  markdown,
  loadImage,
}: {
  markdown: string;
  loadImage?: ImageLoader;
}): Promise<Result<RenderedPolicy>> {
  let document: PDFDocument;
  let fonts: Record<FontFace, PDFFont>;
  try {
    document = await PDFDocument.create();
    fonts = {
      bold: await document.embedFont(StandardFonts.HelveticaBold),
      mono: await document.embedFont(StandardFonts.Courier),
      regular: await document.embedFont(StandardFonts.Helvetica),
    };
  } catch (error: unknown) {
    return err([`could not start a PDF: ${errorMessage({ error })}`]);
  }
  const undrawable = undrawableCharacters({
    drawable: drawableBy({ fonts: [fonts.regular, fonts.bold, fonts.mono] }),
    markdown,
  });
  if (undrawable.length > 0) {
    return refused({ refusals: undrawable });
  }
  const laid = layoutPolicy({
    markdown,
    measure: ({ text, size, bold: isBold }) => (isBold ? fonts.bold : fonts.regular).widthOfTextAtSize(text, size),
  });
  if (laid.isErr()) {
    return refused({ refusals: laid.error });
  }
  const images = await embedImages({ blocks: laid.value, document, loadImage });
  if (images.isErr()) {
    return refused({ refusals: images.error });
  }
  try {
    document.setCreationDate(RENDER_EPOCH);
    document.setModificationDate(RENDER_EPOCH);
    document.setProducer("slopweaver policy render");
    document.setCreator("slopweaver policy render");
    drawBlocks({ blocks: laid.value, document, fonts, images: images.value });
    const lines = laid.value.filter((block) => block.kind === "text").length;
    return ok({ bytes: await document.save(), lines, pages: document.getPageCount() });
  } catch (error: unknown) {
    return err([`could not draw the policy: ${errorMessage({ error })}`]);
  }
}
