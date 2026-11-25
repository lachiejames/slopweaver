/**
 * The typed failures of `codex plugin-sync` — the one domain that keeps the Codex install of Slopweaver on
 * the main checkout's commit. Each variant is a different thing to fix, so a caller branches on `code`.
 */

/** The personal marketplace file exists but is not a marketplace this verb can read. */
export interface MarketplaceUnreadableError {
  readonly code: "MARKETPLACE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The marketplace entry's source path is a real file or directory, which this verb will not replace. */
export interface SourceNotSymlinkError {
  readonly code: "SOURCE_NOT_SYMLINK";
  readonly message: string;
  readonly path: string;
}

/** The marketplace source symlink could not be created or swapped. */
export interface RepointFailedError {
  readonly code: "REPOINT_FAILED";
  readonly message: string;
  readonly path: string;
}

/** `git` could not name HEAD or write the export. */
export interface ExportFailedError {
  readonly code: "EXPORT_FAILED";
  readonly message: string;
}

/** `codex plugin add` failed, or answered with something that names no installed root. */
export interface AddFailedError {
  readonly code: "ADD_FAILED";
  readonly message: string;
}

/** Codex installed a tree, and the commit stamped in it is not the one just exported. */
export interface StampMismatchError {
  readonly code: "STAMP_MISMATCH";
  readonly message: string;
  readonly expected: string;
  readonly found: string | undefined;
}

/** The background run threw something no step mapped — recorded so the next run can re-state it. */
export interface CrashedError {
  readonly code: "CRASHED";
  readonly message: string;
}

/** The sync lock could not be judged or taken, for a reason no rerun waits out — not another run holding it. */
export interface SyncLockUnavailableError {
  readonly code: "SYNC_LOCK_UNAVAILABLE";
  readonly message: string;
}

/** The personal marketplace changed between this run's read and its write, so the write was not made. */
export interface MarketplaceChangedError {
  readonly code: "MARKETPLACE_CHANGED";
  readonly message: string;
  readonly path: string;
}

/** The personal marketplace could not be written for a reason other than a concurrent change. */
export interface MarketplaceWriteFailedError {
  readonly code: "MARKETPLACE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A REGISTERED Codex home has no directory, so the plan register names a store nobody signed into. */
export interface CodexHomeMissingError {
  readonly code: "CODEX_HOME_MISSING";
  readonly message: string;
  readonly codexHome: string;
}

/** The plan register could not be read, so the set of Codex homes is unknown. */
export interface DestinationsUnreadableError {
  readonly code: "DESTINATIONS_UNREADABLE";
  readonly message: string;
}

/** A home's Slopweaver hooks are not all running after the trust pass. */
export interface HookTrustFailedError {
  readonly code: "HOOK_TRUST_FAILED";
  readonly message: string;
  readonly codexHome: string;
}

/** Every way `codex plugin-sync` can fail. */
export type CodexPluginSyncError =
  | AddFailedError
  | CodexHomeMissingError
  | CrashedError
  | DestinationsUnreadableError
  | ExportFailedError
  | HookTrustFailedError
  | MarketplaceChangedError
  | MarketplaceUnreadableError
  | MarketplaceWriteFailedError
  | RepointFailedError
  | SourceNotSymlinkError
  | StampMismatchError
  | SyncLockUnavailableError;

/** Factories for {@link CodexPluginSyncError}, so every construction site builds the same message. */
export const CodexPluginSyncErrors = {
  addFailed: ({ detail }: { detail: string }): AddFailedError => ({
    code: "ADD_FAILED",
    message: `codex plugin add failed: ${detail}`,
  }),
  codexHomeMissing: ({ codexHome }: { codexHome: string }): CodexHomeMissingError => ({
    code: "CODEX_HOME_MISSING",
    codexHome,
    message:
      `the plan register names the Codex home ${codexHome}, and no directory is there — nothing was installed; ` +
      "sign that plan in again or remove its row",
  }),
  crashed: ({ detail }: { detail: string }): CrashedError => ({
    code: "CRASHED",
    message: `the refresh threw: ${detail}`,
  }),
  destinationsUnreadable: ({ detail }: { detail: string }): DestinationsUnreadableError => ({
    code: "DESTINATIONS_UNREADABLE",
    message: `the plan register could not be read, so no Codex home was touched: ${detail}`,
  }),
  hookTrustFailed: ({ codexHome, detail }: { codexHome: string; detail: string }): HookTrustFailedError => ({
    code: "HOOK_TRUST_FAILED",
    codexHome,
    message: `not every Slopweaver hook runs in ${codexHome}: ${detail}`,
  }),
  marketplaceChanged: ({ path }: { path: string }): MarketplaceChangedError => ({
    code: "MARKETPLACE_CHANGED",
    message: `the Codex marketplace at ${path} changed while this run was adding slopweaver to it — re-run`,
    path,
  }),
  marketplaceWriteFailed: ({ path, detail }: { path: string; detail: string }): MarketplaceWriteFailedError => ({
    code: "MARKETPLACE_WRITE_FAILED",
    message: `could not write the Codex marketplace at ${path}: ${detail}`,
    path,
  }),
  exportFailed: ({ detail }: { detail: string }): ExportFailedError => ({
    code: "EXPORT_FAILED",
    message: `could not export HEAD for Codex: ${detail}`,
  }),
  marketplaceUnreadable: ({ path, detail }: { path: string; detail: string }): MarketplaceUnreadableError => ({
    code: "MARKETPLACE_UNREADABLE",
    message: `the Codex marketplace at ${path} is unreadable: ${detail}`,
    path,
  }),
  repointFailed: ({ path, detail }: { path: string; detail: string }): RepointFailedError => ({
    code: "REPOINT_FAILED",
    message: `could not point the marketplace source ${path} at the export: ${detail}`,
    path,
  }),
  sourceNotSymlink: ({ path }: { path: string }): SourceNotSymlinkError => ({
    code: "SOURCE_NOT_SYMLINK",
    message:
      `the marketplace's slopweaver source ${path} is a real file or directory, not a symlink — ` +
      "move it aside and re-run so it can point at the export",
    path,
  }),
  stampMismatch: ({ expected, found }: { expected: string; found: string | undefined }): StampMismatchError => ({
    code: "STAMP_MISMATCH",
    expected,
    found,
    message: `Codex installed ${installedLabel({ found })} where ${expected} was exported`,
  }),
  syncLockUnavailable: ({ detail }: { detail: string }): SyncLockUnavailableError => ({
    code: "SYNC_LOCK_UNAVAILABLE",
    message: `the plugin-sync lock could not be taken: ${detail}`,
  }),
} as const;

/** What a stamp mismatch names as installed: the commit found, or the absence of any stamp. */
function installedLabel({ found }: { found: string | undefined }): string {
  if (found === undefined) {
    return "a tree with no source stamp";
  }
  return found;
}
