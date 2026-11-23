/**
 * Why a store export could not be written, or an export could not be read — the transfer domain's own union,
 * scoped to `src/store/transfer/`.
 */
import type { StoreExportPartKind } from "./parts.js";

/** `store export --out` named a path that already exists; an export never overwrites anything. */
export interface TargetExistsError {
  readonly code: "TARGET_EXISTS";
  readonly message: string;
  readonly path: string;
}

/** A register the export reads — the store or a judgement journal — would not read whole. */
export interface SourceUnreadableError {
  readonly code: "SOURCE_UNREADABLE";
  readonly message: string;
  readonly what: string;
}

/** A judgement journal changed while the export was reading, so the bundle would describe no real moment. */
export interface SourceMovedError {
  readonly code: "SOURCE_MOVED";
  readonly message: string;
  readonly path: string;
}

/** The export's own files would not be written or moved into place. */
export interface WriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The directory holds no manifest, and the caller did not say it is an unmanifested one. */
export interface ManifestAbsentError {
  readonly code: "MANIFEST_ABSENT";
  readonly message: string;
  readonly dir: string;
}

/** `--unmanifested` was given for a directory that HAS a manifest, whose hashes it would skip. */
export interface ManifestPresentError {
  readonly code: "MANIFEST_PRESENT";
  readonly message: string;
  readonly dir: string;
}

/** The manifest is not a store export manifest this build reads. */
export interface ManifestInvalidError {
  readonly code: "MANIFEST_INVALID";
  readonly message: string;
  readonly why: string;
}

/** A part's file is absent, a symlink, not a regular file, or would not read. */
export interface PartUnreadableError {
  readonly code: "PART_UNREADABLE";
  readonly message: string;
  readonly part: StoreExportPartKind;
  readonly path: string;
}

/** A part's bytes, hash or row count differ from what its manifest entry promised. */
export interface PartMismatchError {
  readonly code: "PART_MISMATCH";
  readonly message: string;
  readonly part: StoreExportPartKind;
  readonly field: "bytes" | "sha256" | "rows";
}

/** A part's content does not decode with its own domain's schema. */
export interface PartUndecodableError {
  readonly code: "PART_UNDECODABLE";
  readonly message: string;
  readonly part: StoreExportPartKind;
}

/** An unmanifested directory holds none of the files a part is read from. */
export interface NothingRecognisedError {
  readonly code: "NOTHING_RECOGNISED";
  readonly message: string;
  readonly dir: string;
}

/** One side of an import holds two rows under one key, so which of them the other side matches is undecidable. */
export interface DuplicateKeyError {
  readonly code: "DUPLICATE_KEY";
  readonly message: string;
  readonly part: StoreExportPartKind;
  readonly key: string;
}

/**
 * One side holds two memories under one import key, which the knowledge register holds unique, so no answer could
 * make both writable: the export is refused rather than asked about.
 */
export interface DuplicateImportKeyError {
  readonly code: "DUPLICATE_IMPORT_KEY";
  readonly message: string;
  readonly part: StoreExportPartKind;
  readonly importKey: string;
  /** The two rows' keys, in the order the side holds them. */
  readonly keys: readonly [string, string];
}

/** Every way writing or reading a store export fails. */
export type StoreTransferError =
  | DuplicateKeyError
  | DuplicateImportKeyError
  | TargetExistsError
  | SourceUnreadableError
  | SourceMovedError
  | WriteFailedError
  | ManifestAbsentError
  | ManifestPresentError
  | ManifestInvalidError
  | PartUnreadableError
  | PartMismatchError
  | PartUndecodableError
  | NothingRecognisedError;

/** The reason a thrown value carries, for a message. */
function reasonOf({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const StoreTransferErrors = {
  duplicateKey: ({
    part,
    key,
    side,
  }: {
    part: StoreExportPartKind;
    key: string;
    side: "export" | "live store";
  }): DuplicateKeyError => ({
    code: "DUPLICATE_KEY",
    key,
    message: `${part}: the ${side} holds two rows keyed ${key}, so neither can be compared`,
    part,
  }),
  duplicateImportKey: ({
    part,
    importKey,
    keys,
    side,
  }: {
    part: StoreExportPartKind;
    importKey: string;
    keys: readonly [string, string];
    side: "export" | "live store";
  }): DuplicateImportKeyError => ({
    code: "DUPLICATE_IMPORT_KEY",
    importKey,
    keys,
    message: `${part}: the ${side} holds two rows under import key ${importKey} (${keys[0]}, ${keys[1]}), which the register holds unique, so neither can be imported`,
    part,
  }),
  manifestAbsent: ({ dir }: { dir: string }): ManifestAbsentError => ({
    code: "MANIFEST_ABSENT",
    dir,
    message: `${dir} holds no manifest.json; pass --unmanifested to read an export made before manifests`,
  }),
  manifestInvalid: ({ why }: { why: string }): ManifestInvalidError => ({
    code: "MANIFEST_INVALID",
    message: `manifest.json is not a store export manifest this build reads: ${why}`,
    why,
  }),
  manifestPresent: ({ dir }: { dir: string }): ManifestPresentError => ({
    code: "MANIFEST_PRESENT",
    dir,
    message: `${dir} has a manifest.json, so it is read against its hashes; drop --unmanifested`,
  }),
  nothingRecognised: ({ dir }: { dir: string }): NothingRecognisedError => ({
    code: "NOTHING_RECOGNISED",
    dir,
    message: `${dir} holds none of the files a store export part is read from`,
  }),
  partMismatch: ({
    part,
    field,
    expected,
    actual,
  }: {
    part: StoreExportPartKind;
    field: "bytes" | "sha256" | "rows";
    expected: string;
    actual: string;
  }): PartMismatchError => ({
    code: "PART_MISMATCH",
    field,
    message: `${part}: the manifest promises ${field} ${expected} and the file holds ${actual}`,
    part,
  }),
  partUndecodable: ({ part, why }: { part: StoreExportPartKind; why: string }): PartUndecodableError => ({
    code: "PART_UNDECODABLE",
    message: `${part} does not decode: ${why}`,
    part,
  }),
  partUnreadable: ({
    part,
    path,
    cause,
  }: {
    part: StoreExportPartKind;
    path: string;
    cause: unknown;
  }): PartUnreadableError => ({
    code: "PART_UNREADABLE",
    message: `${part} at ${path} would not read: ${reasonOf({ cause })}`,
    part,
    path,
  }),
  sourceMoved: ({ path }: { path: string }): SourceMovedError => ({
    code: "SOURCE_MOVED",
    message: `${path} changed while it was being read; run the command again`,
    path,
  }),
  sourceUnreadable: ({ what, cause }: { what: string; cause: unknown }): SourceUnreadableError => ({
    code: "SOURCE_UNREADABLE",
    message: `${what} would not read: ${reasonOf({ cause })}`,
    what,
  }),
  targetExists: ({ path }: { path: string }): TargetExistsError => ({
    code: "TARGET_EXISTS",
    message: `${path} already exists; an export is written to a new directory and never over anything`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): WriteFailedError => ({
    code: "WRITE_FAILED",
    message: `could not write ${path}: ${reasonOf({ cause })}`,
    path,
  }),
} as const;
