/**
 * The parser for a schema-1 held-queue row — one that carries a thread target but no addressing timestamp.
 *
 * A schema-1 `held` row has `channel`/`threadTs` but no `messageTs`, and inventing one by copying `threadTs`
 * is exactly the reconstruction {@link AskIdentity} exists to forbid, just moved to the read side. So a
 * schema-1 row is read through its OWN shape, explicitly versioned, and is never upgraded to an identity it
 * never earned: it records a `thread-only` identity.
 */
import { isRecord } from "../lib/parsers.js";
import type { RecordedAskIdentity } from "../live/ask/identity.js";
import type { ReplySurface } from "./withhold.js";

/** A held reply carrying a thread target and no addressing timestamp — the schema-1 body. */
export interface SchemaOneHeldReply {
  readonly channel: string;
  readonly threadTs: string;
  readonly surface: ReplySurface;
  readonly askedBy: string;
  readonly question: string;
  readonly code: string;
  readonly reason: string;
  readonly draft: Readonly<Record<string, unknown>>;
}

/** A whole schema-1 `held` queue row, exactly as it is stored. */
export interface SchemaOneAskRow {
  readonly schemaVersion: 1;
  readonly kind: "held";
  readonly id: string;
  readonly tsIso: string;
  readonly held: SchemaOneHeldReply;
}

/** Whether a decoded value carries every field a {@link SchemaOneHeldReply} declares. */
function isSchemaOneHeldReply(value: unknown): value is SchemaOneHeldReply {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["channel"] === "string" &&
    typeof value["threadTs"] === "string" &&
    (value["surface"] === "channel" || value["surface"] === "dm") &&
    typeof value["askedBy"] === "string" &&
    typeof value["question"] === "string" &&
    typeof value["code"] === "string" &&
    typeof value["reason"] === "string" &&
    isRecord(value["draft"])
  );
}

/**
 * Parse one decoded queue-log row as a schema-1 `held` row — schema 1, explicitly, never inferred from a
 * missing field.
 *
 * @param value the decoded JSON value
 * @returns the schema-1 row, or `undefined` when it is not one
 */
export function parseSchemaOneAskRow({ value }: { value: unknown }): SchemaOneAskRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["schemaVersion"] !== 1 || value["kind"] !== "held") {
    return undefined;
  }
  if (typeof value["id"] !== "string" || typeof value["tsIso"] !== "string") {
    return undefined;
  }
  const held = value["held"];
  if (!isSchemaOneHeldReply(held)) {
    return undefined;
  }
  return { held, id: value["id"], kind: "held", schemaVersion: 1, tsIso: value["tsIso"] };
}

/**
 * The recorded identity a schema-1 held reply carries — the truthful thread target, and nothing invented.
 *
 * @param held the schema-1 held reply
 * @returns the `quality: "thread-only"` recorded identity
 */
export function threadOnlyRecordedAskIdentity({
  held,
}: {
  held: SchemaOneHeldReply;
}): Extract<RecordedAskIdentity, { quality: "thread-only" }> {
  return { channel: held.channel, quality: "thread-only", threadTs: held.threadTs };
}
