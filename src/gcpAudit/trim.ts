/**
 * One `LogEntry` into the record the store keeps — the fields the least-privilege reading needs, each carried as
 * `null` when Google omitted it, never a substituted value. Request and response bodies stop here: nothing
 * past this function, and nothing on disk, ever holds them.
 *
 * Pure. The event identity is `(logName, timestamp, insertId)`: an aggregated sink can make the same entry
 * visible through more than one searched container, and the summary counts it once. Where Google sent no
 * `insertId`, the identity is a digest of the kept fields and says so.
 */
import { createHash } from "node:crypto";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpAuditError, GcpAuditErrors } from "./errors.js";
import { type GcpContainer, isGcpContainer } from "./transport.js";
import type { GcpLogEntryWire } from "./wire.js";

/** Which audit stream an entry came from. */
export type GcpAuditLogKind = "activity" | "data_access" | "policy" | "system_event";

/** Every {@link GcpAuditLogKind}, so a stream read off a log name is checked rather than asserted. */
const AUDIT_LOG_KINDS: readonly GcpAuditLogKind[] = ["activity", "data_access", "policy", "system_event"];

/**
 * Whether a log name's stream segment is one of the four audit streams.
 *
 * @param value the segment the log-name pattern captured
 * @returns true for `activity`, `data_access`, `policy` or `system_event`
 */
function isAuditLogKind(value: string): value is GcpAuditLogKind {
  return AUDIT_LOG_KINDS.some((kind) => kind === value);
}

/**
 * One permission Google checked for a call.
 *
 * @internal
 */
export interface GcpAuthorizationUse {
  readonly permission: string | null;
  /**
   * Whether Google allowed it. Proto3's JSON mapping OMITS a `false` boolean, so a denied check arrives with no
   * `granted` key at all: absence here is the wire's spelling of `false`, never an unknown.
   */
  readonly granted: boolean;
  readonly resource: string | null;
}

/** One audit entry as the store keeps it. */
export interface TrimmedGcpAuditEntry {
  readonly eventId: string;
  readonly eventIdSource: "insert-id" | "derived";
  readonly timestamp: string;
  readonly logKind: GcpAuditLogKind;
  /** The container the entry originated in, read off its `logName`. */
  readonly origin: GcpContainer;
  readonly principal: string | null;
  readonly serviceName: string | null;
  readonly methodName: string | null;
  readonly resourceName: string | null;
  readonly callerIp: string | null;
  readonly userAgent: string | null;
  /** The call's `google.rpc.Code`; null when Google recorded none, which is how a success is written. */
  readonly statusCode: number | null;
  readonly authorization: readonly GcpAuthorizationUse[];
}

/** `<container>/logs/cloudaudit.googleapis.com%2F<kind>` — the encoded slash is how Logging spells it. */
const AUDIT_LOG_NAME =
  /^((?:organizations|folders|projects|billingAccounts)\/[^/]+)\/logs\/cloudaudit\.googleapis\.com%2F(activity|data_access|policy|system_event)$/;

/**
 * Read an audit entry's origin and stream off its `logName`.
 *
 * @param logName the entry's log name
 * @returns the origin and kind, or `RESPONSE_CHANGED` for a name the filter should never have matched
 */
export function parseAuditLogName({
  logName,
}: {
  logName: string;
}): Result<{ origin: GcpContainer; logKind: GcpAuditLogKind }, GcpAuditError> {
  const match = AUDIT_LOG_NAME.exec(logName);
  const origin = match?.[1];
  const logKind = match?.[2];
  // A billing account matches the pattern and is no container the reader searches, so the guard refuses it.
  if (origin === undefined || logKind === undefined || !isGcpContainer(origin) || !isAuditLogKind(logKind)) {
    return err(
      GcpAuditErrors.responseChanged({
        detail: `entries:list answered log ${logName}, which is not a Cloud Audit Log of an org, folder or project`,
        endpoint: "POST logging v2 entries:list",
      }),
    );
  }
  return ok({ logKind, origin });
}

/**
 * The permissions Google recorded as checked for one call.
 *
 * @param payload the entry's audit payload, absent on an entry that carries none
 * @returns one row per check; empty when the entry has no `authorizationInfo`, which means it checked no
 *   permission Google recorded — an empty list, not an unknown one
 */
function checkedPermissions({ payload }: { payload: GcpLogEntryWire["protoPayload"] }): readonly GcpAuthorizationUse[] {
  const rows = payload?.authorizationInfo;
  if (rows === undefined) {
    return [];
  }
  return rows.map((row) => ({
    granted: row.granted === true,
    permission: unsetFieldAsNull({ key: "permission", record: row }),
    resource: unsetFieldAsNull({ key: "resource", record: row }),
  }));
}

/**
 * Trim one entry into the stored record.
 *
 * @param entry the entry as the `LIST_ENTRIES` boundary validated it
 * @returns the record, or `RESPONSE_CHANGED` when its log name is not an audit log
 */
export function trimAuditEntry({ entry }: { entry: GcpLogEntryWire }): Result<TrimmedGcpAuditEntry, GcpAuditError> {
  const named = parseAuditLogName({ logName: entry.logName });
  if (named.isErr()) {
    return err(named.error);
  }
  const payload = entry.protoPayload;
  const kept = {
    authorization: checkedPermissions({ payload }),
    callerIp: unsetFieldAsNull({ key: "callerIp", record: payload?.requestMetadata }),
    logKind: named.value.logKind,
    methodName: unsetFieldAsNull({ key: "methodName", record: payload }),
    origin: named.value.origin,
    principal: unsetFieldAsNull({ key: "principalEmail", record: payload?.authenticationInfo }),
    resourceName: unsetFieldAsNull({ key: "resourceName", record: payload }),
    serviceName: unsetFieldAsNull({ key: "serviceName", record: payload }),
    statusCode: unsetFieldAsNull({ key: "code", record: payload?.status }),
    timestamp: entry.timestamp,
    userAgent: unsetFieldAsNull({ key: "callerSuppliedUserAgent", record: payload?.requestMetadata }),
  };
  if (entry.insertId !== undefined) {
    return ok({
      ...kept,
      eventId: `${entry.logName}|${entry.timestamp}|${entry.insertId}`,
      eventIdSource: "insert-id",
    });
  }
  const digest = createHash("sha256").update(JSON.stringify(kept)).digest("hex");
  return ok({ ...kept, eventId: `${entry.logName}|${entry.timestamp}|sha256:${digest}`, eventIdSource: "derived" });
}
