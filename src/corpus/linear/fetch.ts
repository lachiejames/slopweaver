/**
 * The Linear activity orchestrator: run every lane to exhaustion and fold the results into one
 * {@link LinearActivity}. The actual work is split across siblings —
 * the shared shapes in {@link ./apiTypes}, the CONSUMER lanes in {@link ./fetchCollect} (the two walks) and
 * {@link ./fetchLanes} (the bounded curated and entity lanes),
 * member hydration in {@link ./fetchMembers}, and the query/shape PRODUCER side (`makeLinearApi`) in
 * {@link ./fetchApi}. This file re-exports what a caller outside the Linear module reaches for, so production
 * code only ever imports `fetch.js`; a test of one sibling imports that sibling directly.
 *
 * ## The request shape, and why it is not an N+1
 *
 * The lazy `@linear/sdk` relations are one GraphQL request EACH — about seven per issue, thousands on a
 * backfill against a 2,500/hr cap. So a page of N issues is fetched as ONE inline query that pulls each issue
 * WITH its state/assignee/creator/team/project/milestone/cycle AND the first page of every nested connection.
 * A follow-up request happens only where a connection genuinely overflowed, which the measured maxima say is
 * rare. A per-issue fetch is forbidden, and the extra-request count is observable rather than asserted.
 *
 * ## What the issues lane hands back that it did not before
 *
 * Activity history. It is returned ALONGSIDE the records, not as records — see {@link ../history/types} for why
 * a one-line event must never enter the ranker — and the caller writes it to the sibling history store.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { SourceProgress } from "../progress.js";
import type { ExportWindow } from "../types.js";
import type { LinearActivity, LinearApi } from "./apiTypes.js";
import { type LinearHydrationError, LinearHydrationErrors } from "./errors.js";
import { collectLinearIssues, collectLinearProjects, type LinearPageCommit } from "./fetchCollect.js";
import { fetchLinearCurated, fetchLinearRecordEntities } from "./fetchLanes.js";

export type { LinearActivity, LinearApi } from "./apiTypes.js";
export { makeLinearApi, shapeIssuesPage, shapeProjectsPage } from "./fetchApi.js";
export type { LinearPageCommit } from "./fetchCollect.js";
export { linearIssuePreview, linearProjectPreview } from "./fetchCollect.js";
export { fetchLinearMembers, parseLinearUserNode } from "./fetchMembers.js";
// Only the PASS rides this barrel. `NO_REFERENCES` and `LinearReferences` do not: every consumer of them is
// inside this directory and imports `./references.js` directly, so re-exporting them claimed a public
// surface nothing used.
export { fetchLinearReferences } from "./references.js";

/**
 * Fetch all issues (+ comments + history) and projects updated since the window's `since`, paging both to
 * exhaustion. A failure at either top-level lane is fatal (after `retry` has exhausted its budget).
 *
 * @param api the injected Linear seam
 * @param window the export window (`since` is the `updatedAt >= ` bound)
 * @param onProgress the streamed per-page progress seam
 * @param maxItems optional per-lane fetch cap (`--fetch-cap`)
 * @param onPage the durable per-page commit seam handed to the two WALKING lanes; the curated and entity
 *   lanes are single bounded fetches rather than walks, so they stay on the closing bulk write
 * @returns the shaped activity, or `err` on a fatal failure
 */
export async function fetchLinearActivity({
  api,
  window,
  onProgress,
  maxItems,
  onPage,
}: {
  api: LinearApi;
  window: ExportWindow;
  onProgress?: SourceProgress;
  maxItems?: number;
  onPage?: LinearPageCommit;
}): Promise<Result<LinearActivity, LinearHydrationError>> {
  try {
    const issues = await collectLinearIssues({
      api,
      since: window.since,
      ...(onProgress !== undefined ? { onProgress } : {}),
      ...(maxItems !== undefined ? { maxItems } : {}),
      ...(onPage !== undefined ? { onPage } : {}),
    });
    const projects = await collectLinearProjects({
      api,
      since: window.since,
      ...(onProgress !== undefined ? { onProgress } : {}),
      ...(maxItems !== undefined ? { maxItems } : {}),
      ...(onPage !== undefined ? { onPage } : {}),
    });
    const curated = await fetchLinearCurated({ api, ...(maxItems !== undefined ? { maxItems } : {}) });
    const entities = await fetchLinearRecordEntities({ api, ...(maxItems !== undefined ? { maxItems } : {}) });
    return ok({
      customerNeeds: entities.customerNeeds,
      documents: curated.documents,
      historyRows: issues.historyRows,
      incomplete: [...issues.incomplete, ...projects.incomplete, ...curated.incomplete, ...entities.incomplete],
      initiatives: curated.initiatives,
      initiativeUpdates: entities.initiativeUpdates,
      issues: issues.issues,
      projectMilestones: entities.projectMilestones,
      projects: projects.projects,
      templates: entities.templates,
      warnings: [...issues.warnings, ...projects.warnings, ...curated.warnings, ...entities.warnings],
    });
  } catch (error: unknown) {
    return err(LinearHydrationErrors.activityFetchFailed({ cause: error }));
  }
}
