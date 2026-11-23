/**
 * `outlook measure` — how much mail the mailbox holds, in the only terms Graph gives cheaply: each folder's
 * own message and unread counters.
 *
 * Gmail's door can report sampled bytes and a date range; Graph exposes neither cheaply, so this does not
 * imitate them. Every answer carries `exact: false` and a coverage line saying what it is NOT — no bodies, no
 * attachment bytes, no oldest date, no mailbox size — because a count presented beside Gmail's would otherwise
 * read as the same measurement.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookApi } from "./apiCore.js";
import { type OutlookError } from "./errors.js";
import { isWellKnownFolder, type OutlookFolder, pickFolder, walkFolders } from "./folders.js";

/** What every measurement says it does not cover. */
export const OUTLOOK_MEASURE_COVERAGE =
  "provider folder counters; no bodies, attachment bytes, oldest date, or exact mailbox bytes";

/**
 * One measured folder.
 *
 * @internal — the element type of `OutlookMeasure.folders`; callers read the measure, never name a folder's type.
 */
export interface OutlookFolderMeasure {
  readonly id: string;
  readonly path: string;
  readonly totalItemCount: number;
  readonly unreadItemCount: number;
}

/** What `outlook measure` answers. */
export interface OutlookMeasure {
  readonly folders: readonly OutlookFolderMeasure[];
  /** The sums over `folders`. */
  readonly totalItemCount: number;
  readonly unreadItemCount: number;
  /** True when the folder walk stopped early, so the sums are over a prefix of the mailbox. */
  readonly truncated: boolean;
  readonly exact: false;
  readonly coverage: string;
}

/**
 * Sum a set of folders' counters. Pure.
 *
 * @param truncated whether the folder list is a prefix
 * @returns the measurement
 */
export function measureFolders({
  folders,
  truncated,
}: {
  folders: readonly OutlookFolder[];
  truncated: boolean;
}): OutlookMeasure {
  const rows = folders.map((folder) => ({
    id: folder.id,
    path: folder.path.join("/"),
    totalItemCount: folder.totalItemCount,
    unreadItemCount: folder.unreadItemCount,
  }));
  return {
    coverage: OUTLOOK_MEASURE_COVERAGE,
    exact: false,
    folders: rows,
    totalItemCount: rows.reduce((sum, row) => sum + row.totalItemCount, 0),
    truncated,
    unreadItemCount: rows.reduce((sum, row) => sum + row.unreadItemCount, 0),
  };
}

/**
 * Measure one folder, or every visible folder.
 *
 * @param folder a display name or id, or undefined for the whole visible hierarchy
 * @returns the measurement, or why it could not be taken
 */
export async function measureOutlook({
  api,
  folder,
}: {
  api: OutlookApi;
  folder: string | undefined;
}): Promise<Result<OutlookMeasure, OutlookError>> {
  const walk = await walkFolders({ api });
  if (walk.isErr()) {
    return err(walk.error);
  }
  if (folder === undefined) {
    return ok(measureFolders({ folders: walk.value.folders, truncated: walk.value.truncated }));
  }
  const picked = await pickMeasured({ api, folders: walk.value.folders, reference: folder });
  if (picked.isErr()) {
    return err(picked.error);
  }
  return ok(measureFolders({ folders: [picked.value], truncated: false }));
}

/**
 * A well-known name resolves through Graph to an id first (the name a user sees is localised); anything else is
 * picked from the walk by id or display name.
 */
async function pickMeasured({
  api,
  folders,
  reference,
}: {
  api: OutlookApi;
  folders: readonly OutlookFolder[];
  reference: string;
}): Promise<Result<OutlookFolder, OutlookError>> {
  if (!isWellKnownFolder({ reference })) {
    return pickFolder({ folders, reference });
  }
  const known = await api.getFolder({ reference: reference.toLowerCase() });
  if (known.isErr()) {
    return err(known.error);
  }
  return pickFolder({ folders, reference: known.value.id });
}
