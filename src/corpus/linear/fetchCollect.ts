/**
 * The CONSUMER side of the Linear seam's two WALKING lanes (issues, projects): paging the injected
 * {@link LinearApi} to exhaustion, plus the content-preview + heartbeat progress a `refresh` run streams while
 * it works. The bounded curated and entity lanes are in {@link ./fetchLanes}. Everything here is generic over
 * `LinearApi` and knows nothing about GraphQL — that lives in {@link ./fetchApi}. `fetch.ts` is the
 * orchestrator that calls these.
 */
import { appendAll } from "../../lib/arrays.js";
import { advanceOrWarn, openCursorPage } from "../../lib/paging.js";
import type { Result } from "../../lib/result.js";
import type { HistoryEventRow } from "../history/types.js";
import { type SourceProgress, type SourceProgressEvent, sourceHeartbeat, sourcePreview } from "../progress.js";
import type { LinearApi, LinearIssuesPage } from "./apiTypes.js";
import type { LinearIssueItem, LinearProjectItem } from "./items.js";

/**
 * What an issue's preview shows: its description, else its title. Linear's `Issue.description` is nullable,
 * and an issue nobody wrote a body for has none, so its title is the only prose it carries. Pure.
 */
function issuePreviewSnippet({ issue }: { issue: LinearIssueItem }): string {
  const { description } = issue;
  if (description === undefined) {
    return issue.title;
  }
  return description;
}

/**
 * A content-preview from a Linear issue (its identifier + description/title). Pure.
 *
 * @param issue the already-shaped issue; the identifier is the subject, so the preview reads like a ticket
 * @returns the preview event for the `issues` phase, falling back to the title when there is no body
 */
export function linearIssuePreview({ issue }: { issue: LinearIssueItem }): SourceProgressEvent {
  return sourcePreview({
    phase: "issues",
    snippet: issuePreviewSnippet({ issue }),
    source: "linear",
    sourceContentId: issue.identifier,
    subject: issue.identifier,
  });
}

/**
 * A content-preview from a Linear project (its name + description). Pure.
 *
 * @param project the already-shaped project
 * @returns the preview event for the `projects` phase, falling back to the name when there is no body
 */
export function linearProjectPreview({ project }: { project: LinearProjectItem }): SourceProgressEvent {
  return sourcePreview({
    phase: "projects",
    snippet: project.description ?? project.name,
    source: "linear",
    sourceContentId: project.id,
    subject: project.name,
  });
}

/**
 * The durable per-page commit seam: project ONE page of a lane and append it to bronze before the walk
 * asks for the next one.
 *
 * Absent ⇒ the lane accumulates its whole window in memory and the caller writes once at the end, which is
 * a bet that nothing restarts before the walk finishes. Measured on a killed refresh: fifteen
 * minutes of real provider reads left no bronze file and no watermark change, and a live run was
 * indistinguishable from a dead one from disk because nothing observable lands until a run completes.
 *
 * The seam carries LANE ITEMS rather than records because projection and the bronze write both need the
 * Slopweaver home, and this layer deliberately holds no home dependency — the `refresh` shell owns both.
 * The other lane's array is empty: one seam serves both walks so a caller opens one committer, not two.
 *
 * `err` means the commit did not reach disk, and the walk then RETAINS the page for the closing bulk write
 * — a page whose own commit failed has no other route to bronze.
 */
export type LinearPageCommit = (page: {
  readonly issues: readonly LinearIssueItem[];
  readonly projects: readonly LinearProjectItem[];
}) => Result<{ readonly written: number }>;

/**
 * Bank one page durably, or report that the walk must keep holding it.
 *
 * Two outcomes hand the page back and they are NOT the same case: no seam at all means this run is on the
 * write-once path deliberately (a bounded run must stay there — see `slackChannelCommitter` for why a
 * cursor a capped run has not earned must never be persisted), while a FAILED commit means durability was
 * attempted and missed, which is a warning the run has to say out loud.
 *
 * @param onPage the commit seam, absent on a write-once run
 * @param page the lane page to bank
 * @param warnings the lane's running warning list, MUTATED in place on a failed commit
 * @returns true when the page reached bronze, so the caller must NOT also retain it for the bulk write
 */
function bankLinearPage({
  onPage,
  page,
  warnings,
}: {
  onPage: LinearPageCommit | undefined;
  page: { readonly issues: readonly LinearIssueItem[]; readonly projects: readonly LinearProjectItem[] };
  warnings: string[];
}): boolean {
  if (onPage === undefined) {
    return false;
  }
  const banked = onPage(page);
  if (banked.isErr()) {
    appendAll({ from: banked.error.map((line) => `linear page commit failed: ${line}`), into: warnings });
    return false;
  }
  return true;
}

