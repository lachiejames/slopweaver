/**
 * Read a credential file that only its owner may read, and refuse anything weaker.
 *
 * Four modules had written the same twenty lines — the Vanta, CrowdStrike and JumpCloud credential readers
 * and the browser extension token — and the `duplicate-windows` gate is what made the fourth copy visible
 * rather than the fifth. What they share is not convenience but a POSTURE, and a posture spread across four
 * files is a posture that drifts: one copy relaxing its mode check would look exactly like the others.
 *
 * Three refusals, and each closes a different way a secret stops being owner-only. A symlink is refused by
 * opening with `O_NOFOLLOW`, so a file that points somewhere else is never followed to it. A non-regular
 * file is refused because a FIFO or a device would make reading a credential an unbounded operation. And
 * any mode readable by group or other is refused rather than quietly used, because a loosened mode is the
 * one change nobody notices they made.
 *
 * A refusal names the FILE, never its contents. That is the whole reason the value is returned rather than
 * logged anywhere along the way.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { errorMessage } from "./errorMessage.js";
import { err, ok, type Result } from "./result.js";

/** One refusal of an owner-only file, naming the file by the caller's label and its path. */
interface OwnerOnlyFileRefusal<C extends string> {
  readonly code: C;
  readonly message: string;
  readonly label: string;
  readonly path: string;
}

/**
 * Why an owner-only credential file could not be read — this module's own union, never one another domain
 * adopts. Every variant is one sentence naming the file, never its contents.
 */
export type OwnerOnlyFileError =
  | OwnerOnlyFileRefusal<"NOT_REGULAR_FILE">
  | OwnerOnlyFileRefusal<"MODE_TOO_OPEN">
  | OwnerOnlyFileRefusal<"EMPTY_FILE">
  | (OwnerOnlyFileRefusal<"READ_FAILED"> & { readonly cause: unknown });

/** How to raise one — the factory {@link readOwnerOnlyFile} calls, so a test built the same way catches a drift. */
export const OwnerOnlyFileErrors = {
  emptyFile: ({ label, path }: { label: string; path: string }): OwnerOnlyFileError => ({
    code: "EMPTY_FILE",
    label,
    message: `${label} is empty: ${path}`,
    path,
  }),
  modeTooOpen: ({ label, path }: { label: string; path: string }): OwnerOnlyFileError => ({
    code: "MODE_TOO_OPEN",
    label,
    message: `${label} must be owner-only (mode 0600 or stricter): ${path}`,
    path,
  }),
  notRegularFile: ({ label, path }: { label: string; path: string }): OwnerOnlyFileError => ({
    code: "NOT_REGULAR_FILE",
    label,
    message: `${label} does not name a regular file: ${path}`,
    path,
  }),
  readFailed: ({ cause, label, path }: { cause: unknown; label: string; path: string }): OwnerOnlyFileError => ({
    cause,
    code: "READ_FAILED",
    label,
    message: `could not read ${label} at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/**
 * Read one owner-only credential file.
 *
 * @param label how a refusal should name this file, so a caller's own vocabulary reaches the message
 * @param path the resolved path
 * @returns the trimmed value, or why it could not be read
 */
export function readOwnerOnlyFile({
  label,
  path,
}: {
  label: string;
  path: string;
}): Result<string, OwnerOnlyFileError> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      return err(OwnerOnlyFileErrors.notRegularFile({ label, path }));
    }
    if ((stats.mode & 0o077) !== 0) {
      return err(OwnerOnlyFileErrors.modeTooOpen({ label, path }));
    }
    const value = readFileSync(descriptor, "utf8").trim();
    return value.length === 0 ? err(OwnerOnlyFileErrors.emptyFile({ label, path })) : ok(value);
  } catch (error: unknown) {
    return err(OwnerOnlyFileErrors.readFailed({ cause: error, label, path }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}
