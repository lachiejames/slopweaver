/**
 * What is sitting in a Claude Code session's prompt box, and WHO put it there.
 *
 * ## The incident this module closes
 *
 * A prompt line such as `approved, land it` on a screen is not necessarily a typed line: it can be a suggestion,
 * and that class of failure is fixed here. A
 * supervisor had read that line off a screen and weighed it as a ruling the owner might have typed. It was
 * not typed by anybody — Claude Code had GENERATED it as a prompt suggestion and drawn it, grey, into the
 * composer.
 *
 * `surface.read_text` cannot see the difference, and that is a property of the method rather than a bug in
 * the caller: it answers plain UTF-8 with no escape sequences (`./renderGrid.ts` carries that measurement and
 * the five parameter spellings probed for one). So every reader built on it was blind by construction.
 *
 * ## What the fix reads instead, measured rather than assumed
 *
 * MEASURED on one scratch cmux workspace (cmux 0.64.22, Claude Code 2.1.263), three captures of
 * `terminal.replay` on the same composer row minutes apart — the committed fixtures under
 * `src/__tests__/fixtures/composer/`, reproduce with `slopweaver cmux read-screen --workspace <ref> --json`:
 *
 * | what was in the box | `surface.read_text` says | the grid's composer span says |
 * | ------------------- | ------------------------ | ----------------------------- |
 * | typed `approved, land it` | `❯ approved, land it` | one span, `faint: false` |
 * | a generated suggestion | `❯ it's probably in the home directory, check ~/hello.txt` | its own span, `faint: true` |
 * | the empty-session placeholder | `❯ Try "create a util logging.py that..."` | its own span, `faint: true` |
 *
 * So the rule is one bit: **composer text drawn faint was not typed.** Claude Code draws both things it wrote
 * itself — the prompt suggestion and the `Try "…"` placeholder — in the terminal's dim attribute, and a
 * human's keystrokes in the normal one. The cursor column corroborates it (2, hard against the prompt, for
 * both machine shapes; 19, at the end of the words, for the typed one) but is NOT what this module decides
 * on: a suggestion offered while a half-typed line is in the buffer would move the cursor and leave the
 * faint attribute exactly where it is.
 *
 * ## An unrecognised composer is `unreadable`, never `typed`
 *
 * The same honesty `./turnBusy.ts` keeps: a verdict is only ever reached about chrome positively recognised
 * here. Claude Code's composer prompt is `❯` followed by a NON-BREAKING space (U+00A0) — measured, and it is
 * what separates the live box from the ordinary-space `❯ ` the transcript echoes a SUBMITTED prompt with
 * further up the same screen. A screen with no such row, a grid with no visible cursor, or any other host
 * answers `unreadable`, because answering `typed` because nothing matched would rebuild the exact
 * over-claim the incident was.
 */
import type { CmuxGridCursor, CmuxRenderGrid, CmuxRowSpan } from "./renderGrid.js";

/** What the prompt box holds, and whether a person put it there. */
export type ComposerReading =
  /** Nothing is in the box. */
  | { readonly kind: "empty" }
  /** Text drawn in the normal attribute: unsubmitted keystrokes. Still UNSUBMITTED — see {@link composerIsFromAPerson}. */
  | { readonly kind: "typed"; readonly text: string }
  /** Text Claude Code generated and drew faint, offered for the reader to accept. */
  | { readonly kind: "suggestion"; readonly text: string }
  /** The faint `Try "…"` hint an empty session draws — Claude Code's own, never anybody's input. */
  | { readonly kind: "placeholder"; readonly text: string }
  /** No composer this module has measured could be found, so nothing may be claimed about the box. */
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Claude Code's live composer prompt: a chevron and a NON-BREAKING space. The ordinary-space `❯ ` further up
 * the screen is the transcript's echo of an already-submitted prompt, and matching that would read a
 * submitted line as though it were still in the box.
 */
const COMPOSER_PROMPT = "\u276f\u00a0";

