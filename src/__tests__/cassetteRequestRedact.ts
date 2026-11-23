/**
 * REQUEST-side cassette safety — the position the recorder never looked at.
 *
 * Response bodies have been allowlist-redacted since PR5.4. Request bodies were not, and for a read-only
 * lane that was survivable: a GraphQL read sends a cursor and a page size. A WRITE inverts it. The create
 * mutation's variables carry the destination team id and the entire issue description, so for the first time
 * the most sensitive bytes in the exchange are the ones going OUT.
 *
 * Two independent gaps, both verified against the code rather than assumed:
 *
 *  1. `setup-polly.ts` passed only the RESPONSE body and the URL to the record-time tripwire, so nothing ever
 *     inspected a request body before it was committed.
 *  2. A GraphQL request body received only `scrubGeneric` — leak-class regexes plus literals pre-seeded from
 *     `$SLOPWEAVER_HOME`. Those classes match an UPPER-case id with a digit, a token shape, a home path and
 *     an email. **A lowercase UUID matches none of them**, and a lowercase UUID is exactly Linear's id
 *     format. Free prose has no class at all.
 *
 * ## Why matching and persistence are redacted DIFFERENTLY
 *
 * They serve different jobs, and conflating them is what makes this look impossible at first:
 *
 *  - The **match key** is computed from the LIVE request at both record and replay time, and never reads the
 *    stored text at all — so it only has to be STABLE across the two runs, not safe to commit. A recording's
 *    `_id` is hashed from it when the request is MADE, which is why no matcher here may ever widen: doing so
 *    invalidates every committed cassette at once.
 *  - The **persisted text** is what lands in a public repo. It only has to be safe, and can be as aggressive
 *    as we like without breaking replay. It is no longer inert, though: `cassetteRequestBody.ts` holds a
 *    replayed request to the text its recording carries, which is how a cassette proves what was SENT.
 *
 * So {@link matchableGraphqlVariables} normalises identifiers POSITIONALLY — real UUID at record and
 * placeholder UUID at replay both collapse to `<uuid:1>` — while {@link redactGraphqlRequestBody} blanks
 * every value that is not provably structural. Measured before choosing: no existing committed cassette has
 * a UUID anywhere in its GraphQL variables, so the positional rule is a no-op for all of them and no
 * recorded match key moves.
 */
import { absentAs } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";
import { isSyntheticCursor, syntheticCursorFor } from "./cassetteRedact.js";
import { isStructuralObjectKey } from "./cassetteRedactConfig.js";
import type { CassetteIdMap, CassetteProvider, CassetteRedactConfig } from "./cassetteRedactTypes.js";

/** A UUID in any case. Linear team, project, state, label and issue ids are all this shape. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * A UUID, or the synthetic `id_N` a redacted response carries in its place — the MATCH-key alphabet.
 *
 * Wider than {@link UUID} because a request variable can be RESPONSE-DERIVED: `readMilestone` reads the
 * milestone, then reads the project the milestone points at. At record time that second request carries the
 * real project UUID; at replay the milestone response has been redacted, so the same code sends `id_2544` and
 * the two keys never met. A synthetic id IS what a real UUID became, exactly as `cursor_N` is what a real
 * bookmark became, so collapsing both into one positional sequence is what makes a response-derived id
 * replayable at all.
 *
 * Deliberately NOT used by {@link redactValue}: that lane writes the text a cassette COMMITS, where an
 * `id_N` is the intended output and collapsing it would destroy the referential equality every write cassette
 * asserts on.
 */
const UUID_OR_SYNTHETIC_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bid_\d+\b/gi;

/**
 * Replace every UUID with a POSITIONAL placeholder, numbered by first appearance.
 *
 * Positional rather than hashed on purpose: a hash of the real value would still be a stable fingerprint of
 * it, and two runs with different real ids (record against a real workspace, replay against nothing) must
 * produce the SAME key or the cassette cannot be found.
 *
 * @param text the text to normalise
 * @returns the text with each distinct UUID replaced by `<uuid:N>`
 */
export function positionalUuids({ text }: { text: string }): string {
  return positionallyCollapse({ pattern: UUID, text });
}

