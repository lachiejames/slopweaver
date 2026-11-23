/**
 * The authoring file's per-section grammars, in both directions: a proof slot, the `- ` bullet lists, the "Not
 * checked, and why" lines and the re-run blocks, plus the cell helpers every section parser shares.
 *
 * A line joining two fields is split on a separator a field cannot carry: a "Not checked" line's ` — ` is escaped
 * wherever its text carries one and found only outside every inline construct (`./authoringInline.ts`'s
 * `topLevelIndexOf`).
 */
import { isRecord } from "../../lib/parsers.js";
import { imageAt, parseInlineContent, renderContent, renderImage, topLevelIndexOf } from "./authoringInline.js";
import type { CheckGroup, Content, ProofSlot, RerunItem, UncheckedItem } from "./types.js";

/** The separator between what was not checked and why. */
const UNCHECKED_SEPARATOR = " — ";

/** A reason slot's one line opens with this. */
const REASON_PREFIX = "reason: ";

/** A screenshot slot's last line names who ran it. */
const RUN_BY = /^run by: (owner|agent)$/;

/** A fenced code block's opening line. */
const CODE_OPEN = /^(`{3,})([A-Za-z0-9_+-]*)\n/;

/**
 * Whether a parse step declined.
 *
 * @param value a parse step's result
 * @returns true when it carries an `error` string rather than a value
 */
export function declined(value: unknown): value is { readonly error: string } {
  return isRecord(value) && typeof value["error"] === "string";
}

/**
 * One cell's inline content, its decline prefixed with where it sits.
 *
 * @param source the cell's raw markdown
 * @param where the section label a decline is prefixed with
 * @returns the parsed content, or the decline
 */
export function cell({ source, where }: { source: string; where: string }): Content | { readonly error: string } {
  const parsed = parseInlineContent({ source });
  return "error" in parsed ? { error: `${where}: ${parsed.error}` } : parsed.content;
}

/**
 * A section's non-blank lines.
 *
 * @param source the section's raw text
 * @returns every line carrying more than whitespace, in order
 */
function linesOf({ source }: { source: string }): readonly string[] {
  return source.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * A proof slot as its section's lines: `reason: <why>`, or the line it proves, the picture and who ran it.
 *
 * @returns the section's lines
 */
export function renderProofSlotLines({ slot }: { slot: ProofSlot }): string {
  if (slot.kind === "reason") {
    return `${REASON_PREFIX}${renderContent({ content: slot.reason })}`;
  }
  return [renderContent({ content: slot.proves }), renderImage({ image: slot.image }), `run by: ${slot.runBy}`].join(
    "\n",
  );
}

/**
 * A proof slot's section, as the form's field.
 *
 * @param source the section's raw text
 * @param section the section header a decline names
 * @returns the zod candidate for the slot, or a decline naming the two shapes
 */
export function parseProofSlot({
  source,
  section,
}: {
  source: string;
  section: string;
}): Record<string, unknown> | { readonly error: string } {
  const lines = linesOf({ source });
  const shape = {
    error:
      `## ${section}: the section is one line "reason: <why there is no screenshot>", or three: the line the ` +
      'screenshot proves, "![alt](url)" (optionally "{width=N}") alone on its line, and "run by: owner" or "run by: agent"',
  };
  if (lines.length === 1 && lines[0]!.startsWith(REASON_PREFIX)) {
    const reason = cell({ source: lines[0]!.slice(REASON_PREFIX.length), where: `## ${section}` });
    return declined(reason) ? reason : { kind: "reason", reason };
  }
  if (lines.length !== 3) {
    return shape;
  }
  const proves = cell({ source: lines[0]!, where: `## ${section}` });
  const image = imageAt({ rest: lines[1]! });
  const runBy = RUN_BY.exec(lines[2]!);
  if (declined(proves)) {
    return proves;
  }
  if (image !== undefined && "error" in image) {
    return { error: `## ${section} image: ${image.error}` };
  }
  if (image === undefined || image.length !== lines[1]!.length || runBy === null) {
    return shape;
  }
  return { image: image.run, kind: "screenshot", proves, runBy: runBy[1] };
}

/**
 * A list of cells as `- ` bullet lines.
 *
 * @param cells the cells, in order
 * @returns one bullet line per cell
 */
export function renderBullets({ cells }: { cells: readonly Content[] }): string {
  return cells.map((content) => `- ${renderContent({ content })}`).join("\n");
}

