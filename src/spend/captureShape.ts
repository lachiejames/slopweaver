/**
 * What a live visit of the owner's Airwallex card page heard from the console's own backend, reduced to SHAPE — each
 * response's method, path and status, and its body's field paths with the TYPE each holds. Never a value.
 *
 * This is `spend capture --discover`'s whole output, and the reduction is the safety property rather than a
 * formatting choice: a card page's backend answers with amounts, merchant names and possibly card details, and
 * a discovery report lands in a transcript. So the reduction reads keys and `typeof`, and there is no path
 * through this file by which a value reaches a returned string. A key is printed only when it is
 * identifier-shaped, because a backend that keys a map by card id or merchant name has put data in the key. The query string is dropped for the same
 * reason — it can carry ids and filters — and only a GraphQL request's `operationName` is read out of a
 * request body, never its variables.
 */
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";

/** The JSON type a field held. */
type FieldType = "string" | "number" | "boolean" | "null" | "object" | "array";

/** One field a response body carried: where it sits, and what kind of value was there. */
export interface FieldPath {
  /** Dotted keys from the root; `[]` stands for every element of an array. */
  readonly path: string;
  readonly type: FieldType;
}

/** One response the page's backend gave, as shape only. */
export interface ResponseShape {
  readonly method: string;
  /** The URL's path, no query string and no fragment. */
  readonly path: string;
  readonly statusCode: number;
  /** A GraphQL request's `operationName`, when the request body named one. */
  readonly operation: string | null;
  readonly fields: readonly FieldPath[];
}

/** How deep a body is walked; below it a field is reported as an object and not opened. */
const MAX_DEPTH = 10;

/** The most field paths reported per response, so a huge list cannot swamp the report. */
const MAX_FIELDS = 400;

/**
 * A key a report may print: identifier-shaped and short. Anything else — a card or account id, a merchant
 * string, a date, a number — is DATA used as a key, and prints as `<key>`.
 */
const PRINTABLE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * The JSON type of one value.
 *
 * @param value any parsed JSON value
 * @returns its type name
 */
function typeOf({ value }: { value: unknown }): FieldType {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "object";
}

/**
 * Every field path a parsed body carries, with the type at each — array elements folded into one `[]` step,
 * so a list of fifty transactions reports its row shape once.
 *
 * @param body a parsed JSON body (or a raw string, which carries no fields)
 * @returns the distinct paths in first-seen order, capped at {@link MAX_FIELDS}
 */
export function fieldPathsOf({ body }: { body: unknown }): readonly FieldPath[] {
  const found: FoundPaths = { out: [], seen: new Set<string>() };
  walkValue({ depth: 0, found, path: "", value: body });
  return found.out;
}

/** The paths found so far, and the path-and-type pairs already reported. */
interface FoundPaths {
  readonly out: FieldPath[];
  readonly seen: Set<string>;
}

/**
 * Report one field, once, unless it is the root or the report is full.
 *
 * @param found the accumulator
 * @param field the path and its type
 */
function addField({ field, found }: { field: FieldPath; found: FoundPaths }): void {
  const key = `${field.path}\u0000${field.type}`;
  if (field.path === "" || found.seen.has(key) || found.out.length >= MAX_FIELDS) {
    return;
  }
  found.seen.add(key);
  found.out.push(field);
}

/**
 * The child path under a record key, printing a data-shaped key as `<key>`.
 *
 * @param path the parent's path, empty at the root
 * @param raw the key as the body carried it
 * @returns the child's path
 */
function childPath({ path, raw }: { path: string; raw: string }): string {
  let key = "<key>";
  if (PRINTABLE_KEY.test(raw)) {
    key = raw;
  }
  if (path === "") {
    return key;
  }
  return `${path}.${key}`;
}

/**
 * Walk one value, reporting its own path and type and then every child's, down to {@link MAX_DEPTH}.
 *
 * @param depth how many steps below the root this value sits
 * @param found the accumulator
 * @param path this value's path, empty at the root
 * @param value the parsed JSON value
 */
function walkValue({
  depth,
  found,
  path,
  value,
}: {
  depth: number;
  found: FoundPaths;
  path: string;
  value: unknown;
}): void {
  addField({ field: { path, type: typeOf({ value }) }, found });
  if (depth >= MAX_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    for (const element of value) {
      walkValue({ depth: depth + 1, found, path: `${path}[]`, value: element });
    }
    return;
  }
  if (isRecord(value)) {
    for (const [raw, child] of Object.entries(value)) {
      walkValue({ depth: depth + 1, found, path: childPath({ path, raw }), value: child });
    }
  }
}

/**
 * A GraphQL request's operation name, and nothing else from its body.
 *
 * @param requestBody the request body the page sent, when it sent one
 * @returns the operation name, or null for no body, a non-JSON body, one naming no operation, or a name that
 * is not identifier-shaped
 */
function operationOf({ requestBody }: { requestBody: string | undefined }): string | null {
  if (requestBody === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "spend capture request body", text: requestBody });
  } catch {
    return null;
  }
  const name = isRecord(parsed) ? parsed["operationName"] : undefined;
  if (typeof name === "string" && PRINTABLE_KEY.test(name)) {
    return name;
  }
  return null;
}

/**
 * The path of a URL, without its query or fragment.
 *
 * @param url an absolute URL the transport captured
 * @returns its path, or the whole input when it does not parse
 */
function pathOf({ url }: { url: string }): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Reduce one captured response to its shape.
 *
 * @param response what the transport captured
 * @returns the method, path, status, operation and field paths — never a value
 */
export function responseShapeOf({
  response,
}: {
  response: {
    readonly method: string;
    readonly url: string;
    readonly statusCode: number;
    readonly body: unknown;
    readonly requestBody?: string;
  };
}): ResponseShape {
  return {
    fields: fieldPathsOf({ body: response.body }),
    method: response.method,
    operation: operationOf({ requestBody: response.requestBody }),
    path: pathOf({ url: response.url }),
    statusCode: response.statusCode,
  };
}

/**
 * The discovery report as lines: one header per response, one indented line per field.
 *
 * @param shapes every response's shape, in capture order
 * @returns the report lines
 */
export function discoveryLines({ shapes }: { shapes: readonly ResponseShape[] }): readonly string[] {
  return shapes.flatMap((shape) => {
    const operation = shape.operation === null ? "" : ` (${shape.operation})`;
    return [
      `${shape.method} ${shape.path}${operation} → ${String(shape.statusCode)}, ${String(shape.fields.length)} field(s)`,
      ...shape.fields.map((field) => `    ${field.path}: ${field.type}`),
    ];
  });
}
