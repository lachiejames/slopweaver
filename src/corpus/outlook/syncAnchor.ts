/**
 * The `outlook` source's incremental cursor — one Graph delta link per mail folder, under
 * `$SLOPWEAVER_HOME/corpus/watermarks/outlook-sync.json`.
 *
 * A SECOND cursor layer beside the pooled watermark, for the reason the Gmail lane's history anchor is
 * (`../gmail/ingest.ts`): the pooled cursor answers how far through TIME a source was read, and a delta link
 * answers what changed in one folder since a round COMPLETED there. A link is only ever written after Graph
 * returned it on a round's last page and every page of that round is on disk (`./ingest.ts`).
 *
 * A MISSING file is an empty map, because it means no folder was ever read whole. A file that is THERE but
 * will not read or parse is an error rather than an empty map, and the asymmetry is the point: an empty map
 * reads every folder whole again, and a mailbox read whole is a long walk to start because of a torn file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type OutlookMailSyncAnchorError, OutlookMailSyncAnchorErrors } from "./errors.js";

/**
 * The stored cursor for ONE folder.
 * @internal — named only by `OutlookMailSyncAnchors` beside it; callers read the record type.
 */
export interface OutlookMailSyncAnchor {
  readonly version: 1;
  /** The `@odata.deltaLink` Graph returned on the last page of a complete round over this folder. */
  readonly deltaLink: string;
  /** When the anchor was written, so an operator can see how old an incremental lane's basis is. */
  readonly recordedAtIso: string;
}

/** Every folder's anchor, keyed by the folder's Graph id. */
export type OutlookMailSyncAnchors = Readonly<Record<string, OutlookMailSyncAnchor>>;

/**
 * The path the anchors are written to for a given home.
 *
 * @returns the absolute path of the anchor file
 */
export function outlookMailSyncAnchorPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).corpus.root, "watermarks", "outlook-sync.json");
}

/** Narrow one parsed entry to an anchor. */
function isAnchor(value: unknown): value is OutlookMailSyncAnchor {
  if (!isRecord(value)) {
    return false;
  }
  return value["version"] === 1 && typeof value["deltaLink"] === "string" && typeof value["recordedAtIso"] === "string";
}

/** Whether a read failure is the file simply not being there. */
function isMissing({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

/**
 * Read every stored anchor back: empty when none was ever written, an error when the file is there and unusable.
 *
 * @returns each folder's anchor, or why the stored file could not be trusted
 */
export function readOutlookMailSyncAnchors({
  home,
}: {
  home: string;
}): Result<OutlookMailSyncAnchors, OutlookMailSyncAnchorError> {
  const path = outlookMailSyncAnchorPath({ home });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isMissing({ error })) {
      return ok({});
    }
    return err(OutlookMailSyncAnchorErrors.unreadable({ cause: error, path }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return err(OutlookMailSyncAnchorErrors.notJson({ cause: error, path }));
  }
  if (!isRecord(parsed)) {
    return err(OutlookMailSyncAnchorErrors.notKeyed({ path }));
  }
  const anchors: Record<string, OutlookMailSyncAnchor> = {};
  for (const [folderId, value] of Object.entries(parsed)) {
    if (!isAnchor(value)) {
      return err(OutlookMailSyncAnchorErrors.anchorMalformed({ folderId, path }));
    }
    anchors[folderId] = value;
  }
  return ok(anchors);
}

/**
 * Write the anchors back atomically, replacing the whole file.
 *
 * @param anchors every folder's anchor, as it should stand after this run
 * @returns the path written, or why the write failed
 */
export function writeOutlookMailSyncAnchors({
  home,
  anchors,
}: {
  home: string;
  anchors: OutlookMailSyncAnchors;
}): Result<string, OutlookMailSyncAnchorError> {
  const path = outlookMailSyncAnchorPath({ home });
  try {
    writeFileAtomic({ contents: `${JSON.stringify(anchors, undefined, 2)}\n`, path });
  } catch (error: unknown) {
    return err(OutlookMailSyncAnchorErrors.unwritable({ cause: error, path }));
  }
  return ok(path);
}
