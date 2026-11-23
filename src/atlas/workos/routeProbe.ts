/**
 * The oracle: turning one unauthenticated HTTP response from `api.workos.com` into a statement about
 * whether that route exists.
 *
 * ## Why this works at all, and what it measures
 *
 * MEASURED against the running server with NO credential of any kind. Reproduce any single row
 * with `slopweaver atlas workos sync --json` and read `verdict` beside `statusCode`:
 *
 * | What came back                                                          | What it proves                        |
 * | ----------------------------------------------------------------------- | ------------------------------------- |
 * | `401 {"message":"Unauthorized"}`                                        | routed, and authenticated             |
 * | `401 {"error":"unauthenticated"}`                                       | routed, by a service with its own vocabulary |
 * | `422 {"message":"Validation failed","errors":[{"field":…}]}`            | routed, unauthenticated, and it NAMES its parameters |
 * | `400 {"error":"invalid_request","error_description":…}`                | routed, unauthenticated, OAuth-shaped |
 * | `404 {"code":"entity_not_found","entity_id":…}`                        | routed and public; the placeholder id is what is missing |
 * | `302` to `error.workos.com`                                             | routed, and a browser-facing entry point |
 * | `404 {"message":"Cannot <METHOD> <path>"}` or the generic not-found      | NOT routed under this method          |
 *
 * That is "every endpoint, every method, every parameter" (`docs/atlas-intent/02-both-surfaces.md`) obtained without a
 * token, which is the same property that made the Hive atlas's introspection worth splitting into its own
 * surface: the map cannot drift from the running server, because the running server is what answered.
 *
 * ## The one-way limit, stated rather than discovered
 *
 * A present verdict PROVES the route exists. An `absent` verdict proves only that this (method, path) pair
 * is not routed — it can never distinguish "the path does not exist" from "the path exists under a
 * different method", because measured in the same sitting `POST /directory_users` and `POST /zzz_nope`
 * return the byte-identical body `{"message":"Cannot POST <path>","error":"Not Found"}`. So an `absent` row
 * is a fact about a PAIR and never about a path, and no consumer may read it as "WorkOS has no such
 * resource".
 *
 * ## Nothing here reads a value
 *
 * The classifier reads a status code, three well-known message strings and — for `validation-echo` — the
 * `field` NAMES inside an errors array. It never reads an `errors[].code` beyond deciding the shape
 * matched, never an `error_description` beyond the parameter name it embeds, and never a response body from
 * an authenticated route, because no authenticated route ever answers one here.
 */
import { isRecord } from "../../lib/parsers.js";

import type { WorkosRouteVerdict } from "./model.js";

/** What one probe round trip returns. Deliberately text, so a bad body is this module's to judge. */
export interface WorkosProbeResponse {
  readonly status: number;
  readonly text: string;
}

/** The classification of one probe, plus whatever names the server volunteered. */
export interface WorkosRouteClassification {
  readonly verdict: WorkosRouteVerdict;
  /** Parameter NAMES the server itself echoed back, sorted. Empty for every verdict but `validation-echo`. */
  readonly declaredParams: readonly string[];
}

/** The body an unrouted pair answers under a non-GET method, up to the method and path it echoes. */
const UNROUTED_PREFIX = "Cannot ";

/** The body the API answers for a path it does not know at all. */
const GENERIC_NOT_FOUND = "The requested resource was not found";

/** The error code the API uses when the ROUTE is fine and the entity in the path is not. */
const ENTITY_NOT_FOUND_CODE = "entity_not_found";

/** The vocabulary the ordinary REST surface refuses with. */
const UNAUTHORIZED_MESSAGE = "Unauthorized";

/** The vocabulary the Vault service refuses with — see `model.ts` on why this earns its own verdict. */
const FOREIGN_UNAUTHENTICATED_ERROR = "unauthenticated";

/**
 * Classify one probe response.
 *
 * @param response the status and body text one probe returned
 * @returns the verdict, and the parameter names the response volunteered
 */
export function classifyWorkosProbe({ response }: { response: WorkosProbeResponse }): WorkosRouteClassification {
  const body = parseJson({ text: response.text });
  if (response.status >= 300 && response.status < 400) {
    return { declaredParams: [], verdict: "redirect" };
  }
  if (response.status === 401) {
    return { declaredParams: [], verdict: unauthorizedVerdict({ body }) };
  }
  if (response.status === 422) {
    return { declaredParams: validationFields({ body }), verdict: "validation-echo" };
  }
  if (response.status === 400) {
    return { declaredParams: oauthMissingParameters({ body }), verdict: "validation-echo" };
  }
  if (response.status === 404) {
    return { declaredParams: [], verdict: notFoundVerdict({ body }) };
  }
  // Any other status came from a route that answered at all, which is itself proof it is routed. A 2xx
  // cannot occur here — every candidate is probed with no credential and no body — so this arm exists for a
  // WorkOS that starts answering something new, and it errs towards recording the route rather than losing it.
  return { declaredParams: [], verdict: "authenticated" };
}

