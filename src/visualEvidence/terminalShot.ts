/**
 * A terminal proof as a picture: render given terminal text to a PNG and record, as the frame text, exactly the
 * text that was drawn — so a terminal screenshot is captured through a verb like every other one.
 *
 * ## Rendered from text, never photographed
 *
 * The text a terminal proof shows is already in hand — `slopweaver cmux read-screen` prints a pane's screen, and a
 * command's own output is text. Photographing the screen would add the window chrome, the other panes and whatever
 * else was on the display, then lose the exact characters to pixels. Rendering the text instead gives a frame that
 * holds nothing but what was chosen, and a frame text that is not a reading of the pixels but the very string drawn.
 *
 * ## The frame text is what was DRAWN, after the font had its say
 *
 * Escape sequences are stripped and tabs expanded the way a terminal would, then each line goes through
 * `./annotate.ts`'s `captionSafe` — the bundled bitmap font prints a dash as `-` and a glyph it lacks as `?`. The
 * recorded frame text is the line AFTER that pass, because that is the text in the frame; a scan over the text
 * before it would be a scan over characters the reader never sees.
 *
 * ## Cropped by lines, out of the whole source
 *
 * The source frame is the whole text rendered; the crop is the line range kept. Passing the whole of a `cmux
 * read-screen` and a `lines` range makes the receipt PROVE the picture was cut down to what it shows — and a range
 * covering every line is a whole screen, which `github attach` refuses (`./imageChecks.ts`).
 *
 * ## One item per word
 *
 * Each word is its own frame-text item with the rectangle it was drawn in, so `./redact.ts` can burn one token out of
 * a line and drop exactly that token from the child's frame text.
 */
import { Jimp, loadFont, measureText } from "jimp";
import { SANS_32_WHITE } from "jimp/fonts";

import { err, ok, type Result } from "#lib/result.js";
import { captionSafe } from "./annotate.js";
import { type CaptureReceipt, captureIdFor } from "./captureRecord.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import type { FrameTextItem } from "./frameText.js";
import { identifyImageBytes } from "./imageIo.js";
import { metadataLeftIn } from "./pngMetadata.js";
import type { PixelRect } from "./types.js";

/** Padding around the drawn text, in pixels. */
export const TERMINAL_PADDING_PX = 24;

/** A terminal's background, packed `0xRRGGBBAA`. */
const TERMINAL_BACKGROUND = 0x1e1e1eff;

/** The most lines one terminal shot may keep — a proof, not a log. */
const MAX_TERMINAL_LINES = 80;

/** The most characters one kept line may carry before it is refused rather than drawn off the edge. */
export const MAX_TERMINAL_LINE_CHARS = 240;

/** A terminal's tab stop. */
const TAB_STOP = 8;