/**
 * The MATCH-key collapse: every UUID **and** every synthetic `id_N` replaced by the same positional
 * placeholder sequence. See {@link UUID_OR_SYNTHETIC_ID} for why the alphabet is wider here than in the
 * persisted-text lane.
 *
 * @param text the text to normalise
 * @returns the text with each distinct identifier replaced by `<uuid:N>`
 */
export function positionalIdentifiers({ text }: { text: string }): string {
  return positionallyCollapse({ pattern: UUID_OR_SYNTHETIC_ID, text });
}

/**
 * Replace each distinct match of `pattern` with `<uuid:N>`, numbered by first appearance.
 *
 * @param pattern the identifier alphabet to collapse; must carry the global flag
 * @returns the collapsed text
 */
function positionallyCollapse({ pattern, text }: { pattern: RegExp; text: string }): string {
  const seen = new Map<string, string>();
  return text.replace(pattern, (match) => {
    const key = match.toLowerCase();
    const existing = seen.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const placeholder = `<uuid:${String(seen.size + 1)}>`;
    seen.set(key, placeholder);
    return placeholder;
  });
}

/**
 * The literal query text of the follow-up query for one overflowing nested connection
 * ({@link nestedConnectionQuery} in `corpus/linear/queries.ts`) — the only GraphQL operation in this repo that
 * takes `$id` and `$after` together. Every other query takes neither, or `$after` alone for a root-level page
 * 2, which must never be sentinelled the same way or two distinct pages of one connection would collide onto
 * one cassette entry.
 */
const PARENT_CONNECTION_QUERY_PREFIX = "query ParentConnection(";

/**
 * Fixed stand-ins for a `ParentConnection` follow-up's `id`/`after` variables, used ONLY when computing the
 * match key — never persisted. Record time sends a real UUID id and a real cursor; replay time sends back
 * whatever the redacted PARENT response happened to carry (a stable synthetic id, a blanket `"[REDACTED]"`
 * cursor) — two values that can never be made to agree by value, only by being forced to the same sentinel.
 */
const FOLLOWUP_ID_SENTINEL = "<followup:id>";
const FOLLOWUP_AFTER_SENTINEL = "<followup:after>";

/**
 * True when a normalised GraphQL body's `query` is the `ParentConnection` follow-up — the shape that forces
 * `matchableGraphqlVariables` to sentinel `id`/`after` rather than let them vary. Exported so the Polly setup
 * can also detect it: sentinelling collapses every page of one overflowing connection onto the SAME match-key
 * identifier, so replaying more than one follow-up page needs order-sensitive matching, exactly as
 * `slackPoll.test.ts` already opts into for a different id collision.
 *
 * @param body the already `{operationName, query, variables}`-normalised GraphQL body JSON
 * @returns whether `query` is the `ParentConnection` follow-up
 */
export function isParentConnectionFollowup({ body }: { body: string }): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  return (
    isRecord(parsed) &&
    typeof parsed["query"] === "string" &&
    parsed["query"].startsWith(PARENT_CONNECTION_QUERY_PREFIX)
  );
}

/**
 * Replace a `ParentConnection` follow-up's `id`/`after` variables with fixed sentinels, leaving every other
 * query's variables untouched. Scoped to the query TEXT rather than to the variable names alone, precisely
 * because a root-level page 2 also carries an `after` variable that must keep its real (positionally
 * collapsed) value to stay distinct from other pages of the same connection.
 *
 * @param body the already `{operationName, query, variables}`-normalised GraphQL body JSON
 * @returns the same JSON, with `id`/`after` sentinelled when `query` is the `ParentConnection` follow-up
 */
function sentinelParentConnectionVariables({ body }: { body: string }): string {
  if (!isParentConnectionFollowup({ body })) {
    return body;
  }
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) {
    return body;
  }
  const variables = isRecord(parsed["variables"]) ? parsed["variables"] : {};
  return JSON.stringify({
    ...parsed,
    variables: {
      ...variables,
      ...("id" in variables ? { id: FOLLOWUP_ID_SENTINEL } : {}),
      ...("after" in variables ? { after: FOLLOWUP_AFTER_SENTINEL } : {}),
    },
  });
}

/** The match-key form of one cursor: a function of its live value, closed over the provider and the map. */
type CursorFor = (args: { value: string }) => string;

