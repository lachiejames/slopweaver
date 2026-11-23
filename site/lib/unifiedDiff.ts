/**
 * One file's patch as GitHub's "Files changed" tab draws it: every line numbered on the side it belongs to — the
 * old file's number on a removal, the new file's on an addition, both on context — and each `@@` header kept as
 * the row that separates two hunks. Pure, so the unit lane holds it; `../components/console/PullView.tsx` draws it.
 *
 * The input is GitHub's own `patch` field (`github read --files`, `src/live/github/pullFiles.ts`) or a review
 * comment's `diffHunk`: unified-diff hunks with no `---`/`+++` file header. A line that is none of the four
 * shapes a hunk may hold is kept as a `note` rather than dropped, so a patch this does not understand still shows
 * every byte GitHub sent.
 */

/** One drawn row of a patch. */
export type DiffLine =
  | { readonly kind: "hunk"; readonly text: string }
  | { readonly kind: "add"; readonly text: string; readonly newNo: number }
  | { readonly kind: "del"; readonly text: string; readonly oldNo: number }
  | { readonly kind: "context"; readonly text: string; readonly oldNo: number; readonly newNo: number }
  | { readonly kind: "note"; readonly text: string };

/** A hunk header: `@@ -<old>[,<n>] +<new>[,<n>] @@ <section>`. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/**
 * Number every line of a unified-diff patch.
 *
 * @param patch the hunks, `\n`-separated, as GitHub writes them
 * @returns one row per line, in order; an empty patch is no rows
 */
export function parseUnifiedDiff({ patch }: { patch: string }): readonly DiffLine[] {
  const out: DiffLine[] = [];
  if (patch === "") {
    return out;
  }
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header !== null) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      inHunk = true;
      out.push({ kind: "hunk", text: raw });
      continue;
    }
    const sign = raw.charAt(0);
    const text = raw.slice(1);
    if (inHunk && sign === "+") {
      out.push({ kind: "add", newNo, text });
      newNo += 1;
    } else if (inHunk && sign === "-") {
      out.push({ kind: "del", oldNo, text });
      oldNo += 1;
    } else if (inHunk && sign === " ") {
      out.push({ kind: "context", newNo, oldNo, text });
      oldNo += 1;
      newNo += 1;
    } else {
      // `\ No newline at end of file`, or anything outside a hunk: shown as written, numbered on neither side.
      out.push({ kind: "note", text: raw });
    }
  }
  return out;
}

/** The side of a diff a review thread's `line` counts on, as GitHub's `diffSide` names it. */
export type DiffSide = "LEFT" | "RIGHT";

/**
 * Hang each item under the row that draws its line on its own side, once, under the first such row. GitHub numbers
 * a review thread's `line` in the OLD file when its `diffSide` is `LEFT` — a comment on a removed line — and in the
 * new file when it is `RIGHT`, so one number means two different rows. An item whose line the patch does not show
 * is returned apart, so it is drawn after the file rather than lost.
 *
 * @param rows the parsed patch
 * @param items each item with the line it sits on and the side that line counts on
 * @returns the items by the index of the row they hang under, and the ones no row shows
 */
export function placeByLine<T>({
  rows,
  items,
}: {
  rows: readonly DiffLine[];
  items: readonly { readonly line: number; readonly side: DiffSide; readonly item: T }[];
}): { readonly byRow: ReadonlyMap<number, readonly T[]>; readonly unshown: readonly T[] } {
  const rowOfNew = new Map<number, number>();
  const rowOfOld = new Map<number, number>();
  rows.forEach((row, index) => {
    if ((row.kind === "add" || row.kind === "context") && !rowOfNew.has(row.newNo)) {
      rowOfNew.set(row.newNo, index);
    }
    if ((row.kind === "del" || row.kind === "context") && !rowOfOld.has(row.oldNo)) {
      rowOfOld.set(row.oldNo, index);
    }
  });
  const byRow = new Map<number, T[]>();
  const unshown: T[] = [];
  for (const { line, side, item } of items) {
    let index = rowOfNew.get(line);
    if (side === "LEFT") {
      index = rowOfOld.get(line);
    }
    if (index === undefined) {
      unshown.push(item);
      continue;
    }
    const held = byRow.get(index);
    if (held === undefined) {
      byRow.set(index, [item]);
    } else {
      held.push(item);
    }
  }
  return { byRow, unshown };
}

/**
 * The last rows of a review comment's hunk — the lines GitHub shows above an inline comment. A `diffHunk` runs
 * from its `@@` header down to the commented line, so its tail is the code the comment is about.
 *
 * @param hunk the comment's `diffHunk`
 * @param rows how many code rows to keep, counted from the end
 * @returns the kept rows, the `@@` header dropped when it would be cut from what it heads
 */
export function hunkTail({ hunk, rows }: { hunk: string; rows: number }): readonly DiffLine[] {
  const lines = parseUnifiedDiff({ patch: hunk });
  const code = lines.filter((line) => line.kind !== "hunk");
  if (code.length <= rows) {
    return lines;
  }
  return code.slice(code.length - rows);
}
