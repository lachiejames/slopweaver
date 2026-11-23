/**
 * How `slopweaver slack probe` reads a Web API response body: narrowing it to a record, walking a dotted
 * path into it, counting, summing and matching at that path, checking `--expect`, finding the next cursor,
 * and reducing the whole body to the SHAPE the verb reports.
 *
 * Split out of `./probeRun.ts` because nothing here performs I/O: the shell makes the call and walks the
 * pages, and every function in this file is a pure read of a body it was handed. The read-only property the
 * verb promises lives here too — these functions report field names, counts and a verdict, never a value.
 */
import { redactPath } from "../../../atlas/slackApi/harObservations.js";
import { isRecord } from "../../../lib/parsers.js";
import type { ExpectVerdict, ProbeReport } from "./probeCore.js";

/**
 * Narrow an SDK response to a plain record.
 *
 * A `WebAPICallResult` is an interface with an index signature, so it IS a record at runtime; the guard is
 * here rather than a double cast because a cast asserts and a guard checks, and a response that somehow is
 * not an object should read as an empty shape rather than crash the report.
 *
 * @param value the SDK's return value
 * @returns the response body as a record, or an empty one when it is not an object
 */
export function asBody({ value }: { value: unknown }): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * The member names of an object, UNIONED across every element when the value is an array.
 *
 * Every element, not the first. The first version read `value[0]` and it produced a false absence: Slack's
 * result arrays are heterogeneous, so a page whose first entry happens to lack a field reported that field
 * as missing from the whole response. That is the exact shape of a wrong answer this verb exists to
 * prevent — an absence measured on a sample of one, reported as an absence.
 *
 * @param value the field's value
 * @returns every member name seen, redacted and sorted, or `undefined` when there is no object to look into
 */
function memberNames({ value }: { value: unknown }): readonly string[] | undefined {
  const targets = Array.isArray(value) ? value : [value];
  const names = new Set<string>();
  for (const target of targets) {
    if (isRecord(target)) {
      // Redacted, because some Slack responses key a map BY OBJECT ID — `search.messages` returns `users`
      // keyed by user id — so the member names of such a field are data, not shape. Measured: the first run
      // of this verb printed five real user ids under the heading `users[]`. The same reduction the atlas
      // uses, for the same reason: a shape report gets pasted into places a body never would.
      for (const key of Object.keys(target)) {
        names.add(redactPath({ path: key }));
      }
    }
  }
  return names.size === 0 && !targets.some((target) => isRecord(target)) ? undefined : [...names].toSorted();
}

/**
 * The member names at a dotted path, for `--shape-at`. A path with no object under it reports an empty list:
 * the caller asked for that path's shape, and "nothing there to name" is that answer, not an absent one.
 *
 * @param body the response body
 * @param path the dotted path `--shape-at` named
 * @returns every member name seen there, or an empty list when there is no object to look into
 */
function membersAt({ body, path }: { body: Record<string, unknown>; path: string }): readonly string[] {
  const names = memberNames({ value: nodeAt({ body, path }) });
  if (names === undefined) {
    return [];
  }
  return names;
}

/**
 * Follow a dotted path to a count: the length of an array, or a number that is already one.
 *
 * Both, because the two questions a probe asks about size have different homes. "How many came back" is an
 * array length (`messages.matches`); "how many exist" is a scalar Slack computed (`messages.total`), and it
 * is the only way to tell a full page from a truncated one when the page size is the cap.
 *
 * @param body the response body
 * @param path the dotted field path, e.g. `messages`, `messages.matches` or `messages.total`
 * @returns the count, or `undefined` when the path names neither an array nor a number
 */
export function countAt({ body, path }: { body: Record<string, unknown>; path: string }): number | undefined {
  const node = nodeAt({ body, path });
  if (Array.isArray(node)) {
    return node.length;
  }
  return typeof node === "number" ? node : undefined;
}

/**
 * Follow a dotted path to any node.
 *
 * @param body the response body
 * @param path the dotted field path
 * @returns the node, or `undefined` when the path leads nowhere
 */
function nodeAt({ body, path }: { body: Record<string, unknown>; path: string }): unknown {
  let node: unknown = body;
  for (const segment of path.split(".")) {
    if (Array.isArray(node) && /^[0-9]+$/.test(segment)) {
      node = node[Number(segment)];
      continue;
    }
    node = isRecord(node) ? node[segment] : undefined;
  }
  return node;
}

