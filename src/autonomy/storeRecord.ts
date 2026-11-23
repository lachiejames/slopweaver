/**
 * One validated autonomy record as the `autonomy_event` row it becomes, and back. Pure.
 *
 * Both writers — the port (`./storePort.ts`) and the one-time import (`../store/fleet/autonomyEvent.ts`) — go
 * through {@link autonomyEventRow}, so a written act and an imported one are the same shape and a re-import
 * compares like with like.
 *
 * ## The record is the authority, the columns are projections
 *
 * `record` holds the validated record verbatim; every scalar column is derived from it for an index. An act
 * carries fields no column names (`said`, a class steer's `kinds`, `anchor` and `subjectPrefix`), and its
 * instant is whatever precision the session wrote, which `occurred_at`'s milliseconds cannot always hold.
 *
 * ## Why the stored text is serialised here, from a copy that inherits nothing
 *
 * `JSON.stringify` calls any `toJSON` it can reach through the prototype chain, so an `Object.prototype.toJSON`
 * installed elsewhere in the process could rewrite an act on its way into the store after every rule had
 * approved it. Left to drizzle, the jsonb
 * column is stringified from whatever object the row carries; and drizzle cannot be handed a prototype-less
 * object, because it classifies a bound value by `Object.getPrototypeOf(value).constructor` and throws.
 *
 * So the two writers bind {@link boundAutonomyEventRow}: the record is copied with every object and array
 * detached from its prototype, serialised HERE, and bound as text cast to jsonb. Drizzle sees one string and
 * stringifies nothing, and what is stored is a function of the validated record alone.
 */
import { sql } from "drizzle-orm";
import type { PgInsertValue } from "drizzle-orm/pg-core";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { autonomyEventTable, NewAutonomyEventRecord } from "../store/schema/ledgers.js";
import { validateAutonomyRecord } from "./decode.js";
import type { AutonomyError } from "./errors.js";
import { isSteerRecord } from "./row.js";
import { type AutonomyRecordUnstorableError, AutonomyStoreErrors } from "./storeErrors.js";
import type { AutonomyRecord } from "./types.js";

/**
 * The record as an envelope holding only its own fields. A field present as `undefined` is dropped here rather
 * than by the driver, so the envelope IS what `jsonb` stores and the import's read-back compares like with like.
 * `Object.fromEntries` defines every key as an OWN property, so a `__proto__` field stays a field rather than
 * becoming the prototype. It is never what gets serialised: {@link autonomyRecordJson} is.
 *
 * @param record the validated record
 * @returns a copy with no undefined field
 */
function detachedEnvelope({ record }: { record: AutonomyRecord }): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/**
 * A deep copy in which no object or array reaches a prototype, so serialising it can call no inherited `toJSON`.
 * A function anywhere in it throws rather than being copied: an own callable `toJSON` would otherwise be invoked by
 * `JSON.stringify` and replace the whole object. {@link autonomyEventRow} refuses a function as unstorable first, so
 * reaching this throw means a caller skipped that scan — an invariant broken, never a record to store.
 */
function detachedJsonValue({ value }: { value: unknown }): unknown {
  if (typeof value === "function") {
    throw new TypeError("autonomyRecordJson was handed a function, which autonomyEventRow refuses as unstorable");
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value.map((item: unknown) => detachedJsonValue({ value: item }));
    return Object.setPrototypeOf(items, null) as unknown;
  }
  if (isRecord(value)) {
    // `Object.fromEntries` defines each key as an own property, so a `__proto__` key stays a field.
    const detached: Record<string, unknown> = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, detachedJsonValue({ value: item })]),
    );
    Object.setPrototypeOf(detached, null);
    return detached;
  }
  return value;
}

/**
 * The exact JSON text a record is stored as, serialised from a copy that inherits nothing.
 *
 * @param record the envelope a row carries
 * @returns its JSON text, whatever `toJSON` the process has installed on a shared prototype
 */
export function autonomyRecordJson({ record }: { record: Readonly<Record<string, unknown>> }): string {
  return JSON.stringify(detachedJsonValue({ value: record }));
}

/**
 * A row as the insert binds it: the record as its own serialised text, cast to jsonb, so drizzle stringifies
 * nothing. The cast goes through `text` so the parameter is a string whatever the driver does with a jsonb one.
 *
 * @param row the row {@link autonomyEventRow} built
 * @returns the insert value both writers pass to drizzle
 */
