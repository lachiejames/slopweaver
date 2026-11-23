/** How `slopweaver linear issues` prints the document `./issues.ts` reads. Pure. */

import type { LinearIssueRow, LinearIssuesDocument } from "./issues.js";

/**
 * Render an issues document as stable, pretty JSON.
 *
 * @param document the issues document
 * @returns one JSON document
 */
export function renderLinearIssuesJson({ document }: { document: LinearIssuesDocument }): string {
  return JSON.stringify(document, undefined, 2);
}

/** The one-word lifecycle mark a row carries beside its identifier. Pure. */
function lifecycleMark({ row }: { row: LinearIssueRow }): string {
  if (row.archivedAt !== null) {
    return "  [archived]";
  }
  if (row.canceledAt !== null) {
    return "  [canceled]";
  }
  if (row.completedAt !== null) {
    return "  [completed]";
  }
  return "";
}

/**
 * The project cell of a row. An `if` that returns, because `no-silent-fallback` refuses the `??` and oxlint's
 * `prefer-nullish-coalescing` refuses the ternary that spells the same thing (`src/handover/askShape.ts`). Pure.
 */
function projectCell({ row }: { row: LinearIssueRow }): string {
  if (row.projectId === null) {
    return "(none)";
  }
  return row.projectId;
}

/**
 * Render an issues document as an operator-readable list: one row per issue, its project and creation date.
 *
 * @param document the issues document
 * @returns text naming the selection, the count, and every issue
 */
export function renderLinearIssuesText({ document }: { document: LinearIssuesDocument }): string {
  const scope = [
    document.team === undefined ? undefined : `team ${document.team.key} (${document.team.id})`,
    document.project === undefined ? undefined : `project "${document.project.name}" (${document.project.id})`,
    document.creator === "me" ? "filed by the token's own user" : undefined,
    document.createdSinceIso === undefined ? undefined : `created since ${document.createdSinceIso}`,
    "archived included",
  ].filter((part): part is string => part !== undefined);
  return [
    `linear issues: ${scope.join(" · ")}`,
    `read at: ${document.readAtIso}`,
    `issues (${String(document.issues.length)}):`,
    ...document.issues.map(
      (row) =>
        `  ${row.identifier}  ${row.createdAt.slice(0, 10)}  project ${projectCell({ row })}  ${row.title}${lifecycleMark({ row })}`,
    ),
  ].join("\n");
}