/**
 * The issues lane's per-page progress: a first-item preview on page ONE only, then a cumulative heartbeat.
 * Extracted so the paging loop carries only paging.
 */
function emitIssuePageProgress({
  onProgress,
  firstOfPage,
  page,
  collected,
  historyRows,
}: {
  onProgress: SourceProgress | undefined;
  firstOfPage: LinearIssueItem | undefined;
  page: number;
  /** Issues the walk has SEEN, banked and retained alike — never the retained array's length. */
  collected: number;
  historyRows: readonly HistoryEventRow[];
}): void {
  if (page === 0 && firstOfPage !== undefined) {
    onProgress?.(linearIssuePreview({ issue: firstOfPage }));
  }
  onProgress?.(
    sourceHeartbeat({
      currentItem: { title: `page ${String(page + 1)}` },
      done: collected,
      metrics: { events: historyRows.length, issues: collected },
      phase: "issues",
      source: "linear",
    }),
  );
}

/**
 * The projects lane's per-page progress, for the same reason as {@link emitIssuePageProgress}.
 */
function emitProjectPageProgress({
  onProgress,
  firstOfPage,
  page,
  collected,
}: {
  onProgress: SourceProgress | undefined;
  firstOfPage: LinearProjectItem | undefined;
  page: number;
  /** Projects the walk has SEEN, banked and retained alike — never the retained array's length. */
  collected: number;
}): void {
  if (page === 0 && firstOfPage !== undefined) {
    onProgress?.(linearProjectPreview({ project: firstOfPage }));
  }
  onProgress?.(
    sourceHeartbeat({
      currentItem: { title: `page ${String(page + 1)}` },
      done: collected,
      metrics: { projects: collected },
      phase: "projects",
      source: "linear",
    }),
  );
}

/**
 * Page the issues lane to exhaustion, accumulating the activity events alongside the issues and emitting a
 * first-item preview + a per-page heartbeat (no total ⇒ no %).
 *
 * @param api the injected Linear seam
 * @param since the `updatedAt >= ` window bound
 * @param onProgress the streamed per-page progress seam
 * @param maxItems optional per-lane fetch cap (`--fetch-cap`)
 * @param onPage the durable per-page commit seam; a page it banks is NOT returned, so the caller never
 *   offers the same records twice and the run's counts stay true
 * @returns the issues the caller still has to write, their activity events, and any paging warnings
 */
