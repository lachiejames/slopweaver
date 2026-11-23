/**
 * The Vault leg's own typed error union (`./vault.ts`). Kept apart from `BackupError` because every failure here
 * is about the `vault.secrets` table — rows its own key cannot open, a target that already holds secrets, a count
 * that did not come back — and a caller in `./run.ts` or `./restore.ts` folds one into its own union at the seam.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** Some `vault.secrets` rows did not decrypt under the database's own key, so they cannot be carried forward. */
export interface VaultUndecryptableError {
  readonly code: "VAULT_UNDECRYPTABLE";
  readonly message: string;
  readonly rows: number;
}

/** A restore target whose `vault.secrets` already holds rows, which an import would sit beside rather than replace. */
export interface VaultTargetNotEmptyError {
  readonly code: "VAULT_TARGET_NOT_EMPTY";
  readonly message: string;
  readonly rows: number;
}

/** The import created, or the target holds, a different number of secrets than the backup recorded. */
export interface VaultCountMismatchError {
  readonly code: "VAULT_COUNT_MISMATCH";
  readonly message: string;
  readonly expected: number;
  readonly found: string;
}

/** A step under the leg — a `psql`, the seal or the open, a scratch file — failed; `cause` is what it said. */
export interface VaultStepFailedError {
  readonly code: "VAULT_STEP_FAILED";
  readonly message: string;
  readonly step: string;
  readonly cause: unknown;
}

/**
 * A cause's display text: a typed error's own `message` when it carries one, else whatever was thrown.
 *
 * @param cause a typed error from a step under the leg, or a caught throw
 * @returns the line to quote
 */
function causeText({ cause }: { cause: unknown }): string {
  if (typeof cause === "object" && cause !== null && !(cause instanceof Error) && "message" in cause) {
    const message: unknown = cause.message;
    if (typeof message === "string") {
      return message;
    }
  }
  return errorMessage({ error: cause });
}

/** Every way the Vault leg fails. */
export type VaultError =
  VaultCountMismatchError | VaultStepFailedError | VaultTargetNotEmptyError | VaultUndecryptableError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VaultErrors = {
  countMismatch: ({ expected, found }: { expected: number; found: string }): VaultCountMismatchError => ({
    code: "VAULT_COUNT_MISMATCH",
    expected,
    found,
    message: `the Vault leg expected ${String(expected)} secret(s) and found ${JSON.stringify(found)}`,
  }),
  stepFailed: ({ step, cause }: { step: string; cause: unknown }): VaultStepFailedError => ({
    cause,
    code: "VAULT_STEP_FAILED",
    message: `the Vault leg could not ${step}: ${causeText({ cause })}`,
    step,
  }),
  targetNotEmpty: ({ rows }: { rows: number }): VaultTargetNotEmptyError => ({
    code: "VAULT_TARGET_NOT_EMPTY",
    message: `the restore target's vault.secrets already holds ${String(rows)} row(s); an import would sit beside them, so nothing was imported`,
    rows,
  }),
  undecryptable: ({ rows }: { rows: number }): VaultUndecryptableError => ({
    code: "VAULT_UNDECRYPTABLE",
    message: `${String(rows)} vault.secrets row(s) do not decrypt under this database's key, so the backup cannot carry them`,
    rows,
  }),
} as const;
