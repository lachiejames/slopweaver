/**
 * Replay the bytes a pseudo-terminal recorded onto a virtual screen, and answer what that screen SHOWS.
 *
 * Stripping escape sequences is not the same thing, and the difference is exactly where a minted token went
 * missing. `claude setup-token` draws with a CELL-DIFF renderer: a cell the terminal already holds is never
 * written, the cursor jumps over it with `ESC[nG` or `ESC[nC`. MEASURED on Claude Code 2.1.285 under
 * `MINT_PTY_PROGRAM`: the banner arrives as `Welcome^[[9Gto^[[12GClaude`, its spaces never sent. Deleting the
 * jumps glues the words, and on a row the success frame draws OVER the authorize URL it deletes every token
 * character that already stood in its column — a shorter token that still looks like one, and a 401 at the
 * probe. The same mint's live run is the repro: `slopweaver claude mint --plan <alias>` before this module.
 *
 * So this is the smallest terminal that answers the question: cursor motion, erase, autowrap and scrolling,
 * with colour, modes and hyperlink payloads ignored because none of them put a character on screen.
 */

/** A cursor position: `row` counts from the first line ever written, `col` from the left edge. */
interface Cursor {
  row: number;
  col: number;
}

/** The screen being replayed onto. */
interface Screen {
  readonly columns: number;
  readonly rows: number;
  /** Every line ever written, scrolled-off history first; a missing cell is blank. */
  readonly lines: (string | undefined)[][];
  /** The index in `lines` of the viewport's first row. */
  top: number;
  cursor: Cursor;
  saved: Cursor;
}

/** Code points a terminal draws two cells wide: East Asian wide and fullwidth forms, and emoji. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

/** A CSI parameter byte's range, `0`–`?`. */
const CSI_PARAM = /[0-?]/;

/** A CSI intermediate byte's range, space–`/`. */
const CSI_INTERMEDIATE = /[ -/]/;

/** The prefixes that mark a PRIVATE CSI — a mode or a query, never a cursor motion. */
const CSI_PRIVATE = new Set(["<", "=", ">", "?"]);

/** The escapes that open a control STRING, which runs to BEL or `ESC \`: OSC, DCS, SOS, PM, APC. */
const STRING_OPENERS = new Set(["]", "P", "X", "^", "_"]);

/** The escapes that designate a character set and consume one byte more. */
const CHARSET_OPENERS = new Set(["(", ")", "*", "+", "-", ".", "/", "#", "%"]);

/** The tab stop interval every terminal defaults to. */
const TAB_WIDTH = 8;

/**
 * The line at `row`, created blank when nothing has reached it yet.
 *
 * @param screen the screen being replayed onto
 * @param row the line's index in `lines`
 * @returns the line's cells, for writing
 */
function lineAt({ screen, row }: { screen: Screen; row: number }): (string | undefined)[] {
  while (screen.lines.length <= row) {
    screen.lines.push([]);
  }
  return screen.lines[row]!;
}

/**
 * Move down one line, scrolling the viewport when the cursor is on its last row.
 *
 * @param screen the screen being replayed onto
 */
function lineFeed({ screen }: { screen: Screen }): void {
  screen.cursor.row += 1;
  if (screen.cursor.row > screen.top + screen.rows - 1) {
    screen.top += 1;
  }
  lineAt({ screen, row: screen.cursor.row });
}

/**
 * Draw one printable character at the cursor, wrapping first when it would cross the right edge.
 *
 * @param screen the screen being replayed onto
 * @param char the character, one code point
 */
function draw({ screen, char }: { screen: Screen; char: string }): void {
  const width = WIDE.test(char) ? 2 : 1;
  if (screen.cursor.col + width > screen.columns) {
    screen.cursor.col = 0;
    lineFeed({ screen });
  }
  const line = lineAt({ screen, row: screen.cursor.row });
  line[screen.cursor.col] = char;
  if (width === 2) {
    line[screen.cursor.col + 1] = "";
  }
  screen.cursor.col += width;
}

/**
 * Blank cells `[from, to)` of one line.
 *
 * @param screen the screen being replayed onto
 * @param row the line's index in `lines`
 * @param from the first cell blanked
 * @param to one past the last cell blanked
 */