/**
 * Which refusal vocabulary a 401 used.
 *
 * @param body the parsed response body, or `null` when it was not JSON
 * @returns the ordinary verdict, or the foreign-vocabulary one when the body speaks Vault's dialect
 */
function unauthorizedVerdict({ body }: { body: Record<string, unknown> | null }): WorkosRouteVerdict {
  if (body === null) {
    return "authenticated";
  }
  if (stringField({ key: "message", record: body }) === UNAUTHORIZED_MESSAGE) {
    return "authenticated";
  }
  if (stringField({ key: "error", record: body }) === FOREIGN_UNAUTHENTICATED_ERROR) {
    return "authenticated-foreign-vocabulary";
  }
  return "authenticated";
}

/**
 * Whether a 404 says the ROUTE is missing or only the entity named in the path.
 *
 * @param body the parsed response body, or `null` when it was not JSON
 * @returns `entity-scoped` when the route answered about an entity, `absent` when the pair is not routed
 */
function notFoundVerdict({ body }: { body: Record<string, unknown> | null }): WorkosRouteVerdict {
  if (body === null) {
    return "absent";
  }
  if (stringField({ key: "code", record: body }) === ENTITY_NOT_FOUND_CODE) {
    return "entity-scoped";
  }
  const message = stringField({ key: "message", record: body });
  if (message === null) {
    return "absent";
  }
  if (message === GENERIC_NOT_FOUND || message.startsWith(UNROUTED_PREFIX)) {
    return "absent";
  }
  // A 404 with a message of its own that is neither the unrouted shape nor the generic one came from a
  // handler that ran — so the route exists and answered about something it could not find.
  return "entity-scoped";
}

/**
 * The parameter names a validation body named.
 *
 * @param body the parsed response body, or `null` when it was not JSON
 * @returns each distinct `field` name, sorted
 */
export function validationFields({ body }: { body: Record<string, unknown> | null }): readonly string[] {
  if (body === null) {
    return [];
  }
  const errors = body["errors"];
  if (!Array.isArray(errors)) {
    return [];
  }
  const names = errors.flatMap((entry: unknown): readonly string[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const field = stringField({ key: "field", record: entry });
    return field === null ? [] : [field];
  });
  return [...new Set(names)].toSorted();
}

/**
 * The parameter name an OAuth-shaped 400 embedded in its description.
 *
 * WorkOS's OAuth endpoints answer `{"error":"invalid_request","error_description":"Missing required
 * parameter: client_id."}` — one name at a time, in prose. Reading it is worth doing because it is the only
 * evidence those routes give about their own contract without a credential, and the extraction is anchored
 * to the exact published prefix so a differently-worded description yields nothing rather than a fragment
 * of a sentence.
 *
 * @param body the parsed response body, or `null` when it was not JSON
 * @returns the single parameter name, or empty when the description does not carry one
 */
export function oauthMissingParameters({ body }: { body: Record<string, unknown> | null }): readonly string[] {
  if (body === null) {
    return [];
  }
  const description = stringField({ key: "error_description", record: body });
  if (description === null) {
    return [];
  }
  const marker = "Missing required parameter: ";
  const index = description.indexOf(marker);
  if (index < 0) {
    return [];
  }
  const name = description.slice(index + marker.length).replace(/[.\s].*$/u, "");
  return name.length > 0 ? [name] : [];
}

/**
 * Whether a verdict means the route is there.
 *
 * The single place this judgement lives, because five of the six verdicts mean "routed" and writing that
 * as `verdict !== "absent"` at each call site is how one of them eventually gets forgotten.
 *
 * @param verdict the classification to test
 * @returns `true` when the running server proved the route exists
 */
export function workosRouteIsPresent({ verdict }: { verdict: WorkosRouteVerdict }): boolean {
  return verdict !== "absent";
}

/**
 * Parse a body, answering `null` rather than throwing.
 *
 * @param text the raw body
 * @returns the parsed object, or `null` when it is not a JSON object
 */
function parseJson({ text }: { text: string }): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Read one field as a non-empty string.
 *
 * @param record the parsed provider object
 * @param key the field to read
 * @returns the string, or `null` when it is absent, not a string, or empty
 */
function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
