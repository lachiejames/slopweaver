/**
 * The ACTIVITY connections a Linear named-object read may be asked for on top of the object itself — which
 * ones each kind has, how `--include` names them, and the sequential read of the ones asked for.
 *
 * Per kind, because the connections are: an issue has comments, attachments and history; a document has
 * comments (an inline one carries the `quotedText` it is anchored to, a reply its `parentId`) and nothing
 * else; a project has none this reader serves. Asking a kind for a connection it does not have is REFUSED
 * before any request, never dropped: measured, `linear read <document-url> --include comments`
 * printed "no activity connections requested" over a document holding seven comments, because this table was
 * issue-only and the read quietly skipped what it had been told to want.
 */
import { LinearDocument } from "@linear/sdk";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "./errors.js";
import type { LinearReadRequest } from "./read.js";

/** The object kinds a Linear named-object read addresses. */
export type LinearObjectKind = "issue" | "project" | "document";

/** Every activity connection this reader can be asked for, in the order it reports them. */
const ACTIVITY_KINDS = ["comments", "attachments", "history"] as const;

/** One activity connection's name. */
export type LinearActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * The activity connections each object kind HAS, and the SDK document that reads each one. Each SDK document
 * selects its kind's own root field (`issue`, `document`), so the response is read back from that same field.
 */
const ACTIVITY_DOCUMENTS: Readonly<Record<LinearObjectKind, Partial<Record<LinearActivityKind, string>>>> = {
  document: { comments: String(LinearDocument.Document_CommentsDocument) },
  issue: {
    attachments: String(LinearDocument.Issue_AttachmentsDocument),
    comments: String(LinearDocument.Issue_CommentsDocument),
    history: String(LinearDocument.Issue_HistoryDocument),
  },
  project: {},
};

/**
 * Which activity connections a caller needs. Every one defaults to OFF, which is the whole point: a caller
 * that says nothing gets the object and pays for nothing else.
 */
export interface LinearReadInclude {
  /** The issue's or document's comments. A bot composing a reply usually wants these and nothing more. */
  readonly comments?: boolean;
  /** The issue's attachments. */
  readonly attachments?: boolean;
  /** The issue's activity history — the expensive one, and the corpus sync's reason for existing. */
  readonly history?: boolean;
}

/**
 * The connections one object kind has, in {@link ACTIVITY_KINDS} order.
 *
 * @param kind the object kind
 * @returns the connection names a read of that kind can be asked for
 */
export function activityOf({ kind }: { kind: LinearObjectKind }): readonly LinearActivityKind[] {
  return ACTIVITY_KINDS.filter((name) => ACTIVITY_DOCUMENTS[kind][name] !== undefined);
}

/**
 * The activity connections a Linear read may be asked for, parsed from a comma-separated `--include`.
 *
 * A caller asks for the full history only when it needs it. So this defaults to
 * NOTHING — a read with no `--include` sends one request and pays for one — and an unknown name is REFUSED
 * rather than silently ignored, because a typo that quietly drops the comments a caller asked for is the
 * failure this option exists to prevent. Whether the KIND being read has a named connection is a separate
 * question, answered by {@link planLinearActivity} once the address is parsed.
 *
 * It takes its accepted names from {@link ACTIVITY_KINDS} rather than restating them: the set of connections
 * this reader HAS is the same fact as the set `--include` accepts, and two copies of it drift.
 *
 * @param value the raw flag value, as the argv parser produced it
 * @returns the requested connections, or a typed refusal naming the names that are not connections
 */
export function parseLinearReadInclude({ value }: { value: unknown }): Result<LinearReadInclude, LinearLiveError> {
  if (value === undefined) {
    return ok({});
  }
  if (typeof value !== "string") {
    return err(
      LinearLiveErrors.unknownActivity({ known: [...ACTIVITY_KINDS], unknown: ["a value that is not a list"] }),
    );
  }
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const known: readonly string[] = ACTIVITY_KINDS;
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    return err(LinearLiveErrors.unknownActivity({ known, unknown }));
  }
  return ok({
    attachments: names.includes("attachments"),
    comments: names.includes("comments"),
    history: names.includes("history"),
  });
}