/**
 * How many elements of an array carry a field containing a substring.
 *
 * A COUNT, never the values. This is how a probe settles "is that field reliably there" — the question
 * behind every candidate that plans to parse something out of a response. Measured as a fraction of the
 * array's length, because "12 have it" is meaningless without "of how many", and a mechanism that works on
 * most elements is not a mechanism.
 *
 * @param body the response body
 * @param spec `<arrayPath>:<field>~<substring>`, e.g. `messages.matches:permalink~thread_ts`
 * @returns how many matched and how many were looked at, or `undefined` when the spec names no array
 */
export function countWhere({
  body,
  spec,
}: {
  body: Record<string, unknown>;
  spec: string;
}): { matched: number; of: number } | undefined {
  const [locator, needle] = spec.split("~");
  if (locator === undefined || needle === undefined) {
    return undefined;
  }
  const [arrayPath, field] = locator.split(":");
  if (arrayPath === undefined || field === undefined) {
    return undefined;
  }
  const node = nodeAt({ body, path: arrayPath });
  if (!Array.isArray(node)) {
    return undefined;
  }
  const matched = node.filter((entry) => {
    const value: unknown = isRecord(entry) ? entry[field] : undefined;
    return typeof value === "string" && value.includes(needle);
  }).length;
  return { matched, of: node.length };
}

/**
 * The sum of a numeric field across an array's elements.
 *
 * A total, never the values. It is what turns a shape probe into a completeness instrument: summing
 * `reply_count` over one `conversations.history` page yields how many replies those parents hold, in ONE
 * call, and that number is a lower bound a candidate detector has to beat.
 *
 * @param body the response body
 * @param spec `<arrayPath>:<field>`, e.g. `messages:reply_count`
 * @returns the sum, or `undefined` when the spec names no array
 */
