/**
 * The typed refusals of `store pages-import`: every way the two page folders can fail to be carried into the store
 * whole and byte-verified.
 *
 * Its own union rather than members of `../errors.ts`'s `StoreError` or `../objects/errors.ts`'s `ObjectStoreError`,
 * per `.claude/rules/error-handling.md`: these are failures of the SOURCE folders, found in preflight before any
 * upload or row, and a caller branches on them differently — a symbolic link is a folder to fix by hand, a body
 * conflict is a measurement that the one-type-per-body schema is wrong.
 */

/** A directory or file under one of the two folders could not be listed, opened or read. */
export interface PagesSourceUnreadableError {
  readonly code: "PAGES_SOURCE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/** An entry's name is not valid UTF-8, or is not a name a page key or relative link can carry. */
export interface PagesEntryNameUnsafeError {
  readonly code: "PAGES_ENTRY_NAME_UNSAFE";
  readonly message: string;
  /** The directory holding the entry. */
  readonly directory: string;
  /** The name as far as it decodes, never the raw bytes. */
  readonly name: string;
}

/** A symbolic link sits under one of the folders; nothing is followed and nothing is skipped. */
export interface PagesSymbolicLinkError {
  readonly code: "PAGES_SYMBOLIC_LINK";
  readonly message: string;
  readonly path: string;
}

/** An entry is not what its place holds: a socket, FIFO or device anywhere, or a loose file where a directory belongs. */
export interface PagesEntryKindUnsupportedError {
  readonly code: "PAGES_ENTRY_KIND_UNSUPPORTED";
  readonly message: string;
  readonly path: string;
  /** What was found there, in words. */
  readonly found: string;
}

/** A page directory carries no regular `index.html`, so there is no document to serve. */
export interface PagesIndexMissingError {
  readonly code: "PAGES_INDEX_MISSING";
  readonly message: string;
  readonly path: string;
}

/** A file changed between being listed and being read, so the bytes read are not a settled copy. */
export interface PagesFileChangedError {
  readonly code: "PAGES_FILE_CHANGED";
  readonly message: string;
  readonly path: string;
}

/** A frozen-history directory holds neither a pointer nor a version. */
export interface PagesHistoryEmptyError {
  readonly code: "PAGES_HISTORY_EMPTY";
  readonly message: string;
  readonly path: string;
}

/** A frozen-history directory holds versions but no `latest.json`. */
export interface PagesLatestMissingError {
  readonly code: "PAGES_LATEST_MISSING";
  readonly message: string;
  readonly path: string;
}

/** A `latest.json` is not the pointer the freeze store writes, or names another key. */
export interface PagesLatestInvalidError {
  readonly code: "PAGES_LATEST_INVALID";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/** A file in a frozen-history directory is neither `latest.json` nor `<sha-256 hex>.html`. */
export interface PagesVersionNameInvalidError {
  readonly code: "PAGES_VERSION_NAME_INVALID";
  readonly message: string;
  readonly path: string;
}

/** A frozen version's bytes do not hash to the name it was frozen under. */
export interface PagesVersionDigestMismatchError {
  readonly code: "PAGES_VERSION_DIGEST_MISMATCH";
  readonly message: string;
  readonly path: string;
  readonly actual: string;
}

/** A `latest.json` points at a version its directory does not hold. */
export interface PagesLatestVersionMissingError {
  readonly code: "PAGES_LATEST_VERSION_MISSING";
  readonly message: string;
  readonly path: string;
  readonly sha256: string;
}

/** Two files share one body but derive two media types, and a body row carries exactly one. */
export interface PagesBodyMediaConflictError {
  readonly code: "PAGES_BODY_MEDIA_CONFLICT";
  readonly message: string;
  readonly sha256: string;
  /** The two paths, each with the type it derives. */
  readonly paths: readonly string[];
}

/** The store already holds this body under a different media type than the folders derive. */
export interface PagesHeldBlobConflictError {
  readonly code: "PAGES_HELD_BLOB_CONFLICT";
  readonly message: string;
  readonly sha256: string;
  readonly held: string;
  readonly derived: string;
}

/** A publish's write found the store already holding a later freeze of its page, so writing it would regress the page. */
export interface PagesPublishSupersededError {
  readonly code: "PAGES_PUBLISH_SUPERSEDED";
  readonly message: string;
  readonly pageKey: string;
  readonly frozenAt: Date;
  readonly heldFrozenAt: Date;
}

/** A freeze without `--new` named a key the store holds no version of, which is what a drifted artifact id reads as. */
export interface PagesFreezeOpensHistoryError {
  readonly code: "PAGES_FREEZE_OPENS_HISTORY";
  readonly message: string;
  readonly key: string;
  /** The held keys a hair away from it, nearest first, with how many versions each holds. */
  readonly neighbours: readonly { readonly key: string; readonly versions: number; readonly distance: number }[];
}

/** Every way a page import can be refused. */
export type PublishedPagesImportError =
  | PagesBodyMediaConflictError
  | PagesEntryKindUnsupportedError
  | PagesEntryNameUnsafeError
  | PagesFileChangedError
  | PagesFreezeOpensHistoryError
  | PagesHeldBlobConflictError
  | PagesHistoryEmptyError
  | PagesIndexMissingError
  | PagesLatestInvalidError
  | PagesLatestMissingError
  | PagesLatestVersionMissingError
  | PagesPublishSupersededError
  | PagesSourceUnreadableError
  | PagesSymbolicLinkError
  | PagesVersionDigestMismatchError
  | PagesVersionNameInvalidError;

/** The factories the scanner, the projection, the store half and their tests build refusals with. */
export const PublishedPagesImportErrors = {
  bodyMediaConflict: ({
    sha256,
    paths,
  }: {
    sha256: string;
    paths: readonly string[];
  }): PagesBodyMediaConflictError => ({
    code: "PAGES_BODY_MEDIA_CONFLICT",
    message: `one body (${sha256}) derives two media types — ${paths.join(" and ")} — and a stored body carries one; rename the file whose extension is wrong`,
    paths,
    sha256,
  }),
  entryKindUnsupported: ({ path, found }: { path: string; found: string }): PagesEntryKindUnsupportedError => ({
    code: "PAGES_ENTRY_KIND_UNSUPPORTED",
    found,
    message: `${path} is ${found}, which no page is made of; move it out and run the import again`,
    path,
  }),
  entryNameUnsafe: ({ directory, name }: { directory: string; name: string }): PagesEntryNameUnsafeError => ({
    code: "PAGES_ENTRY_NAME_UNSAFE",
    directory,
    message: `${directory} holds an entry named ${JSON.stringify(name)}, which is not valid UTF-8 or not a name a page can serve; rename it and run the import again`,
    name,
  }),
  fileChanged: ({ path }: { path: string }): PagesFileChangedError => ({
    code: "PAGES_FILE_CHANGED",
    message: `${path} changed while it was read, so its bytes are not a settled copy; run the import again once nothing is publishing`,
    path,
  }),
  heldBlobConflict: ({
    sha256,
    held,
    derived,
  }: {
    sha256: string;
    held: string;
    derived: string;
  }): PagesHeldBlobConflictError => ({
    code: "PAGES_HELD_BLOB_CONFLICT",
    derived,
    held,
    message: `the store holds body ${sha256} as ${held}, but the folders derive ${derived} for it; nothing is rewritten`,
    sha256,
  }),
  publishSuperseded: ({
    pageKey,
    frozenAt,
    heldFrozenAt,
  }: {
    pageKey: string;
    frozenAt: Date;
    heldFrozenAt: Date;
  }): PagesPublishSupersededError => ({
    code: "PAGES_PUBLISH_SUPERSEDED",
    frozenAt,
    heldFrozenAt,
    message:
      `the store already holds ${pageKey} as frozen at ${heldFrozenAt.toISOString()}, ` +
      `${heldFrozenAt.getTime() > frozenAt.getTime() ? "later than" : "the same instant as, with other bytes than,"} ` +
      `this publish's ${frozenAt.toISOString()}, and the store never moves a page backwards. Publish it again at the ` +
      "current time, without a --now at or before that freeze",
    pageKey,
  }),
  freezeOpensHistory: ({
    key,
    neighbours,
  }: {
    key: string;
    neighbours: PagesFreezeOpensHistoryError["neighbours"];
  }): PagesFreezeOpensHistoryError => ({
    code: "PAGES_FREEZE_OPENS_HISTORY",
    key,
    message: `the store holds no version of ${key}, so this freeze would open a new history; pass --new if it is one`,
    neighbours,
  }),
  historyEmpty: ({ path }: { path: string }): PagesHistoryEmptyError => ({
    code: "PAGES_HISTORY_EMPTY",
    message: `${path} holds no latest.json and no frozen version; remove the empty directory and run the import again`,
    path,
  }),
  indexMissing: ({ path }: { path: string }): PagesIndexMissingError => ({
    code: "PAGES_INDEX_MISSING",
    message: `${path} carries no regular index.html, so it is not a page a reader can open`,
    path,
  }),
  latestInvalid: ({ path, reason }: { path: string; reason: string }): PagesLatestInvalidError => ({
    code: "PAGES_LATEST_INVALID",
    message: `${path} is not a freeze pointer: ${reason}`,
    path,
    reason,
  }),
  latestMissing: ({ path }: { path: string }): PagesLatestMissingError => ({
    code: "PAGES_LATEST_MISSING",
    message: `${path} holds frozen versions but no latest.json, so nothing says which is latest`,
    path,
  }),
  latestVersionMissing: ({ path, sha256 }: { path: string; sha256: string }): PagesLatestVersionMissingError => ({
    code: "PAGES_LATEST_VERSION_MISSING",
    message: `${path} points at version ${sha256}, which its directory does not hold`,
    path,
    sha256,
  }),
  sourceUnreadable: ({ path, reason }: { path: string; reason: string }): PagesSourceUnreadableError => ({
    code: "PAGES_SOURCE_UNREADABLE",
    message: `could not read ${path}: ${reason}`,
    path,
    reason,
  }),
  symbolicLink: ({ path }: { path: string }): PagesSymbolicLinkError => ({
    code: "PAGES_SYMBOLIC_LINK",
    message: `${path} is a symbolic link; the import follows none and skips none, so replace it with the file it names or remove it`,
    path,
  }),
  versionDigestMismatch: ({ path, actual }: { path: string; actual: string }): PagesVersionDigestMismatchError => ({
    actual,
    code: "PAGES_VERSION_DIGEST_MISMATCH",
    message: `${path} hashes to ${actual}, not to the name it was frozen under`,
    path,
  }),
  versionNameInvalid: ({ path }: { path: string }): PagesVersionNameInvalidError => ({
    code: "PAGES_VERSION_NAME_INVALID",
    message: `${path} is neither latest.json nor a <sha-256 hex>.html frozen version`,
    path,
  }),
} as const;