/**
 * The connections a read of this kind will fetch: the ones asked for, in a stable order — or the refusal
 * naming any this kind does not have, so nothing asked for is ever silently skipped.
 *
 * @param kind the object kind the address resolved to
 * @param include the caller's declared needs
 * @returns the connections to read, or the typed refusal
 */
export function planLinearActivity({
  kind,
  include,
}: {
  kind: LinearObjectKind;
  include: LinearReadInclude;
}): Result<readonly LinearActivityKind[], LinearLiveError> {
  const wanted = ACTIVITY_KINDS.filter((name) => include[name] === true);
  const available = activityOf({ kind });
  const unavailable = wanted.filter((name) => !available.includes(name));
  if (unavailable.length > 0) {
    return err(LinearLiveErrors.activityUnavailable({ available, kind, unavailable }));
  }
  return ok(wanted);
}

/**
 * Whether one connection node is an object carrying a non-empty string id, the one field every Linear node has.
 *
 * @param node one element of a connection's `nodes`
 * @returns true for a node a read may report as read
 */
function isIdentifiedNode(node: unknown): boolean {
  return isRecord(node) && typeof node["id"] === "string" && node["id"].length > 0;
}

/**
 * Whether a requested connection came back whole: `nodes` that are each an object with an id, and a `pageInfo`
 * saying whether more follow. Anything less is a failed read, because otherwise the connection vanishes from the
 * JSON, or reads empty or complete, while the coverage line still claims it was read.
 * The payload past that stays the provider's; every Linear node carries an id, so that much is the envelope.
 *
 * @param connection the value under the connection's name in the response
 * @returns true for a connection a read may report as read
 */
function isWholeConnection({ connection }: { connection: unknown }): boolean {
  if (!isRecord(connection)) {
    return false;
  }
  const nodes = connection["nodes"];
  const pageInfo = connection["pageInfo"];
  // Each connection is read from its start, so a page saying something comes before it is not that start.
  const stated =
    isRecord(pageInfo) && typeof pageInfo["hasNextPage"] === "boolean" && pageInfo["hasPreviousPage"] === false;
  return Array.isArray(nodes) && nodes.every(isIdentifiedNode) && stated;
}

/**
 * Fetch each planned activity connection, one SDK document per connection.
 *
 * Sequential rather than concurrent, deliberately: the shared transport paces every Linear request against
 * one budget, so firing these in parallel would not make them arrive sooner — it would only hide the cost
 * from the pacer that has to spread it.
 *
 * @param id the object's id
 * @param kind the object kind, which picks each connection's SDK document and the root it answers under
 * @param limit the maximum items requested from each connection
 * @param request the shared safe GraphQL transport
 * @param wanted the connections {@link planLinearActivity} admitted for this kind
 * @returns the connections keyed by name, or the first read failure
 */
export async function readLinearActivity({
  id,
  kind,
  limit,
  request,
  wanted,
}: {
  id: string;
  kind: LinearObjectKind;
  limit: number;
  request: LinearReadRequest;
  wanted: readonly LinearActivityKind[];
}): Promise<Result<Record<string, unknown>, LinearLiveError>> {
  const out: Record<string, unknown> = {};
  for (const name of wanted) {
    const query = ACTIVITY_DOCUMENTS[kind][name];
    if (query === undefined) {
      return err(LinearLiveErrors.activityUnavailable({ available: activityOf({ kind }), kind, unavailable: [name] }));
    }
    const response = await request({ query, variables: { first: limit, id } });
    if (response.isErr()) {
      return err(response.error);
    }
    const root = isRecord(response.value) ? response.value[kind] : undefined;
    const connection = isRecord(root) ? root[name] : undefined;
    if (!isWholeConnection({ connection })) {
      return err(LinearLiveErrors.readFailed({ message: `Linear returned no ${name} connection for ${kind} ${id}` }));
    }
    out[name] = connection;
  }
  return ok(out);
}
