/**
 * A hand step's picture on its queue card: the provider page, with a numbered red box over each thing to grab.
 *
 * Every human-hand step shows a screenshot of the provider page with red boxes around
 * what to grab, so the owner hardly leaves the UI. `hand post --shot --box` stores the PNG by its SHA-256 and the step
 * carries `{ sha256, width, height, boxes }` (`src/hand/shot.ts`); `hand list --json` publishes it as it is.
 *
 * Restated here, not imported: `site/` cannot import `src/`. The reading is whole or nothing, as every field in
 * `../components/live/read.ts` is — a box past its picture would be drawn somewhere the owner is not meant to look.
 *
 * Boxes are in IMAGE pixels. The overlay's `viewBox` is the picture's natural size and the SVG is stretched over the
 * `<img>` exactly, so CSS scaling moves the boxes with the picture and no ratio is ever computed by hand.
 *
 * Pure: no I/O.
 */
import { isBag, str } from "./bag";

/** One red box, in image pixels, with the words its number points at. */
export interface HandShotBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

/** The picture a step carries, by hash, with its natural size and its boxes. */
export interface HandShotView {
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly HandShotBox[];
}

/** A stored picture's name: its lowercase-hex SHA-256. */
const SHA256 = /^[0-9a-f]{64}$/u;

/** The register's own caps (`src/hand/shot.ts`), so a reading holds a row to the rule that let it in. */
const BOXES_CAP = 9;
const LABEL_CAP = 60;
const SIDE_CAP = 20_000;

/**
 * A whole number in `[min, max]`, or `undefined`.
 *
 * @returns the number, when it is one in range
 */
function wholeIn({ value, min, max }: { value: unknown; min: number; max: number }): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  return undefined;
}

/**
 * One box, read against the picture it is drawn on.
 *
 * @returns the box, or `undefined` when it is not one inside the picture
 */
function readBox({ value, width, height }: { value: unknown; width: number; height: number }): HandShotBox | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const x = wholeIn({ max: width - 1, min: 0, value: value["x"] });
  const y = wholeIn({ max: height - 1, min: 0, value: value["y"] });
  if (x === undefined || y === undefined) {
    return undefined;
  }
  const boxWidth = wholeIn({ max: width - x, min: 1, value: value["width"] });
  const boxHeight = wholeIn({ max: height - y, min: 1, value: value["height"] });
  const label = str({ bag: value, key: "label" });
  const labelFits = label !== undefined && label.trim() !== "" && label.length <= LABEL_CAP && !/[\r\n]/u.test(label);
  if (boxWidth === undefined || boxHeight === undefined || !labelFits) {
    return undefined;
  }
  return { height: boxHeight, label, width: boxWidth, x, y };
}

/**
 * Read a step's `shot`, whole or not at all.
 *
 * @param value the raw `shot` field
 * @param unboxed whether a picture with no boxes reads — a hand step's, never an ask's (`src/hand/shot.ts`)
 * @returns `{ shot }`, its `shot` undefined when absent, or `undefined` when present and not whole
 */
export function readHandShotView({
  value,
  unboxed,
}: {
  value: unknown;
  unboxed: "admitted" | "refused";
}): { readonly shot: HandShotView | undefined } | undefined {
  if (value === undefined) {
    return { shot: undefined };
  }
  if (!isBag(value)) {
    return undefined;
  }
  const sha256 = str({ bag: value, key: "sha256" });
  const width = wholeIn({ max: SIDE_CAP, min: 1, value: value["width"] });
  const height = wholeIn({ max: SIDE_CAP, min: 1, value: value["height"] });
  const listed: unknown = value["boxes"];
  if (sha256 === undefined || !SHA256.test(sha256) || width === undefined || height === undefined) {
    return undefined;
  }
  // None is the picture `hand post` took of its own link — the page itself, nothing to grab (`src/hand/shot.ts`).
  const fewest = unboxed === "admitted" ? 0 : 1;
  if (!Array.isArray(listed) || listed.length < fewest || listed.length > BOXES_CAP) {
    return undefined;
  }
  const boxes: HandShotBox[] = [];
  for (let index = 0; index < listed.length; index += 1) {
    const box = readBox({ height, value: listed[index], width });
    if (box === undefined) {
      return undefined;
    }
    boxes.push(box);
  }
  return { shot: { boxes, height, sha256, width } };
}

/** One box as the overlay draws it: its rect, and the numbered tag beside it, all in image pixels. */
export interface OverlayBox {
  readonly number: number;
  readonly label: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly tag: { readonly x: number; readonly y: number; readonly size: number };
}

/** What the card draws: the picture's address, the SVG's `viewBox`, and each box with its tag. */
export interface ShotOverlay {
  readonly src: string;
  readonly viewBox: string;
  readonly boxes: readonly OverlayBox[];
}

/**
 * Where a box's number tag sits: above the box's top-left corner, or below the box when there is no room above,
 * or inside its corner when there is room on neither side — always inside the picture.
 *
 * @returns the tag's top-left corner
 */
function tagAt({ box, size, shot }: { box: HandShotBox; size: number; shot: HandShotView }): { x: number; y: number } {
  const x = Math.max(0, Math.min(box.x, shot.width - size));
  if (box.y >= size) {
    return { x, y: box.y - size };
  }
  if (box.y + box.height + size <= shot.height) {
    return { x, y: box.y + box.height };
  }
  return { x, y: box.y };
}

/**
 * The overlay a card draws for a step's picture.
 *
 * The tag scales with the picture's width — a fortieth of it, never under 16 pixels — so its number reads the same
 * on a narrow capture and a full-page 2x one once the card has scaled either to its column.
 *
 * @param shot the step's picture
 * @returns the address, the view box and every box with its tag, numbered from 1 in the order posted
 */
export function shotOverlay({ shot }: { shot: HandShotView }): ShotOverlay {
  const size = Math.max(16, Math.round(shot.width / 40));
  return {
    boxes: shot.boxes.map((box, index) => ({
      label: box.label,
      number: index + 1,
      rect: { height: box.height, width: box.width, x: box.x, y: box.y },
      tag: { ...tagAt({ box, shot, size }), size },
    })),
    src: `/api/hand-shot/${shot.sha256}`,
    viewBox: `0 0 ${String(shot.width)} ${String(shot.height)}`,
  };
}