export function boundAutonomyEventRow({
  row,
}: {
  row: NewAutonomyEventRecord;
}): PgInsertValue<typeof autonomyEventTable> {
  if (row.record == null) {
    return row;
  }
  return { ...row, record: sql`cast(${autonomyRecordJson({ record: row.record })} as text)::jsonb` };
}

/** Why an array's items cannot be stored verbatim, if one cannot: a hole serialises as `null`, a value nobody wrote. */
function arrayUnstorableReason({ value }: { value: readonly unknown[] }): string | undefined {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return "it holds an array with a hole, which JSON would store as null";
    }
    const reason = unstorableValueReason({ value: value[index] });
    if (reason !== undefined) {
      return reason;
    }
  }
  return undefined;
}

/** Why an object's keys and values cannot be stored verbatim, if one cannot: an `undefined` value JSON would drop. */
function objectUnstorableReason({ value }: { value: Readonly<Record<string, unknown>> }): string | undefined {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return "it holds an object that is not a plain record, which JSON cannot hold verbatim";
  }
  for (const [key, item] of Object.entries(value)) {
    const keyReason = unstorableReason({ value: key });
    if (keyReason !== undefined) {
      return keyReason;
    }
    if (item === undefined) {
      return `it holds an undefined value at ${JSON.stringify(key)}, which JSON would drop`;
    }
    const reason = unstorableValueReason({ value: item });
    if (reason !== undefined) {
      return reason;
    }
  }
  return undefined;
}

/**
 * Why a value cannot reach the store verbatim as JSON, if it cannot: every string (object KEYS included, since a key
 * is serialised as surely as a value) must be one Postgres holds, and every other value must be one `JSON.stringify`
 * writes as itself — so a BigInt, a function, a non-finite number or a class instance is refused here, as
 * unstorable, rather than throwing or being rewritten later inside the insert, where it would read as an outage.
 * Read without consulting the prototype chain.
 */
function unstorableValueReason({ value }: { value: unknown }): string | undefined {
  if (typeof value === "string") {
    return unstorableReason({ value });
  }
  if (value === null || typeof value === "boolean") {
    return undefined;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return undefined;
    }
    return `it holds the number ${String(value)}, which JSON cannot hold`;
  }
  if (Array.isArray(value)) {
    return arrayUnstorableReason({ value });
  }
  if (isRecord(value)) {
    return objectUnstorableReason({ value });
  }
  return `it holds a ${typeof value} value, which JSON cannot hold`;
}

/**
 * Why Postgres cannot hold a string verbatim, if it cannot. `text` and `jsonb` both refuse a NUL byte, and `jsonb`
 * refuses a lone UTF-16 surrogate's escape outright, while `text` would silently store U+FFFD in its place.
 */
function unstorableReason({ value }: { value: string }): string | undefined {
  if (value.includes("\u0000")) {
    return "it holds a NUL byte";
  }
  if (!value.isWellFormed()) {
    return "it holds a lone UTF-16 surrogate";
  }
  return undefined;
}

/** Whether an ISO instant's calendar date is one its month has; JavaScript rolls a leap day in a non-leap year over to the next month. */
function namesARealDay({ iso }: { iso: string }): boolean {
  const date = /^(\d{4})-(\d{2})-(\d{2})/u.exec(iso);
  if (date === null) {
    return true;
  }
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysIn = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysIn !== undefined && day >= 1 && day <= daysIn;
}

/**
 * The instant a record names, as `occurred_at` can hold it. JavaScript reads `0000-…` as a finite instant (1 BC),
 * while Postgres has no year zero and refuses it, and JavaScript rolls a day the month does not have into the
 * next month, which would index the act at an instant nobody named; both are unstorable rather than a store
 * outage or a silently moved instant.
 */
function storableInstant({
  actionId,
  iso,
}: {
  actionId: string;
  iso: string;
}): Result<Date, AutonomyRecordUnstorableError> {
  const occurredAt = new Date(iso);
  if (Number.isNaN(occurredAt.getTime()) || !namesARealDay({ iso })) {
    return err(AutonomyStoreErrors.recordUnstorable({ actionId, reason: `${iso} is not an instant` }));
  }
  if (occurredAt.getUTCFullYear() < 1) {
    return err(
      AutonomyStoreErrors.recordUnstorable({ actionId, reason: `${iso} is before year 1, which Postgres cannot hold` }),
    );
  }
  // The driver binds `toISOString()`, which spells a UTC year past 9999 in the signed expanded form Postgres
  // refuses — reachable from a four-digit local instant whose offset carries it over the boundary.
  if (occurredAt.getUTCFullYear() > 9999) {
    return err(
      AutonomyStoreErrors.recordUnstorable({
        actionId,
        reason: `${iso} falls after year 9999 in UTC, which the store cannot bind`,
      }),
    );
  }
  return ok(occurredAt);
}