/**
 * A list section's `- ` bullets as cells.
 *
 * @param source the section's raw text
 * @param section the section header a decline names
 * @returns the cells, or the first decline
 */
export function parseBullets({
  source,
  section,
}: {
  source: string;
  section: string;
}): readonly Content[] | { readonly error: string } {
  const cells: Content[] = [];
  for (const line of linesOf({ source })) {
    if (!line.startsWith("- ")) {
      return { error: `## ${section}: every line is a \`- \` bullet, and "${line}" is not` };
    }
    const parsed = cell({ source: line.slice(2), where: `## ${section}` });
    if (declined(parsed)) {
      return parsed;
    }
    cells.push(parsed);
  }
  return cells;
}

/** How a grouped check is indented under its group's label in the Checks section. */
const GROUP_ITEM = "  - ";

/**
 * The Checks section: one `- ` bullet per base check, then each group as a `- <label>` bullet with its checks
 * indented under it as `  - ` bullets.
 *
 * @param checks the base checks, every reader's group, written first
 * @param checkGroups the labelled groups, written after
 * @returns the section's lines
 */
export function renderCheckBullets({
  checks,
  checkGroups,
}: {
  checks: readonly Content[];
  checkGroups: readonly CheckGroup[];
}): string {
  const groups = checkGroups.map((group) =>
    [
      `- ${renderContent({ content: group.label })}`,
      ...group.items.map((content) => `${GROUP_ITEM}${renderContent({ content })}`),
    ].join("\n"),
  );
  return [...(checks.length === 0 ? [] : [renderBullets({ cells: checks })]), ...groups].join("\n");
}

/** Where a Checks decline sits. */
const CHECKS_WHERE = "## Checks";

/** One `- ` bullet of the Checks section and the raw `  - ` bullets indented under it. */
interface CheckRow {
  readonly label: string;
  readonly items: string[];
}

/** The Checks section's lines as rows: a `- ` bullet opens one, a `  - ` bullet joins the open one. */
function checkRowsOf({ source }: { source: string }): readonly CheckRow[] | { readonly error: string } {
  const rows: CheckRow[] = [];
  for (const line of linesOf({ source })) {
    if (line.startsWith(GROUP_ITEM) && rows.length > 0) {
      rows.at(-1)!.items.push(line.slice(GROUP_ITEM.length));
    } else if (line.startsWith("- ")) {
      rows.push({ items: [], label: line.slice(2) });
    } else {
      return {
        error: `${CHECKS_WHERE}: every line is a \`- \` bullet, or a \`  - \` bullet under one, and "${line}" is not`,
      };
    }
  }
  return rows;
}

/** One row read: a base check when nothing is indented under it, else a group. */
function checkRowOf({
  row,
}: {
  row: CheckRow;
}): { readonly check: Content } | { readonly group: CheckGroup } | { readonly error: string } {
  const label = cell({ source: row.label, where: CHECKS_WHERE });
  if (declined(label)) {
    return label;
  }
  if (row.items.length === 0) {
    return { check: label };
  }
  const items: Content[] = [];
  for (const item of row.items) {
    const parsed = cell({ source: item, where: CHECKS_WHERE });
    if (declined(parsed)) {
      return parsed;
    }
    items.push(parsed);
  }
  return { group: { items, label } };
}

/**
 * The Checks section read back: a `- ` bullet with `  - ` bullets under it is a group and its label, any other `- `
 * bullet a base check. Base checks come first, as they render.
 *
 * @param source the section's raw text
 * @returns the base checks and the groups, or the first decline
 */
export function parseCheckBullets({
  source,
}: {
  source: string;
}): { readonly checks: readonly Content[]; readonly checkGroups: readonly CheckGroup[] } | { readonly error: string } {
  const rows = checkRowsOf({ source });
  if (declined(rows)) {
    return rows;
  }
  const checks: Content[] = [];
  const checkGroups: CheckGroup[] = [];
  for (const row of rows) {
    const read = checkRowOf({ row });
    if (declined(read)) {
      return read;
    }
    if ("group" in read) {
      checkGroups.push(read.group);
    } else if (checkGroups.length > 0) {
      return {
        error: `${CHECKS_WHERE}: the checks with no group come first, before every group, and one follows a group`,
      };
    } else {
      checks.push(read.check);
    }
  }
  return { checkGroups, checks };
}

