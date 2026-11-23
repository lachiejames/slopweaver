/**
 * The ALLOWLIST cassette redactor — the safe-by-default replacement for the old denylist scrub. Walks a
 * recorded response body and blanks EVERY string to `[REDACTED]` unless its key is in the provider's
 * allowlist: an `idKey` → a stable synthetic `id_N` (referential + irreversible from the cassette), a
 * `cursorKey` → a stable synthetic `cursor_N` (a paging bookmark that keeps its identity, so a replayed
 * follow-up can be held to it), a `urlKey` → a public origin (else `redacted.invalid`) with a blanked path,
 * a `keepKey` → verbatim (still known-value scrubbed). Non-string leaves (numbers/bools/null) are kept. A
 * field nobody anticipated is redacted by default — that is the whole point (a denylist let unanticipated fields through).
 *
 * Pure: the input `idMap` is never mutated; the (possibly grown) map is returned alongside the redacted body.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  isIdQueryParamName,
  isRouteShapedSegment,
  isSafeRequestPath,
  isStructuralObjectKey,
  OPAQUE_PATH,
  OPAQUE_QUERY_VALUE,
  PUBLIC_URL_HOSTS,
} from "./cassetteRedactConfig.js";
import type { CassetteIdMap, CassetteProvider, CassetteRedactConfig } from "./cassetteRedactTypes.js";
import { scrubKnownValues, scrubLeakClasses } from "./cassetteScrub.js";

/**
 * A URL → keep an allowlisted public `scheme://host`, else `https://redacted.invalid`; blank the path/query.
 * Exported so the REQUEST-body projection (`cassetteRequestBody.ts`) collapses a URL a client SENDS by the
 * same rule a URL a provider RETURNS is collapsed by — one definition, so the two can never drift apart.
 *
 * @param value the candidate URL string
 * @returns the public origin with a blanked path, or `[REDACTED]` when the value is not URL-shaped
 */