export async function collectLinearIssues({
  api,
  since,
  onProgress,
  maxItems,
  onPage,
}: {
  api: LinearApi;
  since: string;
  onProgress?: SourceProgress;
  maxItems?: number;
  onPage?: LinearPageCommit;
}): Promise<{
  issues: readonly LinearIssueItem[];
  historyRows: readonly HistoryEventRow[];
  warnings: readonly string[];
  incomplete: readonly string[];
}> {
  const issues: LinearIssueItem[] = [];
  const historyRows: HistoryEventRow[] = [];
  const warnings: string[] = [];
  // The walk's OWN ending, kept apart from `warnings`: a page's nested-connection notes and a failed page
  // commit (which the closing write still carries) are advisory, while a walk that stopped short of the window
  // is a coverage gap — `updatedAt` is DESCENDING, so what it missed is the oldest of the window, which a
  // cursor moved to the window's end would never request again.
  const incomplete: string[] = [];
  const seen = new Set<string>();
  // Counted rather than measured off `issues`: a page the seam banked is gone from that array, so using its
  // length would keep re-opening a capped walk and under-report every heartbeat.
  let collected = 0;
  let cursor: string | undefined;
  let page = 0;
  for (;;) {
    const open = openLinearPage({ collected, cursor, incomplete, lane: "linear issues", maxItems, page, seen });
    if (open === undefined) {
      break;
    }
    const result = await api.issues({
      pageSize: open.pageSize,
      since,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    // An EMPTY page no longer stops the walk: only a non-advancing cursor does. A `since`-filtered Relay page
    // can legitimately shape down to zero nodes while the connection still has more.
    collected += result.issues.length;
    absorbIssuePage({ historyRows, issues, onPage, result, warnings });
    emitIssuePageProgress({ collected, firstOfPage: result.issues[0], historyRows, onProgress, page });
    page += 1;
    const next = advanceOrWarn({ lane: "linear issues", next: result.nextCursor, seen, warnings: incomplete });
    if (next === undefined) {
      break;
    }
    cursor = next;
  }
  return { historyRows, incomplete, issues: maxItems === undefined ? issues : issues.slice(0, maxItems), warnings };
}

/**
 * Open the next page of a Linear lane's walk, or report that the walk is over.
 *
 * A one-line call in place of the nine-field one both lanes spelled out, so each loop body reads as the
 * SEQUENCE of a page rather than as the arguments of its first step.
 *
 * @param collected items the walk has SEEN, banked and retained alike — what the fetch cap is judged against
 * @param page the zero-based page number, which the ceiling check is judged against
 * @param incomplete the lane's coverage-gap lines, MUTATED in place when a ceiling ends the walk
 * @returns the page size to request, or undefined when the walk must stop
 */
function openLinearPage({
  collected,
  cursor,
  lane,
  maxItems,
  page,
  seen,
  incomplete,
}: {
  collected: number;
  cursor: string | undefined;
  lane: string;
  maxItems: number | undefined;
  page: number;
  seen: Set<string>;
  incomplete: string[];
}): { pageSize: number | undefined } | undefined {
  return openCursorPage({ collected, cursor, lane, maxItems, pages: page, seen, warnings: incomplete });
}

/**
 * Take one issues page into the walk's accumulators: bank it if there is a seam, retain it if there is not.
 *
 * The history rows are accumulated EITHER WAY. They are bound for the sibling event store rather than for
 * bronze, so a bronze commit covers none of them and dropping them for a banked page would lose the whole
 * activity history of a durable run.
 *
 * @param result the page the seam just returned
 * @param issues the retained-issue accumulator, MUTATED in place
 * @param historyRows the activity-event accumulator, MUTATED in place
 * @param warnings the lane's running warning list, MUTATED in place
 * @param onPage the durable commit seam, absent on a write-once run
 */
function absorbIssuePage({
  result,
  issues,
  historyRows,
  warnings,
  onPage,
}: {
  result: LinearIssuesPage;
  issues: LinearIssueItem[];
  historyRows: HistoryEventRow[];
  warnings: string[];
  onPage: LinearPageCommit | undefined;
}): void {
  if (!bankLinearPage({ onPage, page: { issues: result.issues, projects: [] }, warnings })) {
    appendAll({ from: result.issues, into: issues });
  }
  appendAll({ from: result.historyRows, into: historyRows });
  // `warnings` is optional and additive on the page contract, so an injected seam need not carry it at all.
  const pageWarnings = result.warnings;
  if (pageWarnings !== undefined) {
    appendAll({ from: pageWarnings, into: warnings });
  }
}

/**
 * Page the projects lane to exhaustion, emitting a first-item preview + a per-page heartbeat.
 *
 * @param api the injected Linear seam
 * @param since the `updatedAt >= ` window bound
 * @param onProgress the streamed per-page progress seam
 * @param maxItems optional per-lane fetch cap (`--fetch-cap`)
 * @param onPage the durable per-page commit seam; a page it banks is NOT returned, for the same reason as
 *   {@link collectLinearIssues}
 * @returns the projects the caller still has to write, and any paging warnings
 */
export async function collectLinearProjects({
  api,
  since,
  onProgress,
  maxItems,
  onPage,
}: {
  api: LinearApi;
  since: string;
  onProgress?: SourceProgress;
  maxItems?: number;
  onPage?: LinearPageCommit;
}): Promise<{ projects: readonly LinearProjectItem[]; warnings: readonly string[]; incomplete: readonly string[] }> {
  const projects: LinearProjectItem[] = [];
  const warnings: string[] = [];
  // The walk's own ending, apart from advisory warnings — see {@link collectLinearIssues}.
  const incomplete: string[] = [];
  const seen = new Set<string>();
  // Counted rather than measured off `projects` — see {@link collectLinearIssues}.
  let collected = 0;
  let cursor: string | undefined;
  let page = 0;
  for (;;) {
    const open = openLinearPage({ collected, cursor, incomplete, lane: "linear projects", maxItems, page, seen });
    if (open === undefined) {
      break;
    }
    const result = await api.projects({
      pageSize: open.pageSize,
      since,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    // An EMPTY page no longer stops the walk — see the note in `collectLinearIssues`.
    collected += result.projects.length;
    if (!bankLinearPage({ onPage, page: { issues: [], projects: result.projects }, warnings })) {
      appendAll({ from: result.projects, into: projects });
    }
    // Optional and additive on the page contract, as on the issues lane: an injected seam need not carry it.
    const pageWarnings = result.warnings;
    if (pageWarnings !== undefined) {
      appendAll({ from: pageWarnings, into: warnings });
    }
    emitProjectPageProgress({ collected, firstOfPage: result.projects[0], onProgress, page });
    page += 1;
    const next = advanceOrWarn({
      lane: "linear projects",
      next: result.nextCursor,
      seen,
      warnings: incomplete,
    });
    if (next === undefined) {
      break;
    }
    cursor = next;
  }
  return { incomplete, projects: maxItems === undefined ? projects : projects.slice(0, maxItems), warnings };
}