/** A cell with every em dash in a text run escaped, so only the separator splits the line. */
function escapedDashes({ content }: { content: Content }): string {
  return content
    .map((run) => {
      const rendered = renderContent({ content: [run] });
      return run.kind === "text" ? rendered.replaceAll("—", "\\—") : rendered;
    })
    .join("");
}

/**
 * The "Not checked, and why" section: one `- <check> — <why>` line per item.
 *
 * @param items the items, in order
 * @returns the section's lines
 */
export function renderUncheckedLines({ items }: { items: readonly UncheckedItem[] }): string {
  return items
    .map(
      (item) =>
        `- ${escapedDashes({ content: item.check })}${UNCHECKED_SEPARATOR}${renderContent({ content: item.why })}`,
    )
    .join("\n");
}

/**
 * The "Not checked, and why" section's lines, as the form's items.
 *
 * @param source the section's raw text
 * @returns the zod candidates, or the first decline
 */
export function parseUncheckedLines({ source }: { source: string }): readonly unknown[] | { readonly error: string } {
  const items: unknown[] = [];
  for (const line of linesOf({ source })) {
    const rest = line.startsWith("- ") ? line.slice(2) : "";
    const at = topLevelIndexOf({ separator: UNCHECKED_SEPARATOR, source: rest });
    if (at < 0) {
      return { error: `## Not checked, and why: "${line}" is not "- <what was not checked> — <why>"` };
    }
    const check = cell({ source: rest.slice(0, at), where: "## Not checked, and why" });
    const why = cell({ source: rest.slice(at + UNCHECKED_SEPARATOR.length), where: "## Not checked, and why" });
    if (declined(check)) {
      return check;
    }
    if (declined(why)) {
      return why;
    }
    items.push({ check, why });
  }
  return items;
}

/** A fenced code block, its fence longer than any backtick run inside. */
function renderCodeBlock({ lang, text }: { lang: string; text: string }): string {
  const longestRun = [...text.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${lang}\n${text}\n${fence}`;
}

/**
 * The re-run section: a fenced block per command, a bullet list per test list, a paragraph per note, a blank line
 * between each.
 *
 * @param items the re-run items
 * @returns the section's text
 */
export function renderRerunBlocks({ items }: { items: readonly RerunItem[] }): string {
  return items
    .map((item) => {
      if (item.kind === "command") {
        return renderCodeBlock(item);
      }
      if (item.kind === "tests") {
        return renderBullets({ cells: item.items });
      }
      return renderContent({ content: item.content });
    })
    .join("\n\n");
}

/** One re-run block at `at`, and where it ends; a decline when it is none of the three. */
function takeRerunBlock({
  source,
  at,
}: {
  source: string;
  at: number;
}): { item: Record<string, unknown>; next: number } | { error: string } {
  const opened = CODE_OPEN.exec(source.slice(at));
  if (opened !== null) {
    const fence = opened[1]!;
    const bodyAt = at + opened[0].length;
    const closeAt = source.indexOf(`\n${fence}`, bodyAt);
    if (closeAt < 0) {
      return { error: `an unclosed fenced code block — it opens with ${fence} but nothing closes it` };
    }
    const item = { kind: "command", lang: opened[2]!, text: source.slice(bodyAt, closeAt) };
    return { item, next: closeAt + 1 + fence.length };
  }
  const blank = source.indexOf("\n\n", at);
  const next = blank < 0 ? source.length : blank;
  const block = source.slice(at, next);
  if (block.startsWith("- ")) {
    const items = parseBullets({ section: "Re-run", source: block });
    return declined(items) ? items : { item: { items, kind: "tests" }, next };
  }
  const content = cell({ source: block, where: "## Re-run" });
  return declined(content) ? content : { item: { content, kind: "note" }, next };
}

/**
 * The re-run section's blocks, as the form's items.
 *
 * @param source the section's raw text
 * @returns the zod candidates, or the first decline
 */
export function parseRerunBlocks({ source }: { source: string }): readonly unknown[] | { readonly error: string } {
  const trimmed = source.trim();
  const items: unknown[] = [];
  let at = 0;
  while (at < trimmed.length) {
    const taken = takeRerunBlock({ at, source: trimmed });
    if ("error" in taken) {
      return { error: `## Re-run: ${taken.error}` };
    }
    items.push(taken.item);
    if (taken.next < trimmed.length && !trimmed.startsWith("\n\n", taken.next)) {
      return { error: "## Re-run: blocks must be separated by a blank line" };
    }
    at = taken.next === trimmed.length ? taken.next : taken.next + 2;
  }
  return items;
}
