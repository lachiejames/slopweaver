/**
 * Reading one event off the unified event track, in the spelling a Datadog QUERY uses. Pure.
 *
 * ## The envelope, measured rather than assumed
 *
 * MEASURED on this install's site, across all seven tracks: an event arrives as
 * `{ "datadog.index": …, "event_id": …, "event": { … } }`, and the inner object carries the RESERVED
 * attributes at its root (`service`, `status`, `env`, `operation_name`, `resource_name`, `message`,
 * `timestamp`, `tags`, `ci_level`, `test_level`, `dbm_type`, `family`) with every custom attribute under
 * `custom`. That split is exactly Datadog's search syntax: a reserved attribute is queried bare and a custom
 * one takes the `@` sigil. So the flattened path a row stores IS the thing a detective types — `@db.rows`,
 * `status`, `@http.status_code` — rather than a JSON path that has to be translated first.
 *
 * ## The fields that are Datadog's own bookkeeping are dropped
 *
 * `discovery_timestamp`, `random_draw`, `tiebreaker`, `source_fragment_id`, `ingest_size_in_bytes` and the
 * `__dd`/`_dd` trees describe the INGEST rather than the event, and they differ on every single event, so
 * storing them would put a paragraph of noise in every row. The one exception is the log fingerprint, which
 * is read out of `__dd` deliberately and becomes the row's identity.
 */

import { readPath } from "../detective/attributes.js";

/** One event from the unified track, already unwrapped from the transport envelope. */
export interface TrackEvent {
  /** The event's own attribute tree, in the query spelling: reserved bare, custom under `@`. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** The event's message, or nothing on a track that carries none. */
  readonly message: string | null;
  /** The event's own instant, ISO-8601. */
  readonly occurredAtIso: string;
}

/** The top-level fields that describe the ingest rather than the event, and are therefore dropped. */
const INGEST_FIELDS: ReadonlySet<string> = new Set([
  "discovery_timestamp",
  "random_draw",
  "tiebreaker",
  "source_fragment_id",
  "ingest_size_in_bytes",
  "__dd",
  "_dd",
  "hashes",
  "tag",
]);

/** The attribute path a log's own pattern fingerprint sits at, inside the dropped `__dd` tree. */
const FINGERPRINT_PATH = "__dd.log_identity.raw_msg_fingerprint";

/** The facet name a logs query filters that fingerprint by — reserved, so it carries NO `@` sigil. */
export const FINGERPRINT_FACET = "__dd.log_identity.raw_msg_fingerprint";

/**
 * Whether a value is a plain JSON object rather than an array or a primitive.
 *
 * @returns true for a record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The pattern fingerprint one log event carries, or nothing when the track is not logs.
 *
 * Read from the raw event rather than from {@link trackEventAttributes}'s output, because the `__dd` tree it
 * sits in is dropped there as ingest bookkeeping — this one field is the exception, and naming it here is
 * what keeps that exception visible.
 *
 * @param event the inner `event` object, exactly as the track returned it
 * @returns the fingerprint, or nothing
 */
export function eventFingerprint({ event }: { event: unknown }): string | null {
  const value = readPath({ path: FINGERPRINT_PATH, value: event });
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Turn one track event's inner object into the attribute tree a row is folded from.
 *
 * @param event the inner `event` object, exactly as the track returned it
 * @returns the tree, with custom attributes under their `@` names and ingest bookkeeping dropped
 */
export function trackEventAttributes({ event }: { event: unknown }): Readonly<Record<string, unknown>> {
  if (!isRecord(event)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (INGEST_FIELDS.has(key)) {
      continue;
    }
    if (key === "custom" && isRecord(value)) {
      for (const [customKey, customValue] of Object.entries(value)) {
        out[`@${customKey}`] = customValue;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read one attribute off a track event, whether its name is a dotted KEY or a nested path.
 *
 * Both, because Datadog uses both and the difference is invisible at the call site: `@db.query_signature` is
 * a single key containing dots, while `service` sits at the root and `info.application.service` is a real
 * nesting. {@link readPath} splits on `.` and therefore cannot address the first kind at all — the same trap
 * `attributes.flattenLeafValues` documents, met here on the census side, where it made every database-query
 * row key itself `(none)`.
 *
 * @param attributes the already-mapped attribute tree
 * @param path the query-spelled path to read
 * @returns the value, or nothing when neither reading finds one
 */
export function trackValue({
  attributes,
  path,
}: {
  attributes: Readonly<Record<string, unknown>>;
  path: string;
}): unknown {
  const direct = attributes[path];
  if (direct !== undefined) {
    return direct;
  }
  return readPath({ path, value: attributes });
}

/**
 * Read one string field off a track event, answering nothing rather than an empty string.
 *
 * @param attributes the already-mapped attribute tree
 * @param path the query-spelled path to read
 * @returns the value, or nothing when it is absent or not a string
 */
export function trackString({
  attributes,
  path,
}: {
  attributes: Readonly<Record<string, unknown>>;
  path: string;
}): string | null {
  const value = trackValue({ attributes, path });
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * One event's instant, said out loud for an event that arrived without a timestamp of its own.
 *
 * @param attributes the already-mapped attribute tree
 * @param fallbackIso the instant to place an undated event at — the window's own far edge
 * @returns the ISO instant
 */
export function trackInstant({
  attributes,
  fallbackIso,
}: {
  attributes: Readonly<Record<string, unknown>>;
  fallbackIso: string;
}): string {
  const stamped = trackString({ attributes, path: "timestamp" });
  if (stamped === null) {
    return fallbackIso;
  }
  return stamped;
}

/**
 * Turn one raw event of a track into the shape a fold consumes.
 *
 * @param raw one element of the track response's `result.events`
 * @param fallbackIso the instant an undated event is placed at
 * @returns the event, or nothing when the element carries no inner event at all
 */
export function readTrackEvent({
  raw,
  fallbackIso,
}: {
  raw: unknown;
  fallbackIso: string;
}): { event: TrackEvent; fingerprint: string | null } | null {
  if (!isRecord(raw)) {
    return null;
  }
  const inner = raw["event"];
  if (!isRecord(inner)) {
    return null;
  }
  const attributes = trackEventAttributes({ event: inner });
  return {
    event: {
      attributes,
      message: trackString({ attributes, path: "message" }),
      occurredAtIso: trackInstant({ attributes, fallbackIso }),
    },
    fingerprint: eventFingerprint({ event: inner }),
  };
}
