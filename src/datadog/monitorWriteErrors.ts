/**
 * The typed failures of reading, changing and deleting a Datadog monitor through `slopweaver datadog monitor`.
 *
 * A union of its own per `.claude/rules/error-handling.md`: a caller branches on `code` (the shell picks an exit
 * code by it) and displays `message`. The one POLICY refusal with a hatch, the IaC-managed one, carries its
 * four-line refusal as `lines` from the register's renderer rather than wording it here.
 */
import { client } from "@datadog/datadog-api-client";

import { errorMessage } from "../lib/errorMessage.js";

/** A `--patch` document that is not JSON, or names a field this verb does not change. */
export interface MonitorPatchInvalidError {
  readonly code: "PATCH_INVALID";
  readonly message: string;
}

/** The patch, applied to the live monitor, changes nothing — there is nothing to approve. */
export interface MonitorNoChangeError {
  readonly code: "NO_CHANGE";
  readonly message: string;
  readonly id: number;
}

/** The patch would break the alert-only rule: a recovery block, or a non-zero renotify interval. */
export interface MonitorAlertOnlyRefusedError {
  readonly code: "ALERT_ONLY_REFUSED";
  readonly message: string;
  readonly id: number;
  readonly violations: readonly string[];
}

/** The monitor is managed by infrastructure-as-code, and no `--iac-override` named why this edit is an exception. */
export interface MonitorIacManagedRefusedError {
  readonly code: "IAC_MANAGED_REFUSED";
  readonly message: string;
  readonly ids: readonly number[];
  /** The four-line refusal, as the escape-hatch renderer wrote it. */
  readonly lines: readonly string[];
}

/** Datadog's own `can_delete` check refused one or more of the ids — something still references them. */
export interface MonitorCannotDeleteError {
  readonly code: "CANNOT_DELETE";
  readonly message: string;
  readonly blocked: Readonly<Record<string, readonly string[]>>;
}

/** The `can_delete` check itself failed, so whether anything still references these monitors is unknown. */
export interface MonitorDeleteCheckFailedError {
  readonly code: "DELETE_CHECK_FAILED";
  readonly message: string;
  readonly ids: readonly number[];
}

/** A monitor could not be read, so nothing about it is known — not even that it exists. */
export interface MonitorReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly id: number;
}

/** Datadog's validator refused the monitor the patch would produce, so the PUT would have been refused too. */
export interface MonitorValidateRejectedError {
  readonly code: "VALIDATE_REJECTED";
  readonly message: string;
  readonly id: number;
}

/** Datadog refused a write. `doneBefore` names the ids this run had already changed, because those stand. */
export interface MonitorWriteRejectedError {
  readonly code: "WRITE_REJECTED";
  readonly message: string;
  readonly id: number;
  readonly doneBefore: readonly number[];
}

/** Every way a monitor read, update or delete can fail. */
export type DatadogMonitorWriteError =
  | MonitorPatchInvalidError
  | MonitorNoChangeError
  | MonitorAlertOnlyRefusedError
  | MonitorIacManagedRefusedError
  | MonitorCannotDeleteError
  | MonitorDeleteCheckFailedError
  | MonitorReadFailedError
  | MonitorValidateRejectedError
  | MonitorWriteRejectedError;

/** A thrown SDK failure, in one line: the HTTP status and Datadog's own error text where there is one. */
function describeMonitorCause({ cause }: { cause: unknown }): string {
  if (cause instanceof client.ApiException) {
    return `HTTP ${String(cause.code)} ${JSON.stringify(cause.body)}`;
  }
  return errorMessage({ error: cause });
}

/** The factories the real code calls, so a test fixture is built the same way the product builds one. */
export const DatadogMonitorWriteErrors = {
  alertOnlyRefused: ({
    id,
    violations,
  }: {
    id: number;
    violations: readonly string[];
  }): MonitorAlertOnlyRefusedError => ({
    code: "ALERT_ONLY_REFUSED",
    id,
    message:
      `refusing to change monitor ${String(id)}: monitors here are alert-only — no recovery block and a renotify ` +
      `interval of 0, by the owner's standing rule. This change ${violations.join("; ")}. There is no override; ` +
      "drop that part of the change and preview again",
    violations,
  }),
  cannotDelete: ({ blocked }: { blocked: Readonly<Record<string, readonly string[]>> }): MonitorCannotDeleteError => ({
    blocked,
    code: "CANNOT_DELETE",
    message:
      "Datadog's can_delete check refused " +
      Object.entries(blocked)
        .map(([id, reasons]) => `${id} (${reasons.join("; ")})`)
        .join(", ") +
      " — remove what still references each one first, or drop it from the list; nothing was deleted",
  }),
  deleteCheckFailed: ({ ids, cause }: { ids: readonly number[]; cause: unknown }): MonitorDeleteCheckFailedError => ({
    code: "DELETE_CHECK_FAILED",
    ids,
    message:
      `Datadog's can_delete check failed for ${ids.map(String).join(", ")}: ${describeMonitorCause({ cause })} — ` +
      "whether anything still references them is unknown, so nothing was deleted",
  }),
  iacManagedRefused: ({
    ids,
    lines,
  }: {
    ids: readonly number[];
    lines: readonly string[];
  }): MonitorIacManagedRefusedError => ({
    code: "IAC_MANAGED_REFUSED",
    ids,
    lines,
    message: lines.join("\n"),
  }),
  noChange: ({ id }: { id: number }): MonitorNoChangeError => ({
    code: "NO_CHANGE",
    id,
    message: `monitor ${String(id)} already reads exactly what this change asks for — there is nothing to write`,
  }),
  patchInvalid: ({ detail }: { detail: string }): MonitorPatchInvalidError => ({
    code: "PATCH_INVALID",
    message: `not a monitor change: ${detail}`,
  }),
  readFailed: ({ id, cause }: { id: number; cause: unknown }): MonitorReadFailedError => ({
    code: "READ_FAILED",
    id,
    message: `could not read monitor ${String(id)}: ${describeMonitorCause({ cause })} — nothing was changed`,
  }),
  validateRejected: ({ id, cause }: { id: number; cause: unknown }): MonitorValidateRejectedError => ({
    code: "VALIDATE_REJECTED",
    id,
    message:
      `Datadog's validator refused monitor ${String(id)} as this change would leave it: ` +
      `${describeMonitorCause({ cause })} — nothing was changed`,
  }),
  writeRejected: ({
    id,
    cause,
    doneBefore,
  }: {
    id: number;
    cause: unknown;
    doneBefore: readonly number[];
  }): MonitorWriteRejectedError => ({
    code: "WRITE_REJECTED",
    doneBefore,
    id,
    message:
      `Datadog refused the write to monitor ${String(id)}: ${describeMonitorCause({ cause })} — ` +
      `${String(doneBefore.length)} monitor(s) had already been changed by this run` +
      (doneBefore.length > 0 ? ` (${doneBefore.map(String).join(", ")})` : ""),
  }),
} as const;