/** The faint hint an empty Claude Code session draws in place of a suggestion. */
const PLACEHOLDER_PATTERN = /^Try\s+"/u;

/** A row drawn entirely from the box-drawing rule Claude Code frames its composer with. */
function isRuleRow({ line }: { line: string }): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^─+$/u.test(trimmed);
}

/** Every span on one row, left to right. */
function spansByRow({ grid }: { grid: CmuxRenderGrid }): Map<number, readonly CmuxRowSpan[]> {
  const rows = new Map<number, CmuxRowSpan[]>();
  for (const span of grid.spans) {
    const existing = rows.get(span.row);
    if (existing === undefined) {
      rows.set(span.row, [span]);
    } else {
      existing.push(span);
    }
  }
  const ordered = new Map<number, readonly CmuxRowSpan[]>();
  for (const [row, spans] of rows) {
    ordered.set(
      row,
      spans.toSorted((left, right) => left.column - right.column),
    );
  }
  return ordered;
}

/**
 * The spans drawn on one screen row. cmux's grid carries a span only where a cell has ink, so a row with
 * nothing drawn on it arrives with no span at all: it is a BLANK row, read as no spans, never a failed read.
 */
function spansOnRow({
  byRow,
  row,
}: {
  byRow: Map<number, readonly CmuxRowSpan[]>;
  row: number;
}): readonly CmuxRowSpan[] {
  const spans = byRow.get(row);
  if (spans === undefined) {
    return [];
  }
  return spans;
}

/**
 * The text of one row, laid out by COLUMN rather than concatenated.
 *
 * Measured, and it is why this is not a `map(...).join("")`: a live composer row does not arrive as one span.
 * cmux splits it — the cell under the cursor becomes its own run — and the runs of spaces between the words
 * can be omitted entirely, so joining what arrives turned `approved, land it` into `approved,landit` on the
 * first live read of the shipped verb. Placing each span at its own column reproduces what the terminal
 * actually shows, gaps included.
 */
function rowText({ spans }: { spans: readonly CmuxRowSpan[] }): string {
  let line = "";
  for (const span of spans) {
    line = line.length < span.column ? line.padEnd(span.column, " ") : line.slice(0, span.column);
    line += span.text;
  }
  return line;
}

/**
 * The row the composer's prompt sits on: the nearest one at or above the cursor that starts with the prompt
 * when the cursor is visible, and otherwise the LAST such row on the screen.
 *
 * The fallback is not a convenience. MEASURED live: Claude Code hides the terminal cursor for the
 * whole of a running turn and while a permission dialog is up, so a cursor-only rule answered `unreadable`
 * for two solid minutes on a perfectly readable screen — which is most of what a supervisor sweeps. The
 * prompt itself is the sound anchor: `❯` + a NON-BREAKING space appears only in the live box, never in the
 * ordinary-space echo of a submitted prompt further up the same screen.
 */
function composerPromptRow({
  byRow,
  cursor,
}: {
  byRow: Map<number, readonly CmuxRowSpan[]>;
  cursor: CmuxGridCursor | undefined;
}): number | undefined {
  const startsWithPrompt = ({ row }: { row: number }): boolean =>
    rowText({ spans: spansOnRow({ byRow, row }) }).startsWith(COMPOSER_PROMPT);
  if (cursor?.visible === true) {
    for (let row = cursor.row; row >= 0; row -= 1) {
      if (isRuleRow({ line: rowText({ spans: spansOnRow({ byRow, row }) }) })) {
        break;
      }
      if (startsWithPrompt({ row })) {
        return row;
      }
    }
    return undefined;
  }
  const matches = [...byRow.keys()].filter((row) => startsWithPrompt({ row }));
  return matches.length === 0 ? undefined : Math.max(...matches);
}

/**
 * The rows the composer occupies: its prompt row, then every row below it up to the rule that closes the
 * box — which is what carries a wrapped line's continuation rows.
 */
