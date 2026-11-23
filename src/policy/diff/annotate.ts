/**
 * Attach the record's reasons to the aligned rows, and refuse the diff when a material row has none.
 *
 * Every material row must be claimed by exactly ONE change entry, and every entry must claim at least one row. Both
 * directions are checked because both failures are silent otherwise: an unclaimed row is a change shipped with no
 * reason given, and an entry claiming nothing is a reason describing a change the documents no longer make.
 *
 * Marks are looser on purpose — a mark colours whatever lines it matches, unchanged ones included, because a fact the
 * owner is weighing lands on lines whether or not they moved. A mark that matches nothing is still refused.
 *
 * Matching is a case-insensitive substring test against a row's plain text (`./units.ts`'s `plainText`), on the
 * after side, plus the before side for a row that has one. A change's `line` is compared whole instead, for a row
 * whose entire text is a prefix of other lines — a bare path in an index — and so no substring can single out.
 *
 * Pure.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type DiffRow, isMaterial } from "./align.js";
import { type DocDiffIssue, DocDiffIssues } from "./issues.js";
import type { DocDiffChange, DocDiffDocument, DocDiffMark } from "./record.js";
import { plainText } from "./units.js";

/** A row with the change that explains it, if it is material, and every mark that lands on it. */
export interface AnnotatedRow extends DiffRow {
  readonly change: DocDiffChange | null;
  readonly marks: readonly DocDiffMark[];
}

/** One side of a row as the lowercased plain text a match string is looked for in. */
function sideText({ row, side }: { row: DiffRow; side: "after" | "before" }): string {
  return plainText({ markdown: row[side].map((unit) => unit.raw).join(" ") }).toLowerCase();
}

/** Whether any of an entry's match strings occurs in any of the given texts. */
function matches({ match, texts }: { match: readonly string[]; texts: readonly string[] }): boolean {
  return match.some((needle) => {
    const wanted = plainText({ markdown: needle }).toLowerCase();
    return texts.some((text) => text.includes(wanted));
  });
}

/** Whether a change claims a row: a match string inside it, or a `line` that is one of its sides whole. */
function claims({ change, texts }: { change: DocDiffChange; texts: readonly string[] }): boolean {
  if (change.line?.some((whole) => texts.includes(plainText({ markdown: whole }).toLowerCase())) === true) {
    return true;
  }
  return matches({ match: change.match, texts });
}

/** The texts a row is matched against: both sides that exist. */
function textsOf({ row }: { row: DiffRow }): readonly string[] {
  return [sideText({ row, side: "after" }), sideText({ row, side: "before" })].filter((text) => text !== "");
}

/** The text an issue quotes for a row: its after side, or its before side when it was removed. */
function quotedText({ row }: { row: DiffRow }): { text: string; side: "after" | "before" } {
  if (row.after.length === 0) {
    return { side: "before", text: plainText({ markdown: row.before.map((unit) => unit.raw).join(" ") }) };
  }
  return { side: "after", text: plainText({ markdown: row.after.map((unit) => unit.raw).join(" ") }) };
}

/**
 * Attach changes and marks to one document's rows.
 *
 * @param rows the aligned rows of one document
 * @param document the record's entry for that document
 * @returns the annotated rows, or every coverage problem found
 */
export function annotateRows({
  rows,
  document,
}: {
  rows: readonly DiffRow[];
  document: DocDiffDocument;
}): Result<readonly AnnotatedRow[], readonly DocDiffIssue[]> {
  const issues: DocDiffIssue[] = [];
  const usedChanges = new Set<string>();
  const usedMarks = new Set<string>();
  const annotated = rows.map((row): AnnotatedRow => {
    const texts = textsOf({ row });
    const marks = document.marks.filter((mark) => matches({ match: mark.match, texts }));
    for (const mark of marks) {
      usedMarks.add(mark.id);
    }
    if (!isMaterial({ kind: row.kind })) {
      return { ...row, change: null, marks };
    }
    const claiming = document.changes.filter((change) => claims({ change, texts }));
    for (const change of claiming) {
      usedChanges.add(change.id);
    }
    const quoted = quotedText({ row });
    if (claiming.length === 0) {
      issues.push(DocDiffIssues.uncoveredRow({ document: document.id, side: quoted.side, text: quoted.text }));
      return { ...row, change: null, marks };
    }
    if (claiming.length > 1) {
      issues.push(
        DocDiffIssues.ambiguousRow({
          document: document.id,
          ids: claiming.map((change) => change.id),
          text: quoted.text,
        }),
      );
    }
    return { ...row, change: claiming[0]!, marks };
  });
  for (const change of document.changes) {
    if (!usedChanges.has(change.id)) {
      issues.push(DocDiffIssues.unusedEntry({ document: document.id, entry: change.id, kind: "change" }));
    }
  }
  for (const mark of document.marks) {
    if (!usedMarks.has(mark.id)) {
      issues.push(DocDiffIssues.unusedEntry({ document: document.id, entry: mark.id, kind: "mark" }));
    }
  }
  if (issues.length > 0) {
    return err(issues);
  }
  return ok(annotated);
}
