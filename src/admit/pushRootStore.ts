/**
 * Read and write the push-root register at `$home/push-roots.json` (`./pushRootRegistry.ts` holds the rules).
 *
 * Absent and unreadable are kept apart on purpose: absent guards nothing, while a file that is there and cannot
 * be read refuses every guarded push, because a guard that read a corrupt register as an empty one would let the
 * very push it exists to stop straight through. A write never repairs a malformed file — it refuses.
 */

import { readStrictFileIfPresent } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { acquireOperationLock } from "./operationLock.js";
import {
  type PushRootBinding,
  type PushRootConflictError,
  type PushRootRegistry,
  parsePushRootRegistry,
  recordPushRoot,
} from "./pushRootRegistry.js";

/** What the home holds: no register at all, or a parsed one. */
export type PushRootState =
  { readonly kind: "absent" } | { readonly kind: "present"; readonly registry: PushRootRegistry };

/** The register is there and could not be read, decoded or parsed. */
export interface PushRootUnreadableError {
  readonly code: "PUSH_ROOT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The register could not be written, or its lock could not be taken. */
interface PushRootWriteFailedError {
  readonly code: "PUSH_ROOT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Why the store could not answer. */
export type PushRootStoreError = PushRootUnreadableError | PushRootWriteFailedError;

/** Factories for {@link PushRootStoreError}. */
const PushRootStoreErrors = {
  unreadable: ({ path, why }: { path: string; why: string }): PushRootUnreadableError => ({
    code: "PUSH_ROOT_UNREADABLE",
    message: `the push-root register at ${path} is present and could not be read: ${why}`,
    path,
  }),
  writeFailed: ({ path, why }: { path: string; why: string }): PushRootWriteFailedError => ({
    code: "PUSH_ROOT_WRITE_FAILED",
    message: `the push-root register at ${path} could not be written: ${why}`,
    path,
  }),
} as const;

/** The lock key every register write takes, so two concurrent records cannot lose one another's row. */
const PUSH_ROOT_LOCK_KEY = "push-roots";

/** Owner-only, as every per-install identity file is. */
const FILE_MODE = 0o600;

/** Owner-only, for the directories a first write makes. */
const DIRECTORY_MODE = 0o700;

/**
 * Read the register.
 *
 * @param home the state home
 * @returns absent, the parsed register, or why a present file could not be read
 */
export function readPushRootState({ home }: { home: string }): Result<PushRootState, PushRootUnreadableError> {
  const path = stateHomePaths({ home }).pushRootsJson;
  const read = readStrictFileIfPresent({ operation: "read the push-root register", path });
  if (read.isErr()) {
    return err(PushRootStoreErrors.unreadable({ path, why: read.error.message }));
  }
  if (read.value === null) {
    return ok({ kind: "absent" });
  }
  let decoded: unknown;
  try {
    // One small file this store wrote itself; the schema below bounds what it may hold.
    decoded = JSON.parse(read.value);
  } catch (error: unknown) {
    return err(PushRootStoreErrors.unreadable({ path, why: error instanceof Error ? error.message : String(error) }));
  }
  const parsed = parsePushRootRegistry({ value: decoded });
  if (parsed.isErr()) {
    return err(PushRootStoreErrors.unreadable({ path, why: parsed.error.message }));
  }
  return ok({ kind: "present", registry: parsed.value });
}

/**
 * Record one binding under the register's lock: read, add, write atomically and owner-only. Recording the same
 * root again writes nothing new; a different root for a bound repository refuses and leaves the file untouched.
 *
 * @param home the state home
 * @param binding the binding to add
 * @returns the register as written, or why nothing was
 */
export function writePushRootBinding({
  home,
  binding,
}: {
  home: string;
  binding: PushRootBinding;
}): Result<PushRootRegistry, PushRootConflictError | PushRootStoreError> {
  const path = stateHomePaths({ home }).pushRootsJson;
  const held = acquireOperationLock({ home, key: PUSH_ROOT_LOCK_KEY, nowIso: binding.recordedAtIso });
  if (held.isErr()) {
    return err(PushRootStoreErrors.writeFailed({ path, why: held.error }));
  }
  try {
    const state = readPushRootState({ home });
    if (state.isErr()) {
      return err(state.error);
    }
    const before: PushRootRegistry = state.value.kind === "absent" ? { bindings: [] } : state.value.registry;
    const after = recordPushRoot({ binding, registry: before });
    if (after.isErr()) {
      return err(after.error);
    }
    if (after.value === before) {
      return ok(before);
    }
    try {
      writeFileAtomic({
        contents: `${JSON.stringify(after.value, null, 2)}\n`,
        dirMode: DIRECTORY_MODE,
        exactMode: true,
        fileMode: FILE_MODE,
        path,
      });
    } catch (error: unknown) {
      return err(
        PushRootStoreErrors.writeFailed({ path, why: error instanceof Error ? error.message : String(error) }),
      );
    }
    return ok(after.value);
  } finally {
    held.value.release();
  }
}
