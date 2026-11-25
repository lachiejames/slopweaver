/**
 * The `refresh` lanes that ride a stored OAuth GRANT rather than a token — the Gmail mailbox, the Google
 * diary and the Outlook diary.
 *
 * They sit apart from `./jobPlan.ts`'s tokened path because `deps.resolveTokens()` has no entry for any of
 * them: each authenticates with its own stored grant, crawls its own API and holds a second cursor layer of its
 * own (a `historyId`, a `syncToken` per calendar, a modified-time anchor per calendar) that an explicit window
 * flag must beat. Each builder is optional in {@link RefreshDeps}, so a build without the lane refuses it by
 * name rather than skipping it.
 */
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import type { ExportWindow } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { RefreshOptions } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import { RefreshErrors, type RefreshLaneNotWiredError } from "./errors.js";

/** What every grant-lane builder is handed. */
interface GrantLaneArgs {
  /** The parsed refresh options, for the two caps each lane honours itself. */
  readonly options: RefreshOptions;
  readonly window: ExportWindow;
  readonly home: string;
  readonly deps: RefreshDeps;
  /** Whether an explicit window flag beat the stored cursor; for these lanes it also beats their own anchors. */
  readonly cursorOverridden: boolean;
}

/**
 * Build the `gmail` ingest job.
 *
 * @param options the parsed refresh options, for the two caps this lane honours itself
 * @param cursorOverridden whether an explicit window flag beat the stored cursor; for this lane it also
 *   beats the stored `historyId` anchor, so `--all`/`--since` really do re-crawl
 * @returns the job, or the reason this build cannot make one
 */
export function buildGmailSourceJob({
  options,
  window,
  home,
  deps,
  cursorOverridden,
}: GrantLaneArgs): Result<SourceIngestJob, RefreshLaneNotWiredError> {
  const build = deps.buildGmailJob;
  if (build === undefined) {
    return err(RefreshErrors.laneNotWired({ source: "gmail" }));
  }
  return ok(
    build({
      cursorOverridden,
      home,
      nowIso: () => deps.nowDate().toISOString(),
      window,
      ...(deps.sourceProgress !== undefined ? { onProgress: deps.sourceProgress } : {}),
      ...(options.sample !== undefined ? { sample: options.sample } : {}),
      ...(options.fetchCap !== undefined ? { fetchCap: options.fetchCap } : {}),
    }),
  );
}

/**
 * Build the `calendar` ingest job — the Google diary.
 *
 * @param options the parsed refresh options, for the two caps this lane honours itself
 * @param cursorOverridden whether an explicit window flag beat the stored cursor; for this lane it also
 *   beats every stored `syncToken`, so `--all`/`--since` really do re-crawl
 * @returns the job, or the reason this build cannot make one
 */
export function buildCalendarSourceJob({
  options,
  window,
  home,
  deps,
  cursorOverridden,
}: GrantLaneArgs): Result<SourceIngestJob, RefreshLaneNotWiredError> {
  const build = deps.buildCalendarJob;
  if (build === undefined) {
    return err(RefreshErrors.laneNotWired({ source: "calendar" }));
  }
  return ok(
    build({
      cursorOverridden,
      home,
      nowIso: () => deps.nowDate().toISOString(),
      window,
      ...(options.sample !== undefined ? { sample: options.sample } : {}),
      ...(options.fetchCap !== undefined ? { fetchCap: options.fetchCap } : {}),
    }),
  );
}

/**
 * Build the `outlook-calendar` ingest job — the Outlook diary, over its own calendar grant.
 *
 * @param options the parsed refresh options, for the two caps this lane honours itself
 * @param cursorOverridden whether an explicit window flag beat the stored cursor; for this lane it also beats
 *   every stored modified-time anchor, so `--all`/`--since` read every calendar whole
 * @returns the job, or the reason this build cannot make one
 */
export function buildOutlookCalendarSourceJob({
  options,
  window,
  home,
  deps,
  cursorOverridden,
}: GrantLaneArgs): Result<SourceIngestJob, RefreshLaneNotWiredError> {
  const build = deps.buildOutlookCalendarJob;
  if (build === undefined) {
    return err(RefreshErrors.laneNotWired({ source: "outlook-calendar" }));
  }
  return ok(
    build({
      api: undefined,
      cursorOverridden,
      fetchCap: options.fetchCap,
      home,
      nowIso: () => deps.nowDate().toISOString(),
      sample: options.sample,
      window,
    }),
  );
}
