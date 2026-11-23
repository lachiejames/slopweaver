/*
 * What the Linear query-document text tests share: one hit built from only the fields the text rendering reads.
 */
import type { LinearQueryHit } from "../../../../../../corpus/linear/query.js";

/**
 * A hit carrying only the fields the text rendering reads. Every rendered value comes from the scenario; the
 * fields the renderer never reads are `undefined` (or one fixed instant), so none of them can leak into a line.
 *
 * @returns a complete hit, its unrendered facets unset and its instant fixed
 */
export function renderedHit(
  fields: Pick<LinearQueryHit, "assignee" | "identifier" | "kind" | "labels" | "project" | "state" | "title" | "url">,
): LinearQueryHit {
  return {
    ...fields,
    cycleNumber: undefined,
    priority: undefined,
    projectId: undefined,
    stateType: undefined,
    team: undefined,
    tsIso: "2026-08-01T00:00:00.000Z",
  };
}