function blank({ screen, row, from, to }: { screen: Screen; row: number; from: number; to: number }): void {
  if (row >= screen.lines.length) {
    return;
  }
  const line = screen.lines[row]!;
  for (let col = from; col < Math.min(to, line.length); col += 1) {
    line[col] = undefined;
  }
}

/**
 * Erase in display (`ESC[nJ`): below the cursor, above it, or the whole viewport.
 *
 * @param screen the screen being replayed onto
 * @param mode the CSI's first parameter, 0 when absent
 */
function eraseDisplay({ screen, mode }: { screen: Screen; mode: number }): void {
  const { col, row } = screen.cursor;
  const bottom = screen.top + screen.rows - 1;
  if (mode === 0) {
    blank({ from: col, row, screen, to: screen.columns });
    for (let line = row + 1; line <= bottom; line += 1) {
      blank({ from: 0, row: line, screen, to: screen.columns });
    }
    return;
  }
  if (mode === 1) {
    for (let line = screen.top; line < row; line += 1) {
      blank({ from: 0, row: line, screen, to: screen.columns });
    }
    blank({ from: 0, row, screen, to: col + 1 });
    return;
  }
  for (let line = screen.top; line <= bottom; line += 1) {
    blank({ from: 0, row: line, screen, to: screen.columns });
  }
}

/**
 * Erase in line (`ESC[nK`): right of the cursor, left of it, or the whole line.
 *
 * @param screen the screen being replayed onto
 * @param mode the CSI's first parameter, 0 when absent
 */
function eraseLine({ screen, mode }: { screen: Screen; mode: number }): void {
  const { col, row } = screen.cursor;
  if (mode === 0) {
    blank({ from: col, row, screen, to: screen.columns });
    return;
  }
  if (mode === 1) {
    blank({ from: 0, row, screen, to: col + 1 });
    return;
  }
  blank({ from: 0, row, screen, to: screen.columns });
}

/**
 * Keep a number inside `[low, high]`.
 *
 * @param value the number
 * @param low the smallest answer
 * @param high the largest answer
 * @returns the clamped number
 */
function clamp({ value, low, high }: { value: number; low: number; high: number }): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Apply one complete, non-private CSI sequence. Anything that does not move the cursor or erase — colour
 * (`m`), scroll regions (`r`), the rest — is ignored, because it puts nothing on screen.
 *
 * @param screen the screen being replayed onto
 * @param params the numeric parameters, `undefined` where one was left empty
 * @param final the sequence's final byte
 */
function applyCsi({
  screen,
  params,
  final,
}: {
  screen: Screen;
  params: readonly (number | undefined)[];
  final: string;
}): void {
  const [first, second] = params;
  const count = first === undefined || first === 0 ? 1 : first;
  // An absent parameter selects mode 0, the VT default.
  let mode = 0;
  if (first !== undefined) {
    mode = first;
  }
  const cursor = screen.cursor;
  const bottom = screen.top + screen.rows - 1;
  switch (final) {
    case "A":
      cursor.row = Math.max(screen.top, cursor.row - count);
      return;
    case "B":
      cursor.row = Math.min(bottom, cursor.row + count);
      return;
    case "C":
      cursor.col = Math.min(screen.columns - 1, cursor.col + count);
      return;
    case "D":
      cursor.col = Math.max(0, cursor.col - count);
      return;
    case "G":
      cursor.col = clamp({ high: screen.columns - 1, low: 0, value: count - 1 });
      return;
    case "H":
    case "f": {
      const column = second === undefined || second === 0 ? 1 : second;
      cursor.row = clamp({ high: bottom, low: screen.top, value: screen.top + count - 1 });
      cursor.col = clamp({ high: screen.columns - 1, low: 0, value: column - 1 });
      return;
    }
    case "J":
      eraseDisplay({ mode, screen });
      return;
    case "K":
      eraseLine({ mode, screen });
      return;
    case "X":
      blank({ from: cursor.col, row: cursor.row, screen, to: cursor.col + count });
      return;
    default:
      return;
  }
}

/**
 * Read one CSI sequence starting just past `ESC [`, and apply it unless it is private.
 *
 * @param screen the screen being replayed onto
 * @param chars the recording, one code point per element
 * @param start the index of the first byte after `ESC [`
 * @returns the index just past the sequence's final byte
 */
