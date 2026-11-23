/**
 * A Datadog event as the store's own disclosure ladder addresses it — the `dd:` record. Pure.
 *
 * ## Why a record type at all, when the store already has one
 *
 * Because a Datadog event is not a store row and pretending otherwise loses the two fields a detective needs
 * most. A store row has an author and a container; a Datadog event has a service and a trace. Mapping one
 * onto the other would put a `service` in a field called `author` and make every rendered line a small lie.
 *
 * So `dd:` records are their own shape, and what they SHARE with a store row is the addressing — an id, an
 * instant, an excerpt, and the same six verbs — which is the part the vocabulary rule is actually about.
 *
 * ## Nothing here is masked, and that is the owner's ruling rather than an oversight
 *
 * RUM and user identity in live hits are shown as they are: a detective sees what the owner sees and redacts PII
 * before posting into Slack. Redaction mid-investigation is a hindrance and not the detective's responsibility;
 * and correlating by IP is a useful move the owner makes during investigations (when a user id is not in the
 * log, check which logs or other telemetry came from that IP address and whether any carried a uid).
 *
 * So `usr.id`, `usr.email`, `session.ip` and every other field arrive intact, and the IP-to-uid correlation
 * is a supported move rather than an accident — {@link ../../store/probe/disclose}'s `around`
 * mode `session` is what performs it. The redaction happens at the Slack post
 * ({@link ../../outbound/slack/piiRedaction}), which is the one place where an audience appears.
 *
 * The STORED shape catalogue is the opposite rule and they do not conflict: a shape row is kept forever and
 * an event is kept for fifteen days, so a row carrying a user id would be a retention decision nobody made.
 * {@link ./facets} is where that rule lives.
 */

import { readPath } from "./attributes.js";
import type { ShapeFamily } from "./family.js";

/** The prefix every Datadog record id carries, so a `dd:` id can never be confused with a store UUID. *
 * @internal
 */
export const DATADOG_ID_PREFIX = "dd:";

/** One Datadog event, addressed and rendered the way the disclosure ladder needs. */
export interface DatadogRecord {
  /** `dd:<family>:<datadog event id>` — the address every verb here takes. */
  readonly id: string;
  readonly family: ShapeFamily;
  readonly service: string;
  readonly env: string;
  readonly status: string | null;
  readonly occurredAtIso: string;
  /** The event's own message, or the resource it names when its family carries no message. */
  readonly text: string;
  /** The whole attribute tree, unmasked. */
  readonly attributes: unknown;
  /** The console address this event can be opened at. */
  readonly link: string;
}

/**
 * The id one Datadog event is addressed by.
 *
 * The family rides in the id because the three surfaces have separate indexes and a later verb has to know
 * which one to re-query for `around` — and because Datadog's own event ids are opaque base64 that carry no
 * surface marker a reader could use.
 *
 * @returns the `dd:` id
 */
export function datadogRecordId({ family, eventId }: { family: ShapeFamily; eventId: string }): string {
  return `${DATADOG_ID_PREFIX}${family}:${eventId}`;
}

/**
 * Split a `dd:` id back into the family and the event id.
 *
 * @param id the `dd:` id
 * @returns its parts, or nothing when the string is not one
 */
export function parseDatadogRecordId({ id }: { id: string }): { family: string; eventId: string } | null {
  if (!id.startsWith(DATADOG_ID_PREFIX)) {
    return null;
  }
  const rest = id.slice(DATADOG_ID_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) {
    return null;
  }
  return { eventId: rest.slice(cut + 1), family: rest.slice(0, cut) };
}

/**
 * Whether an id addresses a Datadog event rather than a store row.
 *
 * @returns true when the id is a `dd:` one
 */
export function isDatadogId({ id }: { id: string }): boolean {
  return parseDatadogRecordId({ id }) !== null;
}

/**
 * The correlation keys one event carries — what `around` re-queries on.
 *
 * The four modes are the ones a person actually uses at the Explorer, and the fourth is the owner's own: a
 * `session.ip` with no `usr.id` on it is the start of the IP-to-uid correlation, so the IP is a first-
 * class correlation key here rather than an attribute that happens to be readable.
 *
 * @param attributes the event's own attribute tree
 * @returns each key, or nothing when the event does not carry it
 */
export function correlationKeys({ attributes }: { attributes: unknown }): {
  traceId: string | null;
  requestId: string | null;
  sessionId: string | null;
  ip: string | null;
} {
  const read = ({ paths }: { paths: readonly string[] }): string | null => {
    for (const path of paths) {
      const value = readPath({ path, value: attributes });
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      if (typeof value === "number") {
        return String(value);
      }
    }
    return null;
  };
  return {
    ip: read({ paths: ["session.ip", "attributes.session.ip", "network.client.ip", "attributes.network.client.ip"] }),
    requestId: read({ paths: ["requestId", "attributes.requestId", "http.request_id", "attributes.http.request_id"] }),
    sessionId: read({ paths: ["session.id", "attributes.session.id", "usr.session_id", "attributes.usr.session_id"] }),
    traceId: read({ paths: ["trace_id", "attributes.trace_id", "dd.trace_id", "attributes.dd.trace_id"] }),
  };
}