export function redactUrl({ value }: { value: string }): string {
  const match = /^(https?:\/\/)([^/\s"']+)/.exec(value);
  if (match === null) {
    return "[REDACTED]"; // not a URL shape — treat as content
  }
  const host = match[2]!.toLowerCase();
  return PUBLIC_URL_HOSTS.has(host) ? `${match[1]!}${host}/[REDACTED]` : "https://redacted.invalid/[REDACTED]";
}

/**
 * Normalise a request URL's PATH for matching + persisting: kept verbatim when every segment is a route name,
 * else collapsed to {@link OPAQUE_PATH}. Pure + idempotent.
 *
 * Collapsing the WHOLE path (not just the offending segment) is deliberate and load-bearing: the response that
 * hands out such a URL has already been redacted to `scheme://host/[REDACTED]`, so a replayed run requests
 * exactly that path. Collapsing to the same form is what makes record and replay line up — the redaction and
 * the matching agree by construction rather than by coincidence.
 *
 * @param path the request URL's pathname
 * @returns the path to match on and to persist
 */
export function redactRequestPath({ path }: { path: string }): string {
  return isSafeRequestPath({ path }) ? path : OPAQUE_PATH;
}

/**
 * The PERSISTED form of one query parameter's value: {@link OPAQUE_QUERY_VALUE} when the NAME reads as an
 * identifier field ({@link isIdQueryParamName}) and the VALUE is not route-shaped, else the value verbatim.
 *
 * Both halves are load-bearing. Testing the name alone would blank `page_id=2`, which carries nothing and is
 * what makes a committed cassette readable; testing the value alone would blank a search expression
 * (`q=repo:octocat/Hello-World updated:…`) that is a public fixture, not org data. The pair is what isolates
 * an opaque identifier riding in a query slot.
 *
 * This can be as aggressive as it likes without breaking replay, for the reason `cassetteRequestRedact.ts`'s
 * header states about request BODIES and which holds identically here: the persisted text never participates
 * in matching. The default matcher is `url: { query: false }` and the one matcher that does read a query
 * ({@link ./setup-polly.configureCursorMatching}) computes its key from the LIVE request. Pure + idempotent —
 * {@link OPAQUE_QUERY_VALUE} is itself route-shaped, so a second pass returns it unchanged.
 *
 * @param name the parameter's name
 * @param value the parameter's value as the request carries it
 * @returns the value to persist
 */
export function redactQueryValue({ name, value }: { name: string; value: string }): string {
  return isIdQueryParamName({ name }) && !isRouteShapedSegment({ segment: value }) ? OPAQUE_QUERY_VALUE : value;
}

/**
 * The PERSISTED form of a whole query string: every parameter passed through {@link redactQueryValue}.
 *
 * Returned VERBATIM when nothing was redacted, rather than re-serialised. `URLSearchParams` normalises as it
 * round-trips — a `%20` comes back as `+` — so re-serialising unconditionally would rewrite the query of
 * every already-committed cassette on its next re-record, a diff that says nothing about what changed. Pure.
 *
 * @param search the URL's search component, leading `?` included (or empty)
 * @returns the search component to persist
 */
export function redactRequestQuery({ search }: { search: string }): string {
  if (search.length === 0) {
    return search;
  }
  const redacted = new URLSearchParams();
  let changed = false;
  for (const [name, value] of new URLSearchParams(search)) {
    const next = redactQueryValue({ name, value });
    changed = changed || next !== value;
    redacted.append(name, next);
  }
  return changed ? `?${redacted.toString()}` : search;
}

/**
 * Apply {@link redactRequestPath} to a whole absolute request URL, preserving the origin, and
 * {@link redactRequestQuery} to any query it keeps. A non-absolute URL is returned unchanged for the caller's
 * generic scrub to handle. Pure.
 *
 * @param url the recorded request URL
 * @returns the URL with an opaque path collapsed and any identifying query value blanked
 */
export function redactRequestUrl({ url }: { url: string }): string {
  const parsed = parseHttpUrl({ url });
  if (parsed === undefined) {
    return url;
  }
  const redacted = redactRequestPath({ path: parsed.pathname });
  // A collapsed path takes the query with it: the query is not part of the match key, and a one-time URL's
  // query is exactly as likely to carry a token as its path.
  if (redacted === OPAQUE_PATH) {
    return `${parsed.origin}${OPAQUE_PATH}`;
  }
  return `${parsed.origin}${redacted}${redactRequestQuery({ search: parsed.search })}`;
}

/**
 * Parse an absolute http(s) URL with the WHATWG parser (no regex — a hand-rolled URL pattern is where
 * super-linear backtracking creeps in). `undefined` for anything else.
 *
 * @param url the candidate URL
 * @returns its origin/pathname/search, or undefined when it is not an absolute http(s) URL
 */
export function parseHttpUrl({
  url,
}: {
  url: string;
}): { readonly origin: string; readonly pathname: string; readonly search: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  return { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search };
}

/** Assign a synthetic id for a real id: a plain function threading the mutable working map. */
type SyntheticFor = (args: { real: string }) => string;

/** The synthetic form a paging cursor takes in a committed cassette — distinguishable from an `id_N` by eye. */
const SYNTHETIC_CURSOR = /^cursor_\d+$/;

/**
 * Whether a value is a synthetic cursor the redactor minted (`cursor_N`). At replay a follow-up request carries
 * exactly this form, read back from the replayed previous page, and the matcher keeps it as is. Pure.
 *
 * @param value the candidate string
 * @returns true iff it is `cursor_` followed by digits
 */
export function isSyntheticCursor({ value }: { value: string }): boolean {
  return SYNTHETIC_CURSOR.test(value);
}

/**
 * The id-map key a real cursor is filed under: its own namespace beside the provider's ids, so a cursor whose
 * raw text happened to equal an id could never collapse onto it. Pure.
 *
 * @param provider the provider whose cursor this is
 * @param real the cursor's real value
 * @returns the map key
 */
export function cursorMapKey({ provider, real }: { provider: CassetteProvider; real: string }): string {
  return `${provider}\tcursor\t${real}`;
}

/**
 * The synthetic identity a real cursor already has in the map, or undefined when no recorded response has
 * handed it out yet. The request-side matcher's lookup: at record time the previous page's response was
 * folded into the map the moment it arrived, so the follow-up's real cursor resolves here. Pure.
 *
 * @param provider the provider whose cursor this is
 * @param real the cursor's real value, as the live request carries it
 * @param idMap the map to look in
 * @returns the `cursor_N` the map holds for it, or undefined
 */
export function syntheticCursorFor({
  provider,
  real,
  idMap,
}: {
  provider: CassetteProvider;
  real: string;
  idMap: CassetteIdMap;
}): string | undefined {
  return idMap.entries[cursorMapKey({ provider, real })];
}

/** Redact one string leaf by which allowlist set its key is in (id → synthetic, url → origin, keep → verbatim). */
function redactString({
  value,
  key,
  config,
  knownValues,
  syntheticFor,
  syntheticCursor,
}: {
  value: string;
  key: string | undefined;
  config: CassetteRedactConfig;
  knownValues: readonly string[];
  syntheticFor: SyntheticFor;
  syntheticCursor: SyntheticFor;
}): string {
  const lowerKey = key?.toLowerCase();
  if (lowerKey === undefined) {
    return "[REDACTED]";
  }
  const allowedValues = config.keepValuesByKey?.[lowerKey];
  // A value-scoped keep is checked FIRST, and only a SANCTIONED value short-circuits. A key can be both an
  // id key and value-keepable — Gmail's `id` is a message id on one route and a closed, universal system
  // label id on another — so ordering the id rule first would turn `INBOX` into `id_560` and there would be
  // no way to express the difference. An unsanctioned value falls through to every rule below exactly as
  // before, so a real message id is still replaced by a synthetic one rather than by `[REDACTED]`.
  if (allowedValues?.has(value.toLowerCase()) === true) {
    return scrubKnownValues({ knownValues, text: value });
  }
  if (config.idKeys.has(lowerKey)) {
    return syntheticFor({ real: value });
  }
  if (config.cursorKeys.has(lowerKey)) {
    // An EMPTY cursor is the provider's own "last page" signal (Slack's `next_cursor: ""`), and it must
    // survive as exactly that: a replayed walk that read `[REDACTED]` here saw a non-empty bookmark and
    // believed there was another page.
    return value.length === 0 ? "" : syntheticCursor({ real: value });
  }
  if (config.urlKeys.has(lowerKey)) {
    return redactUrl({ value });
  }
  if (allowedValues !== undefined) {
    // The field survives only when the VALUE is one we sanctioned, never merely because the key is.
    return "[REDACTED]";
  }
  if (config.keepKeys.has(lowerKey)) {
    return scrubKnownValues({ knownValues, text: value }); // kept verbatim, minus any known-sensitive literal
  }
  return "[REDACTED]";
}

/** Recursively redact a parsed JSON value: arrays/objects recurse (elements inherit the array's key). */
function redactValue({
  value,
  key,
  config,
  knownValues,
  syntheticFor,
  syntheticCursor,
}: {
  value: unknown;
  key: string | undefined;
  config: CassetteRedactConfig;
  knownValues: readonly string[];
  syntheticFor: SyntheticFor;
  syntheticCursor: SyntheticFor;
}): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue({ config, key, knownValues, syntheticCursor, syntheticFor, value: entry }));
  }
  if (isRecord(value)) {
    const record = value;
    const out: Record<string, unknown> = {};
    for (const objectKey of Object.keys(record)) {
      // The KEY is redacted too: Slack's `shares` map is keyed BY channel id, so an id can hide in the key
      // position. A non-field-name key becomes the same synthetic id its value form would (referentially
      // consistent), while the ORIGINAL key still selects the child's allowlist behaviour.
      const outKey = isStructuralObjectKey({ key: objectKey }) ? objectKey : syntheticFor({ real: objectKey });
      out[outKey] = redactValue({
        config,
        key: objectKey,
        knownValues,
        syntheticCursor,
        syntheticFor,
        value: record[objectKey],
      });
    }
    return out;
  }
  if (typeof value === "string") {
    return redactString({ config, key, knownValues, syntheticCursor, syntheticFor, value });
  }
  return value;
}

