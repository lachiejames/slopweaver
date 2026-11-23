/**
 * The local backup directory's own typed error union — every way `./localDirectoryTransport.ts` refuses or
 * fails, each carrying the destination root and, where there is one, the object name, so a person reading a
 * failed night's line is told exactly which file under which directory it was about.
 *
 * Per `.claude/rules/error-handling.md`: one union, one factory, no base shared with any other domain. The
 * object cipher's union (`./objectCryptoErrors.ts`) is a different domain riding the same operations.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** The destination root is not a directory this process can create, enter and write. */
export interface LocalDestinationUnreachableError {
  readonly code: "LOCAL_DESTINATION_UNREACHABLE";
  readonly message: string;
  readonly root: string;
  readonly cause?: unknown;
}

/** An object name that would escape the root or is not a plain relative path. */
export interface LocalObjectNameRefusedError {
  readonly code: "LOCAL_OBJECT_NAME_REFUSED";
  readonly message: string;
  readonly root: string;
  readonly objectName: string;
}

/** A path component under the root is a symbolic link, which this destination never follows. */
export interface LocalSymlinkRefusedError {
  readonly code: "LOCAL_SYMLINK_REFUSED";
  readonly message: string;
  readonly root: string;
  readonly path: string;
}

/** A listing reached a folder on another volume than the destination's own — one mounted inside it. */
export interface LocalMountCrossedError {
  readonly code: "LOCAL_MOUNT_CROSSED";
  readonly message: string;
  readonly root: string;
  readonly path: string;
}

/** Writing one object failed. */
export interface LocalObjectWriteFailedError {
  readonly code: "LOCAL_OBJECT_WRITE_FAILED";
  readonly message: string;
  readonly root: string;
  readonly objectName: string;
  readonly cause?: unknown;
}

/** Reading one object back failed. */
export interface LocalObjectReadFailedError {
  readonly code: "LOCAL_OBJECT_READ_FAILED";
  readonly message: string;
  readonly root: string;
  readonly objectName: string;
  readonly cause?: unknown;
}

/** Listing under one prefix failed. */
export interface LocalObjectListFailedError {
  readonly code: "LOCAL_OBJECT_LIST_FAILED";
  readonly message: string;
  readonly root: string;
  readonly prefix: string;
  readonly cause?: unknown;
}

/** Removing one object failed. */
export interface LocalObjectRemoveFailedError {
  readonly code: "LOCAL_OBJECT_REMOVE_FAILED";
  readonly message: string;
  readonly root: string;
  readonly objectName: string;
  readonly cause?: unknown;
}

/** A download aimed at a path inside the destination, where it would replace a stored object. */
export interface LocalTargetInsideDestinationError {
  readonly code: "LOCAL_TARGET_INSIDE_DESTINATION";
  readonly message: string;
  readonly root: string;
  readonly path: string;
}

/** A download target whose links cannot all be resolved — one points at nothing, or cannot be read. */
export interface LocalTargetUnresolvableError {
  readonly code: "LOCAL_TARGET_UNRESOLVABLE";
  readonly message: string;
  readonly root: string;
  readonly path: string;
}

/** Every way the local destination fails. */
export type LocalDestinationError =
  | LocalDestinationUnreachableError
  | LocalMountCrossedError
  | LocalObjectListFailedError
  | LocalObjectNameRefusedError
  | LocalObjectReadFailedError
  | LocalObjectRemoveFailedError
  | LocalObjectWriteFailedError
  | LocalSymlinkRefusedError
  | LocalTargetInsideDestinationError
  | LocalTargetUnresolvableError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const LocalDestinationErrors = {
  listFailed: ({
    root,
    prefix,
    cause,
  }: {
    root: string;
    prefix: string;
    cause: unknown;
  }): LocalObjectListFailedError => ({
    cause,
    code: "LOCAL_OBJECT_LIST_FAILED",
    message: `could not list ${root}/${prefix}: ${errorMessage({ error: cause })}`,
    prefix,
    root,
  }),
  nameRefused: ({
    root,
    objectName,
    why,
  }: {
    root: string;
    objectName: string;
    why: string;
  }): LocalObjectNameRefusedError => ({
    code: "LOCAL_OBJECT_NAME_REFUSED",
    message: `refused object name ${JSON.stringify(objectName)} under ${root}: ${why}`,
    objectName,
    root,
  }),
  readFailed: ({
    root,
    objectName,
    cause,
  }: {
    root: string;
    objectName: string;
    cause: unknown;
  }): LocalObjectReadFailedError => ({
    cause,
    code: "LOCAL_OBJECT_READ_FAILED",
    message: `could not read ${root}/${objectName}: ${errorMessage({ error: cause })}`,
    objectName,
    root,
  }),
  removeFailed: ({
    root,
    objectName,
    cause,
  }: {
    root: string;
    objectName: string;
    cause: unknown;
  }): LocalObjectRemoveFailedError => ({
    cause,
    code: "LOCAL_OBJECT_REMOVE_FAILED",
    message: `could not remove ${root}/${objectName}: ${errorMessage({ error: cause })}`,
    objectName,
    root,
  }),
  mountCrossed: ({ root, path }: { root: string; path: string }): LocalMountCrossedError => ({
    code: "LOCAL_MOUNT_CROSSED",
    message:
      `${path} is on another volume than the backup destination ${root}; a listing never crosses onto a volume ` +
      "mounted inside the destination, or what it holds would read as backed up",
    path,
    root,
  }),
  symlinkRefused: ({ root, path }: { root: string; path: string }): LocalSymlinkRefusedError => ({
    code: "LOCAL_SYMLINK_REFUSED",
    message: `${path} is a symbolic link; the backup destination ${root} never follows one`,
    path,
    root,
  }),
  targetInside: ({ root, path }: { root: string; path: string }): LocalTargetInsideDestinationError => ({
    code: "LOCAL_TARGET_INSIDE_DESTINATION",
    message: `${path} is inside the backup destination ${root}; a download never writes there, or it would replace a stored object`,
    path,
    root,
  }),
  targetUnresolvable: ({
    root,
    path,
    why,
  }: {
    root: string;
    path: string;
    why: string;
  }): LocalTargetUnresolvableError => ({
    code: "LOCAL_TARGET_UNRESOLVABLE",
    message: `refused to download to ${path} from ${root}: ${why}; a link that cannot be resolved now could be re-pointed into the destination later`,
    path,
    root,
  }),
  unreachable: ({ root, cause }: { root: string; cause: unknown }): LocalDestinationUnreachableError => ({
    cause,
    code: "LOCAL_DESTINATION_UNREACHABLE",
    message: `backup destination ${root} is not a writable directory: ${errorMessage({ error: cause })}`,
    root,
  }),
  writeFailed: ({
    root,
    objectName,
    cause,
  }: {
    root: string;
    objectName: string;
    cause: unknown;
  }): LocalObjectWriteFailedError => ({
    cause,
    code: "LOCAL_OBJECT_WRITE_FAILED",
    message: `could not write ${root}/${objectName}: ${errorMessage({ error: cause })}`,
    objectName,
    root,
  }),
} as const;