/**
 * Replace a root-level page's `after` variable with its cursor identity, when the caller supplies one. A
 * record run sends the real cursor the previous page's response handed out; a replay run sends the
 * `cursor_N` the replayed previous page carries; {@link matchableCursor} makes those the same key.
 */
function identifyRootCursorVariable({ body, cursorFor }: { body: string; cursorFor: CursorFor }): string {
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed) || !isRecord(parsed["variables"])) {
    return body;
  }
  const after = parsed["variables"]["after"];
  if (typeof after !== "string" || after === FOLLOWUP_AFTER_SENTINEL) {
    return body;
  }
  return JSON.stringify({ ...parsed, variables: { ...parsed["variables"], after: cursorFor({ value: after }) } });
}

/**
 * The MATCH-key form of a GraphQL body's variables: a `ParentConnection` follow-up's `id`/`after` forced to
 * fixed sentinels (see {@link sentinelParentConnectionVariables}), a root-level page's `after` replaced by
 * its cursor identity when a `cursorFor` is supplied, then every remaining identifier collapsed positionally.
 *
 * Deliberately narrow. Anything else removed here would make two genuinely different operations collide onto
 * one cassette entry, which is the failure the body matcher exists to prevent.
 *
 * @param body the already-normalised GraphQL body JSON
 * @param cursorFor the cursor identity lookup; absent, a root-level `after` keeps its live value
 * @returns the same JSON with follow-up id/cursor variables sentinelled, a root cursor identified, and remaining
 *   UUIDs positionally collapsed
 */
export function matchableGraphqlVariables({ body, cursorFor }: { body: string; cursorFor?: CursorFor }): string {
  const sentinelled = sentinelParentConnectionVariables({ body });
  const identified =
    cursorFor === undefined ? sentinelled : identifyRootCursorVariable({ body: sentinelled, cursorFor });
  return positionalIdentifiers({ text: identified });
}

/**
 * What a cursor the map has never seen collapses to in a match key. At record time it means the request sent
 * a bookmark no recorded response handed out — the walk is not reading its own pages — and at replay it means
 * the page that should have minted `cursor_N` was recorded before cursors had identity. Either way the key is
 * fixed rather than the raw value, so a real cursor never reaches an identifier hash.
 */
const UNMAPPED_CURSOR = "<cursor:unmapped>";

/**
 * The match-key form of one cursor a live request carries. A synthetic `cursor_N` (a replay run, reading it
 * back from the replayed previous page) is already the identity and passes through; a real value (a record
 * run) resolves through the map the previous page's response was folded into the moment it arrived; anything
 * else is {@link UNMAPPED_CURSOR}. Record and replay therefore compute the same key exactly when the follow-up
 * carries the bookmark the previous page handed out — which is the property a paging test now proves. Pure.
 *
 * @param value the cursor as the live request carries it
 * @param provider the provider whose map namespace holds it
 * @param idMap the map to resolve a real value through
 * @returns the key form
 */
export function matchableCursor({
  value,
  provider,
  idMap,
}: {
  value: string;
  provider: CassetteProvider;
  idMap: CassetteIdMap;
}): string {
  if (isSyntheticCursor({ value })) {
    return value;
  }
  return absentAs({ value: syntheticCursorFor({ idMap, provider, real: value }), whenAbsent: UNMAPPED_CURSOR });
}

