/**
 * The typed failures the `outlook` mail ingest authors itself — its sync-anchor file's read and write. Its own
 * union, shared with no other source (`.claude/rules/error-handling.md`): a Graph transport failure stays the
 * live door's `OutlookError`, forwarded by message where it surfaces.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** The anchor file is there but could not be read. */
interface AnchorsUnreadableError {
  readonly code: "ANCHORS_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The anchor file was read but is not JSON. */
interface AnchorsNotJsonError {
  readonly code: "ANCHORS_NOT_JSON";
  readonly message: string;
  readonly path: string;
}

/** The anchor file is JSON but not an object keyed by folder id. */
interface AnchorsNotKeyedError {
  readonly code: "ANCHORS_NOT_KEYED";
  readonly message: string;
  readonly path: string;
}

/** One folder's entry is not a version-1 anchor. */
interface AnchorMalformedError {
  readonly code: "ANCHOR_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly folderId: string;
}

/** The anchor file could not be written back. */
interface AnchorsUnwritableError {
  readonly code: "ANCHORS_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way the Outlook mail sync-anchor file can fail. */
export type OutlookMailSyncAnchorError =
  AnchorsUnreadableError | AnchorsNotJsonError | AnchorsNotKeyedError | AnchorMalformedError | AnchorsUnwritableError;

/** The factory for {@link OutlookMailSyncAnchorError}, one builder per variant. */
export const OutlookMailSyncAnchorErrors = {
  anchorMalformed: ({ path, folderId }: { path: string; folderId: string }): AnchorMalformedError => ({
    code: "ANCHOR_MALFORMED",
    folderId,
    message: `the Outlook mail sync anchor for folder ${folderId} at ${path} is not a version-1 anchor`,
    path,
  }),
  notJson: ({ path, cause }: { path: string; cause: unknown }): AnchorsNotJsonError => ({
    code: "ANCHORS_NOT_JSON",
    message: `the Outlook mail sync anchors at ${path} are not JSON: ${errorMessage({ error: cause })}`,
    path,
  }),
  notKeyed: ({ path }: { path: string }): AnchorsNotKeyedError => ({
    code: "ANCHORS_NOT_KEYED",
    message: `the Outlook mail sync anchors at ${path} are not an object keyed by folder id`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): AnchorsUnreadableError => ({
    code: "ANCHORS_UNREADABLE",
    message: `could not read the Outlook mail sync anchors at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): AnchorsUnwritableError => ({
    code: "ANCHORS_UNWRITABLE",
    message: `could not write the Outlook mail sync anchors: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;
