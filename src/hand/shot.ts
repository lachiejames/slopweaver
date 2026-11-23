/**
 * The screenshot a hand step carries: the provider page the owner has to act on, with a red box around each thing to grab.
 *
 * Every human-hand step shows a screenshot of the provider page with red boxes around
 * what to grab, so the owner hardly leaves the UI. The picture is stored once by its SHA-256 (`./shotStore.ts`); the step
 * records only the hash, the picture's size, and the boxes, so a row stays one short line and the card can draw
 * each box exactly where it was put.
 *
 * The other picture a step carries is the one `hand post` takes of its own `--url` before the note goes up, so a
 * note never opens a page that does not show the thing yet. That one has no boxes: it is the page itself.
 *
 * Boxes are in IMAGE pixels, never CSS pixels: the card scales the picture to its width and the boxes with it, so a
 * box drawn against a 2x capture lands on the same field at any size.
 *
 * Pure: no I/O.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/** One red box, in image pixels, with the words the card numbers it by. */
export interface ShotBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

/** The picture a step carries, by hash, with its natural size and its boxes. */
export interface HandShot {
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly ShotBox[];
}

/** A stored picture's name: its lowercase-hex SHA-256, as `../corpus/contentStore.ts` names every blob. */
const SHA256 = /^[0-9a-f]{64}$/u;

/** One `--box` value: four non-negative integers, then `=` and the label. */
const BOX_FLAG = /^(\d+),(\d+),(\d+),(\d+)=(.+)$/su;

/** How many boxes one picture may carry — a step is one act, so more than a handful is a tour, not a step. */
const BOXES_CAP = 9;

/** The longest label — it is the line under the picture the box's number points at, not a paragraph. */
const LABEL_CAP = 60;

/** The largest side a picture may have, in pixels — a 5K display's full-page capture, with room. */
const SIDE_CAP = 20_000;

/** A PNG's eight signature bytes, then the IHDR chunk's length and type, which every valid PNG opens with. */
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];

/**
 * A refusal naming the shot field and the rule it broke.
 *
 * @returns the typed error
 */
function refused({ why }: { why: string }): HandStepError {
  return HandStepErrors.invalidField({ field: "shot", why });
}

/**
 * The value as a whole number in `[min, max]`, or `undefined` when it is not one.
 *
 * @returns the number, or `undefined`
 */
function wholeIn({ value, min, max }: { value: unknown; min: number; max: number }): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return undefined;
  }
  return value;
}

/**
 * Read one `--box x,y,w,h=label` flag into a box. Whether it lies inside the picture is {@link checkedShot}'s to
 * judge, since the picture's size is not known here.
 *
 * @param value the flag's value as typed
 * @returns the box, or why the flag is not one
 */
export function parseBoxFlag({ value }: { value: string }): Result<ShotBox, HandStepError> {
  const match = BOX_FLAG.exec(value.trim());
  if (match === null) {
    return err(refused({ why: `box "${value}" is not x,y,width,height=label in image pixels` }));
  }
  const [, x, y, width, height, label] = match;
  return ok({ height: Number(height), label: label!.trim(), width: Number(width), x: Number(x), y: Number(y) });
}

/**
 * The size a PNG declares in its IHDR chunk, or why the bytes are not a PNG.
 *
 * @param bytes the whole file
 * @returns its width and height in pixels
 */
export function pngSize({ bytes }: { bytes: Uint8Array }): Result<{ width: number; height: number }, HandStepError> {
  if (bytes.length < 24 || PNG_HEAD.some((byte, index) => bytes[index] !== byte)) {
    return err(refused({ why: "is not a PNG — a step's picture is a PNG screenshot" }));
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  // A `getUint32` is always whole, so only the range is in question.
  if (width < 1 || width > SIDE_CAP || height < 1 || height > SIDE_CAP) {
    return err(
      refused({ why: `declares ${String(width)}x${String(height)} pixels, outside 1 to ${String(SIDE_CAP)}` }),
    );
  }
  return ok({ height, width });
}

/**
 * Check one box against the picture it is drawn on.
 *
 * @param value whatever the register line or the flag carried
 * @param index the box's place, for the refusal
 * @param width the picture's width
 * @param height the picture's height
 * @returns the box, or why it is not one
 */
function checkedBox({
  value,
  index,
  width,
  height,
}: {
  value: unknown;
  index: number;
  width: number;
  height: number;
}): Result<ShotBox, HandStepError> {
  const where = `box ${String(index + 1)}`;
  if (!isRecord(value)) {
    return err(refused({ why: `${where} is not an object` }));
  }
  const { label } = value;
  const x = wholeIn({ max: width - 1, min: 0, value: value["x"] });
  const y = wholeIn({ max: height - 1, min: 0, value: value["y"] });
  if (x === undefined || y === undefined) {
    return err(refused({ why: `${where} starts outside the ${String(width)}x${String(height)} picture` }));
  }
  const boxWidth = wholeIn({ max: width - x, min: 1, value: value["width"] });
  const boxHeight = wholeIn({ max: height - y, min: 1, value: value["height"] });
  if (boxWidth === undefined || boxHeight === undefined) {
    return err(refused({ why: `${where} has no area or runs past the ${String(width)}x${String(height)} picture` }));
  }
  if (typeof label !== "string" || label.trim().length === 0 || label.length > LABEL_CAP || /[\r\n]/u.test(label)) {
    return err(refused({ why: `${where}'s label is one line of 1 to ${String(LABEL_CAP)} characters` }));
  }
  return ok({ height: boxHeight, label, width: boxWidth, x, y });
}

/**
 * The picture a step carries, checked whole — the one validator posting and reading share, so a row the register
 * holds is judged by the same rule that let it in.
 *
 * @param value whatever the caller or the register line carried
 * @param unboxed whether a picture with no boxes is admitted — only a hand step's, whose `hand post` look at its own
 *   `--url` is the page itself; an ask's or an incident's picture is there to point at something
 * @returns the shot, `undefined` when there is none, or the refusal
 */
export function checkedShot({
  value,
  unboxed,
}: {
  value: unknown;
  unboxed: "admitted" | "refused";
}): Result<HandShot | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(refused({ why: "is an object carrying sha256, width, height and boxes" }));
  }
  const { sha256, boxes } = value;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
    return err(refused({ why: "names no stored picture — sha256 is 64 lowercase hex characters" }));
  }
  const width = wholeIn({ max: SIDE_CAP, min: 1, value: value["width"] });
  const height = wholeIn({ max: SIDE_CAP, min: 1, value: value["height"] });
  if (width === undefined || height === undefined) {
    return err(refused({ why: `width and height are whole pixels from 1 to ${String(SIDE_CAP)}` }));
  }
  // None is the picture `hand post` took of its own `--url` — the page as the owner will see it, with nothing to grab. A
  // poster's `--shot` still needs one: `--box` is paired with it at the flag (`shotFlagsOf`).
  const fewest = unboxed === "admitted" ? 0 : 1;
  if (!Array.isArray(boxes) || boxes.length < fewest || boxes.length > BOXES_CAP) {
    const none = fewest === 0 ? "" : " — a picture with none shows the owner nothing to grab";
    return err(refused({ why: `carries ${String(fewest)} to ${String(BOXES_CAP)} boxes${none}` }));
  }
  const listed: readonly unknown[] = boxes;
  const checked: ShotBox[] = [];
  for (const [index, box] of listed.entries()) {
    const one = checkedBox({ height, index, value: box, width });
    if (one.isErr()) {
      return err(one.error);
    }
    checked.push(one.value);
  }
  return ok({ boxes: checked, height, sha256, width });
}
