/**
 * The one way this atlas reaches GraphQL Hive: a single POST to its single GraphQL endpoint.
 *
 * ## Why the whole API surface is ONE request
 *
 * Hive exposes one GraphQL endpoint rather than a REST tree, so "every endpoint, every method, every
 * parameter" (`docs/atlas-intent/02-both-surfaces.md`) is not a crawl of paths — it is the introspected schema. One
 * `__schema` query returns every root field with its arguments and every named type with its fields, which
 * is why the owner's own ranking called this a small, well-shaped API. The registry's CONTENT then takes a
 * second query against that same endpoint.
 *
 * ## The transport is injected, and the URL is not a parameter
 *
 * {@link HiveFetch} is the seam, and the endpoint is a constant this module owns rather than something a
 * caller supplies — the same property `atlas/crowdstrike/client.ts` keeps for the same reason: no run can
 * be pointed at a different host by its command line, and a test can drive the whole client with a plain
 * fake function rather than a mock.
 *
 * ## Every failure is typed at this boundary
 *
 * A thrown transport error, a non-200, a body that is not the GraphQL envelope, and a 200 carrying an
 * `errors` array are four different things a caller branches on — see `errors.ts` on why this atlas earns a
 * union rather than a list of strings. In particular a 200-with-errors is a provider-shaped FALSE SUCCESS,
 * and folding it into "the request worked" is how an atlas publishes an empty generation and calls it
 * synced.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type HiveApiError, HiveApiErrors } from "./errors.js";

/**
 * Hive Cloud's single GraphQL endpoint. Owned here, never passed in — see this file's header.
 *
 * @internal
 */
export const HIVE_API_ENDPOINT = "https://api.graphql-hive.com/graphql";

/** What one HTTP round trip returns to the client. Deliberately text, so a bad body is the client's to judge. */
export interface HiveHttpResponse {
  readonly status: number;
  readonly text: string;
}

/** The injected transport. One call, one response, no retries and no URL of its own. */
export type HiveFetch = (args: {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}) => Promise<HiveHttpResponse>;

/** Everything the client needs. `token` is `null` for an unauthenticated probe of the public schema. */
export interface HiveClientDeps {
  readonly fetch: HiveFetch;
  readonly token: string | null;
}

/**
 * Send one GraphQL operation and return its `data` payload.
 *
 * @param deps the transport and the token to authenticate with
 * @param query the operation document
 * @param variables the operation's variables, or an empty object when it takes none
 * @returns the response's `data` object, or the typed reason there is none
 */
export async function hiveGraphql({
  deps,
  query,
  variables,
}: {
  deps: HiveClientDeps;
  query: string;
  variables: Readonly<Record<string, unknown>>;
}): Promise<Result<Record<string, unknown>, HiveApiError>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (deps.token !== null) {
    headers["authorization"] = `Bearer ${deps.token}`;
  }
  let response: HiveHttpResponse;
  try {
    response = await deps.fetch({ body: JSON.stringify({ query, variables }), headers, url: HIVE_API_ENDPOINT });
  } catch (cause: unknown) {
    return err(HiveApiErrors.transportFailed({ cause, endpoint: HIVE_API_ENDPOINT }));
  }
  return readGraphqlEnvelope({ response });
}

/**
 * Turn one HTTP response into the `data` object, or into the typed reason it is not one.
 *
 * Pure, and split out so all four failure shapes are testable with no transport at all. A 200 carrying a
 * GraphQL `errors` array is the one worth naming: it is a provider-shaped FALSE SUCCESS, and folding it
 * into "the request worked" is how an atlas publishes an empty generation and calls it synced.
 *
 * @param response the status and body text one round trip returned
 * @returns the `data` object, or the typed failure it carried instead
 */
export function readGraphqlEnvelope({
  response,
}: {
  response: HiveHttpResponse;
}): Result<Record<string, unknown>, HiveApiError> {
  if (response.status !== 200) {
    return err(HiveApiErrors.httpStatus({ endpoint: HIVE_API_ENDPOINT, statusCode: response.status }));
  }
  const parsed = parseJson({ text: response.text });
  if (parsed === null) {
    return err(HiveApiErrors.malformedResponse({ endpoint: HIVE_API_ENDPOINT, reason: "the body is not valid JSON" }));
  }
  const messages = graphqlErrorMessages({ envelope: parsed });
  if (messages.length > 0) {
    return err(HiveApiErrors.graphqlErrors({ endpoint: HIVE_API_ENDPOINT, errors: messages }));
  }
  const data = fieldOf({ key: "data", record: parsed });
  if (!isRecord(data)) {
    return err(
      HiveApiErrors.malformedResponse({ endpoint: HIVE_API_ENDPOINT, reason: "the body carries no `data` object" }),
    );
  }
  return ok(data);
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
 * Every message a GraphQL `errors` array carried, in order.
 *
 * @param envelope the parsed response body
 * @returns the messages, empty when the response declares no errors
 */
export function graphqlErrorMessages({ envelope }: { envelope: Record<string, unknown> }): readonly string[] {
  const errors = fieldOf({ key: "errors", record: envelope });
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.map((entry: unknown, index: number) => {
    const message = isRecord(entry) ? fieldOf({ key: "message", record: entry }) : null;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    return `error ${String(index)} carried no message`;
  });
}

/**
 * Whether a value is a plain object this module can index.
 *
 * @param value the value to test
 * @returns `true` when it is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one field off a provider object, under `noPropertyAccessFromIndexSignature`.
 *
 * Provider JSON is an index signature, so every read of it is a bracket access. Naming that read is worth
 * one function: the call sites say WHICH field they are reaching for, and a reader can see at a glance
 * that nothing here trusts a shape it did not check.
 *
 * @param record the parsed provider object
 * @param key the field to read
 * @returns the value, or `undefined` when the object does not carry it
 */
export function fieldOf({ record, key }: { record: Record<string, unknown>; key: string }): unknown {
  return record[key];
}

/**
 * Read one field as a non-empty string.
 *
 * @param record the parsed provider object
 * @param key the field to read
 * @returns the string, or `null` when it is absent, not a string, or empty
 */
export function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | null {
  const value = fieldOf({ key, record });
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read one field as an array.
 *
 * @param record the parsed provider object
 * @param key the field to read
 * @returns its entries, empty when the field is absent or is not an array
 */
export function arrayField({ record, key }: { record: Record<string, unknown>; key: string }): readonly unknown[] {
  const value = fieldOf({ key, record });
  return Array.isArray(value) ? value : [];
}