function consumeCsi({ screen, chars, start }: { screen: Screen; chars: readonly string[]; start: number }): number {
  let index = start;
  let body = "";
  while (index < chars.length && CSI_PARAM.test(chars[index]!)) {
    body += chars[index]!;
    index += 1;
  }
  while (index < chars.length && CSI_INTERMEDIATE.test(chars[index]!)) {
    index += 1;
  }
  if (index >= chars.length) {
    return index;
  }
  const final = chars[index]!;
  if (!CSI_PRIVATE.has(body.charAt(0))) {
    const params = body.split(";").map((part) => (part === "" ? undefined : Number.parseInt(part, 10)));
    applyCsi({ final, params, screen });
  }
  return index + 1;
}

/**
 * Skip a control string (OSC, DCS, SOS, PM, APC) through its BEL or `ESC \` terminator. An OSC 8 hyperlink's
 * URL lives here, and is not on screen.
 *
 * @param chars the recording, one code point per element
 * @param start the index of the first byte after the opener
 * @returns the index just past the terminator, or the end of the recording
 */
function skipString({ chars, start }: { chars: readonly string[]; start: number }): number {
  for (let index = start; index < chars.length; index += 1) {
    if (chars[index] === "\u0007") {
      return index + 1;
    }
    if (chars[index] === "\u001b" && chars[index + 1] === "\\") {
      return index + 2;
    }
  }
  return chars.length;
}

/**
 * Handle one escape sequence starting at `ESC`.
 *
 * @param screen the screen being replayed onto
 * @param chars the recording, one code point per element
 * @param start the index of the `ESC`
 * @returns the index just past the sequence
 */
function consumeEscape({ screen, chars, start }: { screen: Screen; chars: readonly string[]; start: number }): number {
  const next = chars[start + 1];
  if (next === undefined) {
    return start + 1;
  }
  if (next === "[") {
    return consumeCsi({ chars, screen, start: start + 2 });
  }
  if (STRING_OPENERS.has(next)) {
    return skipString({ chars, start: start + 2 });
  }
  if (next === "7") {
    screen.saved = { ...screen.cursor };
    return start + 2;
  }
  if (next === "8") {
    screen.cursor = { ...screen.saved };
    return start + 2;
  }
  if (CHARSET_OPENERS.has(next)) {
    return start + 3;
  }
  return start + 2;
}

/**
 * Apply one C0 control character; any other is ignored.
 *
 * @param screen the screen being replayed onto
 * @param char the control character
 */
function control({ screen, char }: { screen: Screen; char: string }): void {
  switch (char) {
    case "\r":
      screen.cursor.col = 0;
      return;
    case "\n":
    case "\u000b":
    case "\f":
      lineFeed({ screen });
      return;
    case "\b":
      screen.cursor.col = Math.max(0, screen.cursor.col - 1);
      return;
    case "\t":
      screen.cursor.col = Math.min(screen.columns - 1, (Math.floor(screen.cursor.col / TAB_WIDTH) + 1) * TAB_WIDTH);
      return;
    default:
      return;
  }
}

/**
 * Replay a pseudo-terminal's recorded output and answer every line it leaves on screen, scrolled-off history
 * first, each with its trailing blanks trimmed. A cell the recording jumped over keeps whatever was there
 * before — which is the whole point: see the file overview.
 *
 * @param raw the bytes the terminal received, escape sequences included
 * @param columns the terminal's width, as the program that recorded it set it
 * @param rows the terminal's height, as the program that recorded it set it
 * @returns the screen's lines, top to bottom
 */
export function replayScreen({
  raw,
  columns,
  rows,
}: {
  raw: string;
  columns: number;
  rows: number;
}): readonly string[] {
  const screen: Screen = { columns, cursor: { col: 0, row: 0 }, lines: [[]], rows, saved: { col: 0, row: 0 }, top: 0 };
  const chars = Array.from(raw);
  let index = 0;
  while (index < chars.length) {
    const char = chars[index]!;
    if (char === "\u001b") {
      index = consumeEscape({ chars, screen, start: index });
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      control({ char, screen });
    } else {
      draw({ char, screen });
    }
    index += 1;
  }
  return screen.lines.map((line) =>
    Array.from(line, (cell) => {
      // A cell nothing ever wrote shows as a blank, as a terminal shows it.
      if (cell === undefined) {
        return " ";
      }
      return cell;
    })
      .join("")
      .trimEnd(),
  );
}
