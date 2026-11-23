/**
 * cmux's STYLED terminal grid — the one read that carries what colour a cell is drawn in.
 *
 * ## Why this exists beside `surface.read_text`
 *
 * MEASURED against cmux 0.64.22 and Claude Code 2.1.263, on a scratch workspace opened for the
 * measurement: `surface.read_text` answers plain UTF-8 with **no escape sequences at all** — probed with
 * `ansi`, `include_ansi`, `format: "ansi"`, `raw` and `colors`, every one of which returned the identical
 * 1,071-byte payload carrying no `ESC` byte. cmux publishes no `surface.read_ansi` either. So a caller
 * reading a screen through that method cannot see a colour, and two lines drawn in different colours arrive
 * as the same bytes.
 *
 * That is not a cosmetic gap. Claude Code draws a **prompt suggestion** — text it generated itself — into
 * the composer in the terminal's DIM attribute, and a line the owner actually typed in the normal one. Read
 * as plain text both are `❯ <words>`, which is how a supervisor once read a machine-written
 * `approved, land it` as a ruling the owner had typed (`src/cmux/composer.ts` carries that incident and the
 * fixtures).
 *
 * `terminal.replay` is the method that does carry it. Its `render_grid` (`format: cmux.render-grid.v1`) is
 * the cell grid as cmux renders it: `row_spans` of text with a `style_id`, and a `styles` table those ids
 * index. A style carries `faint` — the SGR dim attribute — which is exactly the bit the suggestion is drawn
 * with. **Style ids are per-snapshot**, not stable across reads: id 7 was a white-on-grey footer style in one
 * capture and the faint placeholder style in the next, so a caller MUST resolve an id against the same
 * grid's own table rather than remembering one.
 *
 * This module is the parse only. What the grid MEANS about a composer is `./composer.ts`, kept apart so the
 * meaning is testable over a frozen fixture with no socket anywhere near it.
 */
import { absentAsNumber } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type CmuxError, CmuxErrors } from "./errors.js";

/** The `terminal.replay` method name, in one place so the parse and its errors cannot drift apart. */
export const RENDER_GRID_METHOD = "terminal.replay";

/** One entry of a grid's style table — the drawing attributes a span's `styleId` points at. */
interface CmuxSpanStyle {
  readonly id: number;
  /** The SGR dim attribute. This is the bit that separates Claude Code's own grey text from the owner's. */
  readonly faint: boolean;
  /** The resolved foreground colour, as cmux reports it (`#RRGGBB`). */
  readonly foreground: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** One run of same-styled cells on one row. */
export interface CmuxRowSpan {
  readonly row: number;
  readonly column: number;
  readonly text: string;
  readonly styleId: number;
}

/**
 * Where cmux reports the terminal's cursor sitting. Claude Code HIDES it for the whole of a running turn and
 * while a permission dialog is up (measured), so it narrows a composer search rather than gating
 * one — see `./composer.ts`'s `composerPromptRow`.
 */
export interface CmuxGridCursor {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
}

/** The fields of a `cmux.render-grid.v1` reply this repository reads. */
export interface CmuxRenderGrid {
  readonly rows: number;
  readonly columns: number;
  readonly cursor: CmuxGridCursor | undefined;
  readonly spans: readonly CmuxRowSpan[];
  readonly styles: readonly CmuxSpanStyle[];
}

/** A number field, or `undefined` when it is absent or not a number. */
function optionalNumber({ field, value }: { field: string; value: unknown }): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** One `styles` entry, or `undefined` when it carries no usable id. */
function parseStyle({ entry }: { entry: unknown }): CmuxSpanStyle | undefined {
  const id = optionalNumber({ field: "id", value: entry });
  if (id === undefined || !isRecord(entry)) {
    return undefined;
  }
  const foreground = entry["foreground"];
  return {
    bold: entry["bold"] === true,
    faint: entry["faint"] === true,
    foreground: typeof foreground === "string" ? foreground : "",
    id,
    italic: entry["italic"] === true,
  };
}

/** One `row_spans` entry, or `undefined` when it is missing a coordinate or its text. */
function parseSpan({ entry }: { entry: unknown }): CmuxRowSpan | undefined {
  const row = optionalNumber({ field: "row", value: entry });
  const column = optionalNumber({ field: "column", value: entry });
  const styleId = optionalNumber({ field: "style_id", value: entry });
  if (row === undefined || column === undefined || styleId === undefined || !isRecord(entry)) {
    return undefined;
  }
  const text = entry["text"];
  return typeof text === "string" ? { column, row, styleId, text } : undefined;
}

/** The `cursor` block, or `undefined` when the reply carries none this parse can use. */
function parseCursor({ value }: { value: unknown }): CmuxGridCursor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const cursor = value["cursor"];
  const row = optionalNumber({ field: "row", value: cursor });
  const column = optionalNumber({ field: "column", value: cursor });
  if (row === undefined || column === undefined || !isRecord(cursor)) {
    return undefined;
  }
  return { column, row, visible: cursor["visible"] === true };
}

/**
 * Decode a `terminal.replay` reply into the styled grid.
 *
 * A malformed span or style entry is DROPPED rather than failing the whole parse — same judgement as
 * `parseWorkspaceList`: this is a rendering read, and one unusable run of cells must not blind a composer
 * check to the rest of the screen. A reply with no `render_grid` at all is a different thing and refuses,
 * because every verdict downstream would then be about a grid that was never there.
 *
 * @param value the decoded reply
 * @returns the styled grid, or the typed failure
 */
export function parseRenderGrid({ value }: { value: unknown }): Result<CmuxRenderGrid, CmuxError> {
  if (!isRecord(value)) {
    return err(CmuxErrors.malformedReply({ detail: "the reply was not an object", method: RENDER_GRID_METHOD }));
  }
  const grid = value["render_grid"];
  if (!isRecord(grid)) {
    return err(CmuxErrors.malformedReply({ detail: "the reply carried no `render_grid`", method: RENDER_GRID_METHOD }));
  }
  const spans: CmuxRowSpan[] = [];
  for (const entry of Array.isArray(grid["row_spans"]) ? grid["row_spans"] : []) {
    const span = parseSpan({ entry });
    if (span !== undefined) {
      spans.push(span);
    }
  }
  const styles: CmuxSpanStyle[] = [];
  for (const entry of Array.isArray(grid["styles"]) ? grid["styles"] : []) {
    const style = parseStyle({ entry });
    if (style !== undefined) {
      styles.push(style);
    }
  }
  return ok({
    columns: absentAsNumber({ value: optionalNumber({ field: "columns", value: grid }), whenAbsent: 0 }),
    cursor: parseCursor({ value: grid }),
    rows: absentAsNumber({ value: optionalNumber({ field: "rows", value: grid }), whenAbsent: 0 }),
    spans,
    styles,
  });
}