export function sumField({ body, spec }: { body: Record<string, unknown>; spec: string }): number | undefined {
  const [arrayPath, field] = spec.split(":");
  if (arrayPath === undefined || field === undefined) {
    return undefined;
  }
  const node = nodeAt({ body, path: arrayPath });
  if (!Array.isArray(node)) {
    return undefined;
  }
  return node.reduce((total: number, entry: unknown) => {
    const value: unknown = isRecord(entry) ? entry[field] : undefined;
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

/**
 * Whether the response agrees with a value the caller already holds. A VERDICT, never the value.
 *
 * This is the whole of `--expect`, and its narrowness is the design: nothing here returns, formats or logs
 * what it read. A caller who does not already hold the value learns exactly one bit less than nothing about
 * it, which is why this can safely be pointed at a field carrying message text while
 * `./probeCore.ts`'s module note still holds.
 *
 * Compared as STRINGS. Slack sends a timestamp as `"1756000000.000100"` and a count as `12`, and a caller
 * holding either has it as text off its own command line, so a textual form is what makes the two
 * comparable at all. `null` is a value Slack sends and compares as `"null"`; only a container is refused.
 *
 * @param body the response body
 * @param expect the path and the value to check it against
 * @returns which of the four verdicts the response earns
 */
export function expectationVerdict({
  body,
  expect,
}: {
  body: Record<string, unknown>;
  expect: { readonly path: string; readonly value: string };
}): ExpectVerdict {
  const node = nodeAt({ body, path: expect.path });
  if (node === undefined) {
    return "absent";
  }
  const asText = scalarText({ node });
  if (asText === undefined) {
    return "not-scalar";
  }
  return asText === expect.value ? "matches" : "differs";
}

/**
 * One response node as the text a caller could have typed, or nothing when it is not a value at all.
 *
 * The four JSON scalars are spelled out rather than reached through `String(node)`, which would happily
 * render an object as `[object Object]` and a symbol by throwing. Anything else — an object, an array — is
 * a container, and the caller asked about the wrong path.
 *
 * @param node whatever the dotted path led to
 * @returns the node's textual form, or `undefined` when there is no value there to compare
 */
function scalarText({ node }: { node: unknown }): string | undefined {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number" || typeof node === "boolean" || typeof node === "bigint") {
    return String(node);
  }
  return node === null ? "null" : undefined;
}

/**
 * Reduce one response to its shape.
 *
 * @param method the method that was called
 * @param body the response body
 * @param countField the dotted path to an array to measure, when the caller asked for one
 * @param shapeAt the dotted path to report field names at, when the caller asked for one
 * @param countWhereSpec the `<arrayPath>:<field>~<substring>` fraction to measure, when one was asked for
 * @param sumSpec the `<arrayPath>:<field>` sum to measure, when one was asked for
 * @param expect the `--expect` path and value to check, when one was asked for
 * @param paging how the cursor walk ended, when `--exhaust` was used
 * @param elapsedMs how long the call took
 * @returns the report
 */
export function shapeOf({
  method,
  body,
  countField,
  shapeAt,
  countWhereSpec,
  sumSpec,
  expect,
  paging,
  elapsedMs,
  scopes,
}: {
  method: string;
  body: Record<string, unknown>;
  countField: string | undefined;
  shapeAt: string | undefined;
  countWhereSpec: string | undefined;
  sumSpec: string | undefined;
  expect: { readonly path: string; readonly value: string } | undefined;
  paging: { pages: number; bounded: boolean } | undefined;
  elapsedMs: number;
  scopes: boolean;
}): ProbeReport {
  const nested: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(body)) {
    const names = memberNames({ value });
    if (names !== undefined) {
      nested[key] = names;
    }
  }
  return {
    acceptedScopes: scopes ? scopeList({ body, field: "acceptedScopes" }) : undefined,
    count: countField === undefined ? undefined : countAt({ body, path: countField }),
    elapsedMs,
    grantedScopes: scopes ? scopeList({ body, field: "scopes" }) : undefined,
    error: typeof body["error"] === "string" ? body["error"] : undefined,
    expectation:
      expect === undefined ? undefined : { path: expect.path, verdict: expectationVerdict({ body, expect }) },
    fields: Object.keys(body).toSorted(),
    hasMore: body["has_more"] === true,
    hasNextCursor: nextCursor({ body }) !== undefined,
    method,
    nested,
    ok: body["ok"] === true,
    paging,
    shapeAtPath: shapeAt === undefined ? undefined : membersAt({ body, path: shapeAt }),
    sum: sumSpec === undefined ? undefined : sumField({ body, spec: sumSpec }),
    where: countWhereSpec === undefined ? undefined : countWhere({ body, spec: countWhereSpec }),
  };
}

/**
 * One comma-or-array scope field off `response_metadata`, normalised to a sorted list.
 *
 * Slack has sent this field both ways — an array on some methods, the raw comma-separated `x-oauth-scopes`
 * header string on others — so both are read rather than one being assumed. `undefined` when the field is
 * absent, which is NOT ESTABLISHED rather than "the token holds nothing"; see {@link ProbeReport}.
 *
 * @param body the response body
 * @param field the `response_metadata` member to read (`scopes` or `acceptedScopes`)
 * @returns the sorted scope list, or undefined when Slack sent no such field
 */
function scopeList({ body, field }: { body: Record<string, unknown>; field: string }): readonly string[] | undefined {
  const metadata = body["response_metadata"];
  const raw = isRecord(metadata) ? metadata[field] : undefined;
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string").toSorted();
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .toSorted();
  }
  return undefined;
}

/**
 * Where a `next_cursor` can live. `response_metadata` is Slack's documented convention and where every
 * `conversations.*` method puts it — but `search.messages` puts its own under `messages.pagination`, and a
 * pager that only knew the convention read a 100-result prefix of a 1,297-result set as the complete
 * answer, reporting "cursor exhausted". Measured. Both are checked, in order.
 */
const CURSOR_LOCATIONS: readonly string[] = ["response_metadata", "messages.pagination", "pagination"];

/**
 * The cursor the response hands back, or `undefined` when there is genuinely no next page.
 *
 * @param body the response body
 * @returns the next cursor, when any of the known locations holds a non-empty one
 */
export function nextCursor({ body }: { body: Record<string, unknown> }): string | undefined {
  for (const location of CURSOR_LOCATIONS) {
    const holder = nodeAt({ body, path: location });
    const cursor = isRecord(holder) ? holder["next_cursor"] : undefined;
    if (typeof cursor === "string" && cursor !== "") {
      return cursor;
    }
  }
  return undefined;
}