/** CSI (`ESC [ … final`), OSC (`ESC ] … BEL|ST`) and the two-byte escapes, in that order. */
const ESCAPE_SEQUENCES = [
  // oxlint-disable-next-line no-control-regex -- an escape sequence opens with ESC by definition
  /\u001b\[[0-?]*[ -/]*[@-~]/gu,
  // oxlint-disable-next-line no-control-regex -- an escape sequence opens with ESC by definition
  /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu,
  // oxlint-disable-next-line no-control-regex -- an escape sequence opens with ESC by definition
  /\u001b[@-Z\\-_]/gu,
] as const;

/**
 * Expand tabs to the next tab stop, the way a terminal draws them.
 *
 * @param line one line with no newline in it
 * @returns the line with every tab replaced by spaces
 */
function expandTabs({ line }: { line: string }): string {
  let column = 0;
  let out = "";
  for (const character of line) {
    if (character === "\t") {
      const width = TAB_STOP - (column % TAB_STOP);
      out += " ".repeat(width);
      column += width;
      continue;
    }
    out += character;
    column += 1;
  }
  return out;
}

/**
 * Terminal text as the lines a reader saw: escapes stripped, a carriage return overwriting what came before it,
 * tabs expanded, other control characters dropped, trailing blanks and trailing empty lines removed.
 *
 * @param text the raw text — a `cmux read-screen` dump, a command's output
 * @returns the lines, each as the bundled font will draw it
 */
export function terminalScreenLines({ text }: { text: string }): readonly string[] {
  let plain = text;
  for (const pattern of ESCAPE_SEQUENCES) {
    plain = plain.replace(pattern, "");
  }
  const lines = plain
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => {
      const afterReturn = line.split("\r").at(-1)!;
      const expanded = expandTabs({ line: afterReturn });
      // oxlint-disable-next-line no-control-regex -- matching control characters is the point
      return captionSafe({ text: expanded.replace(/[\u0000-\u001f\u007f]/gu, "") }).trimEnd();
    });
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/** The 1-based inclusive range of lines kept. */
export interface TerminalLineRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The lines one shot keeps, or every reason the range cannot be kept.
 *
 * @param lines the whole source, from {@link terminalScreenLines}
 * @param range the range asked for, or `undefined` for every line
 * @returns the kept lines and the range they are, or the reasons
 */
export function selectTerminalLines({
  lines,
  // No range asked for is every line: the destructuring default says so at the read.
  range: chosen = { from: 1, to: lines.length },
}: {
  lines: readonly string[];
  range: TerminalLineRange | undefined;
}): Result<{ readonly kept: readonly string[]; readonly range: TerminalLineRange }, VisualEvidenceError> {
  if (lines.length === 0) {
    return err(VisualEvidenceErrors.terminalTextRefused({ reasons: ["the terminal text holds no lines to draw"] }));
  }
  const reasons: string[] = [];
  if (chosen.from < 1 || chosen.to < chosen.from || chosen.to > lines.length) {
    reasons.push(
      `lines ${String(chosen.from)}-${String(chosen.to)} do not lie inside the text's ${String(lines.length)} lines`,
    );
  }
  const kept = lines.slice(chosen.from - 1, chosen.to);
  if (kept.length > MAX_TERMINAL_LINES) {
    reasons.push(`a terminal shot keeps at most ${String(MAX_TERMINAL_LINES)} lines, got ${String(kept.length)}`);
  }
  kept.forEach((line, index) => {
    if (line.length > MAX_TERMINAL_LINE_CHARS) {
      reasons.push(
        `line ${String(chosen.from + index)} is ${String(line.length)} characters; at most ` +
          `${String(MAX_TERMINAL_LINE_CHARS)} are drawn legibly`,
      );
    }
  });
  if (kept.every((line) => line === "")) {
    reasons.push("every kept line is blank, so the picture would show nothing");
  }
  if (reasons.length > 0) {
    return err(VisualEvidenceErrors.terminalTextRefused({ reasons }));
  }
  return ok({ kept, range: chosen });
}

/** What {@link renderTerminalShot} hands back: the PNG and the receipt that names it. */
export interface TerminalShot {
  readonly bytes: Uint8Array;
  readonly receipt: CaptureReceipt;
}

/**
 * One word's rectangle on one drawn line, in the final image's pixels.
 *
 * @returns the items for that line, one per whitespace-separated word
 */
function wordItems({
  line,
  top,
  lineHeight,
  measure,
}: {
  line: string;
  top: number;
  lineHeight: number;
  measure: (args: { value: string }) => number;
}): FrameTextItem[] {
  const items: FrameTextItem[] = [];
  for (const match of line.matchAll(/\S+/gu)) {
    const start = match.index;
    const x = TERMINAL_PADDING_PX + Math.floor(measure({ value: line.slice(0, start) }));
    const width = Math.max(1, Math.ceil(measure({ value: match[0] })));
    items.push({ rect: { height: lineHeight, width, x, y: top }, text: match[0] });
  }
  return items;
}

/** Draw the kept lines onto a terminal-coloured canvas, recording every word's rectangle as it is drawn. */
async function drawLines({
  kept,
  font,
  measure,
  width,
  height,
}: {
  kept: readonly string[];
  font: Awaited<ReturnType<typeof loadFont>>;
  measure: (args: { value: string }) => number;
  width: number;
  height: number;
}): Promise<{ readonly bytes: Uint8Array; readonly items: readonly FrameTextItem[] }> {
  const lineHeight = font.common.lineHeight;
  const canvas = new Jimp({ color: TERMINAL_BACKGROUND, height, width });
  const items: FrameTextItem[] = [];
  kept.forEach((line, index) => {
    const top = TERMINAL_PADDING_PX + index * lineHeight;
    canvas.print({ font, text: line, x: TERMINAL_PADDING_PX, y: top });
    items.push(...wordItems({ line, lineHeight, measure, top }));
  });
  return { bytes: new Uint8Array(await canvas.getBuffer("image/png")), items };
}

/**
 * Render the kept lines of some terminal text to a PNG, and build the capture receipt naming exactly what was drawn.
 *
 * @param text the raw terminal text
 * @param range the 1-based inclusive line range to keep, or `undefined` for every line
 * @param label the caller's name for where the text came from
 * @param out where the PNG will be written, recorded in the receipt
 * @param capturedAtIso when the shot was taken
 * @returns the PNG and its receipt, or why it could not be drawn
 */
export async function renderTerminalShot({
  text,
  range,
  label,
  out,
  capturedAtIso,
}: {
  text: string;
  range: TerminalLineRange | undefined;
  label: string;
  out: string;
  capturedAtIso: string;
}): Promise<Result<TerminalShot, VisualEvidenceError>> {
  const lines = terminalScreenLines({ text });
  const selected = selectTerminalLines({ lines, range });
  if (selected.isErr()) {
    return err(selected.error);
  }
  const font = await loadFont(SANS_32_WHITE);
  const measure = ({ value }: { value: string }): number => measureText(font, value);
  const lineHeight = font.common.lineHeight;
  const widthOf = ({ set }: { set: readonly string[] }): number =>
    Math.max(1, ...set.map((line) => Math.ceil(measure({ value: line })))) + TERMINAL_PADDING_PX * 2;
  const { kept } = selected.value;
  const width = widthOf({ set: kept });
  const height = kept.length * lineHeight + TERMINAL_PADDING_PX * 2;
  const { bytes, items } = await drawLines({ font, height, kept, measure, width });
  const left = metadataLeftIn({ bytes });
  if (left.length > 0) {
    return err(VisualEvidenceErrors.metadataSurvived({ chunks: left }));
  }
  const artifact = await identifyImageBytes({ bytes });
  if (artifact.isErr()) {
    return err(artifact.error);
  }
  const cropRect: PixelRect = {
    height,
    width,
    x: 0,
    y: (selected.value.range.from - 1) * lineHeight,
  };
  return ok({
    bytes,
    receipt: {
      captureId: captureIdFor({ digest: artifact.value.digest }),
      capturedAtIso,
      cropRect,
      detail: { label, lines: selected.value.range, sourceLines: lines.length },
      final: { artifact: artifact.value, metadata: "stripped", path: out },
      frameText: { items, kind: "exact", origin: "terminal-screen" },
      schemaVersion: 2,
      source: { heightPx: lines.length * lineHeight + TERMINAL_PADDING_PX * 2, widthPx: widthOf({ set: lines }) },
      status: "readback-pending",
      verb: "browser terminal-shot",
    },
  });
}