function composerRows({
  byRow,
  cursor,
}: {
  byRow: Map<number, readonly CmuxRowSpan[]>;
  cursor: CmuxGridCursor | undefined;
}): readonly number[] {
  const opening = composerPromptRow({ byRow, cursor });
  if (opening === undefined) {
    return [];
  }
  const collected: number[] = [opening];
  const highest = Math.max(...byRow.keys());
  for (let row = opening + 1; row <= highest; row += 1) {
    if (isRuleRow({ line: rowText({ spans: spansOnRow({ byRow, row }) }) })) {
      break;
    }
    collected.push(row);
  }
  return collected;
}

/**
 * Read the prompt box off a styled grid, naming who put its contents there.
 *
 * @param grid the styled grid from `terminal.replay`, parsed by `./renderGrid.ts`
 * @returns what the box holds — or `unreadable`, which is a real answer and not a failure
 */
export function readComposer({ grid }: { grid: CmuxRenderGrid }): ComposerReading {
  const byRow = spansByRow({ grid });
  const rows = composerRows({ byRow, cursor: grid.cursor });
  const firstRow = rows[0];
  if (firstRow === undefined) {
    return {
      kind: "unreadable",
      reason:
        "no Claude Code composer prompt is on the screen — a menu or permission prompt has replaced it, or this is another host",
    };
  }
  const styles = new Map(grid.styles.map((style) => [style.id, style]));
  const text = rows
    .map((row) => {
      const line = rowText({ spans: spansOnRow({ byRow, row }) });
      return row === firstRow ? line.slice(COMPOSER_PROMPT.length) : line;
    })
    .join("")
    .trim();
  if (text.length === 0) {
    return { kind: "empty" };
  }
  // Whitespace carries no attribute a terminal can be read for, so the verdict is decided by the spans that
  // actually have ink in them — the prompt chevron itself excluded, since it is chrome rather than content.
  const content = rows.flatMap((row) =>
    spansOnRow({ byRow, row }).filter((span) => {
      const ink = row === firstRow && span.column === 0 ? span.text.slice(COMPOSER_PROMPT.length) : span.text;
      return ink.trim().length > 0;
    }),
  );
  const everySpanIsFaint = content.every((span) => styles.get(span.styleId)?.faint === true);
  if (!everySpanIsFaint) {
    return { kind: "typed", text };
  }
  return PLACEHOLDER_PATTERN.test(text) ? { kind: "placeholder", text } : { kind: "suggestion", text };
}

/**
 * Whether a reading is text a PERSON put in the box — the one question a supervisor is actually asking when
 * it reads a prompt line, and the one the plain-text read answered wrongly.
 *
 * `unreadable` answers false: not knowing is not evidence that a person typed it.
 *
 * @param reading what {@link readComposer} said
 * @returns whether the box's contents came from a person's keystrokes
 */
export function composerIsFromAPerson({ reading }: { reading: ComposerReading }): boolean {
  return reading.kind === "typed";
}

/**
 * The one line a verb prints for a reading — carrying the warning where the answer is machine-written, and
 * the standing fact that composer text is UNSUBMITTED whoever wrote it.
 *
 * @param reading what {@link readComposer} said
 * @returns the line to print
 */
export function describeComposer({ reading }: { reading: ComposerReading }): string {
  switch (reading.kind) {
    case "empty":
      return "composer: empty";
    case "typed":
      return `composer: TYPED, unsubmitted — ${reading.text}`;
    case "suggestion":
      return `composer: a SUGGESTION Claude Code generated, not typed by anyone — ${reading.text}`;
    case "placeholder":
      return `composer: Claude Code's empty-session placeholder, not typed by anyone — ${reading.text}`;
    case "unreadable":
      return `composer: UNREADABLE — ${reading.reason}; do not treat what the screen shows in the prompt box as typed`;
    default: {
      const exhaustive: never = reading;
      return exhaustive;
    }
  }
}