/** A nullable column's value: the field when the record carries it, a stated NULL when it does not. */
function columnOf({ value }: { value: string | undefined }): string | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * The row one VALIDATED record becomes, under the key its writer chose.
 *
 * Postgres refuses a NUL byte and a lone UTF-16 surrogate, and stripping or replacing one would store a record
 * nobody wrote, so a record holding one is refused instead — as is any value JSON cannot write as itself (a BigInt,
 * a non-finite number, a class instance), which would otherwise throw or be rewritten inside the insert. The scan reads the ROW about to be bound — every
 * column and the envelope that is serialised — rather than the record it came from, so a field the record holds
 * in a shape a scan of the record would skip (a non-enumerable property, say) cannot reach the insert unchecked.
 *
 * @param record a record `validateAutonomyRecord` returned — never a caller's object
 * @param importKey the row's idempotence key
 * @returns the row, or why the store cannot hold the record verbatim
 */
export function autonomyEventRow({
  record,
  importKey,
}: {
  record: AutonomyRecord;
  importKey: string;
}): Result<NewAutonomyEventRecord, AutonomyRecordUnstorableError> {
  return projectedEventRow({ importKey, record }).andThen((row) => {
    for (const [column, value] of Object.entries(row)) {
      // `occurred_at` is the one column that is not JSON: an instant `storableInstant` already checked.
      const reason = column === "occurredAt" ? undefined : unstorableValueReason({ value });
      if (reason !== undefined) {
        return err(AutonomyStoreErrors.recordUnstorable({ actionId: record.actionId, reason }));
      }
    }
    return ok(row);
  });
}

/** The row a record projects to, before anything checks Postgres can hold it. */
function projectedEventRow({
  record,
  importKey,
}: {
  record: AutonomyRecord;
  importKey: string;
}): Result<NewAutonomyEventRecord, AutonomyRecordUnstorableError> {
  const envelope = detachedEnvelope({ record });
  if (isSteerRecord(record)) {
    const steeredAt = storableInstant({ actionId: record.actionId, iso: record.steeredIso });
    if (steeredAt.isErr()) {
      return err(steeredAt.error);
    }
    const occurredAt = steeredAt.value;
    return ok({
      actionId: record.actionId,
      bySession: record.bySession,
      entryKind: "steer",
      importKey,
      kind: null,
      occurredAt,
      record: envelope,
      run: null,
      steer: record.steer,
      subject: null,
      why: null,
      witness: null,
    });
  }
  const doneAt = storableInstant({ actionId: record.actionId, iso: record.doneIso });
  if (doneAt.isErr()) {
    return err(doneAt.error);
  }
  const occurredAt = doneAt.value;
  return ok({
    actionId: record.actionId,
    bySession: record.bySession,
    entryKind: "action",
    importKey,
    kind: record.kind,
    occurredAt,
    record: envelope,
    run: columnOf({ value: record.run }),
    steer: columnOf({ value: record.steer }),
    subject: record.subject,
    why: record.why,
    witness: record.witness,
  });
}

/**
 * Validate a value as a record and project it, so a caller cannot store a record that skipped the rules.
 *
 * @param value the record to write — re-validated here, and only the validated copy is stored
 * @param importKey derives the row's key from the VALIDATED record
 * @returns the validated record and its row, or the rule or the store limit that refused it
 */
export function validatedAutonomyEventRow({
  value,
  importKey,
}: {
  value: unknown;
  importKey: (request: { readonly record: AutonomyRecord }) => string;
}): Result<
  { readonly record: AutonomyRecord; readonly row: NewAutonomyEventRecord },
  AutonomyError | AutonomyRecordUnstorableError
> {
  const validated = validateAutonomyRecord({ value });
  if (validated.isErr()) {
    return err(validated.error);
  }
  const record = validated.value;
  return autonomyEventRow({ importKey: importKey({ record }), record }).map((row) => ({ record, row }));
}