/**
 * Redact a recorded response body per the provider allowlist. A non-JSON body (e.g. an SSE stream) skips the
 * structural walk and gets the generic leak-class + known-value scrub only.
 *
 * @param body the raw response body
 * @param config the provider allowlist
 * @param idMap the persistent real-id → synthetic-id map (returned, possibly grown; never mutated in place)
 * @param knownValues the pre-seeded known-sensitive literals (blanked wherever they appear, incl. kept values)
 * @returns the redacted body + the updated id-map, or `err` if serialisation fails
 */
export function cassetteRedact({
  body,
  config,
  idMap,
  knownValues,
}: {
  body: string;
  config: CassetteRedactConfig;
  idMap: CassetteIdMap;
  knownValues: readonly string[];
}): Result<{ readonly body: string; readonly idMap: CassetteIdMap }> {
  const trimmed = body.trim();
  const fallback = (): Result<{ readonly body: string; readonly idMap: CassetteIdMap }> =>
    ok({ body: scrubKnownValues({ knownValues, text: scrubLeakClasses({ text: body }) }), idMap });
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return fallback();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return fallback();
  }
  // A mutable working copy of the map (the input stays untouched); the closure grows it as ids are first seen.
  const entries: Record<string, string> = { ...idMap.entries };
  let next = idMap.next;
  const mint = ({ key, prefix }: { key: string; prefix: string }): string => {
    const existing = entries[key];
    if (existing !== undefined) {
      return existing;
    }
    const synthetic = `${prefix}${String(next)}`;
    entries[key] = synthetic;
    next += 1;
    return synthetic;
  };
  const syntheticFor = ({ real }: { real: string }): string =>
    mint({ key: `${config.provider}\t${real}`, prefix: "id_" });
  const syntheticCursor = ({ real }: { real: string }): string =>
    mint({ key: cursorMapKey({ provider: config.provider, real }), prefix: "cursor_" });
  try {
    const redacted = redactValue({ config, key: undefined, knownValues, syntheticCursor, syntheticFor, value: parsed });
    return ok({ body: JSON.stringify(redacted), idMap: { entries, next } });
  } catch {
    return err(["cassetteRedact: failed to serialise the redacted body"]);
  }
}