/** The top-level string fields of a body — JSON when it parses to an object, else form-encoded pairs. */
function bodyFields({ body }: { body: string | undefined }): Readonly<Record<string, string>> {
  if (body === undefined || body.length === 0) {
    return {};
  }
  if (body.trimStart().startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return {};
    }
    if (!isRecord(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return out;
  }
  return Object.fromEntries(new URLSearchParams(body));
}

/**
 * The cursor identity a live request carries, as a match-key fragment, or undefined when it carries no cursor
 * at all. A provider's `cursorParams` are looked for in the query string and in the top-level fields of a
 * JSON or form-encoded body — the three places this repo's clients send a bookmark back. The result is a
 * sorted `name=key` list, so two parameters can never transpose.
 *
 * Undefined, rather than an empty fragment, is load-bearing: Polly folds a matcher into a request's identifier
 * only when it is configured, so a request with no cursor keeps the identifier it recorded under before
 * cursors had identity, and no existing cassette moves. Pure.
 *
 * @param query the parsed query string
 * @param body the raw request body, if any
 * @param config the provider's allowlist, for its `cursorParams`
 * @param idMap the map to resolve a real cursor through
 * @returns the match-key fragment, or undefined when no cursor parameter is present
 */
export function cursorMatchKey({
  query,
  body,
  config,
  idMap,
}: {
  query: Readonly<Record<string, string | readonly string[]>>;
  body: string | undefined;
  config: CassetteRedactConfig;
  idMap: CassetteIdMap;
}): string | undefined {
  const fields: Record<string, string> = { ...bodyFields({ body }) };
  for (const [key, value] of Object.entries(query)) {
    fields[key] = typeof value === "string" ? value : value.join(",");
  }
  const carried = Object.entries(fields)
    .filter(([key]) => config.cursorParams.has(key.toLowerCase()))
    .map(([key, value]) => `${key.toLowerCase()}=${matchableCursor({ idMap, provider: config.provider, value })}`)
    .toSorted();
  return carried.length === 0 ? undefined : carried.join("&");
}

/** Recursively blank every value that is not provably structural. */
function redactValue({ value, keep }: { value: unknown; keep: boolean }): unknown {
  if (typeof value === "string") {
    // A structural key's value is kept only if it is short and shape-like; free prose never is.
    return keep ? positionalUuids({ text: value }) : "[REDACTED]";
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue({ keep, value: item }));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      // A key that is not field-name-shaped could itself be an identifier, exactly as in the response lane.
      const safeKey = isStructuralObjectKey({ key }) ? key : "[REDACTED_KEY]";
      out[safeKey] = redactValue({ keep: REQUEST_VARIABLE_KEEP_KEYS.has(key.toLowerCase()), value: inner });
    }
    return out;
  }
  return "[REDACTED]";
}

/**
 * Variable keys whose values are structural enough to keep verbatim.
 *
 * Deliberately tiny and shape-only: paging, ordering and window bounds. Nothing here can carry prose, a name
 * or a workspace identifier. Every other key's value is blanked, which is the safe-by-default direction —
 * an over-redacted cassette breaks a test you then fix, an under-redacted one ships a leak.
 *
 * Exported because the committed-cassette tripwire walks REQUEST bodies now that they are recorded, and a
 * walk that judged them against the RESPONSE allowlists alone would flag exactly what this set deliberately
 * keeps — a `gte` window bound is the committed example.
 */
export const REQUEST_VARIABLE_KEEP_KEYS: ReadonlySet<string> = new Set([
  "first",
  "last",
  "after",
  "before",
  "gte",
  "lte",
  "gt",
  "lt",
  "updatedat",
  "createdat",
  "orderby",
  "includearchived",
  "number",
  "page",
  "perpage",
  "permanentlydelete",
]);

/**
 * The PERSISTED form of a GraphQL request body: the query kept (we wrote it), every variable value blanked
 * unless it is provably structural.
 *
 * The query text is safe by construction — it is a static string in this repository, not caller data — and
 * keeping it is what makes a committed cassette reviewable by eye.
 *
 * @param body the raw or normalised GraphQL request body
 * @returns the body with its variables redacted, or the input unchanged when it is not JSON
 */
export function redactGraphqlRequestBody({ body }: { body: string }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON: it cannot be reasoned about, so nothing is kept.
    return "[REDACTED]";
  }
  if (!isRecord(parsed) || parsed["query"] === undefined) {
    return "[REDACTED]";
  }
  return JSON.stringify({
    operationName: persistedOperationName({ body: parsed }),
    query: parsed["query"],
    variables: redactValue({ keep: false, value: persistedVariables({ body: parsed }) }),
  });
}

/**
 * An anonymous GraphQL operation sends no `operationName`; the persisted body writes that as `null` rather
 * than dropping the key, so an anonymous request still reads as one.
 */
function persistedOperationName({ body }: { body: Record<string, unknown> }): unknown {
  const { operationName } = body;
  if (operationName === undefined) {
    return null;
  }
  return operationName;
}

/**
 * An operation declaring no arguments sends no `variables`; the persisted body writes that as `null`, the
 * same value a client sending an explicit `null` persists.
 */
function persistedVariables({ body }: { body: Record<string, unknown> }): unknown {
  const { variables } = body;
  if (variables === undefined) {
    return null;
  }
  return variables;
}
