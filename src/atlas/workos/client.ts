/**
 * The one way this atlas reaches WorkOS: a plain HTTP request per route, against one origin it owns.
 *
 * ## The transport is injected, and the URL is not a parameter
 *
 * {@link WorkosFetch} is the seam, and the origin is a constant `routeCandidates.ts` owns rather than
 * something a caller supplies — the same property `atlas/graphqlHive/client.ts` keeps for the same reason:
 * no run can be pointed at a different host by its command line, and a test can drive the whole client with
 * a plain fake function rather than a mock.
 *
 * ## The probe sends nothing and carries nothing
 *
 * A route probe has no body, no query string and — this is the point — no `Authorization` header even when
 * a key is configured. The map is measured on what the server tells an anonymous caller, so a key present
 * on the machine must not be able to change the map's shape; if it could, two installs would publish
 * different route tables for the same platform and neither could be checked against the other.
 *
 * ## A non-2xx is not a failure here
 *
 * Every interesting probe answer is a 4xx. So {@link workosProbe} returns the status and body for the
 * classifier to judge, and reserves its typed failure for the one thing that genuinely went wrong: the
 * request not completing at all.
 *
 * ## A CONTENT read's non-2xx is a failure, and it carries the body
 *
 * {@link workosRead} does treat a non-2xx as a failure — and it carries a bounded slice of what the server
 * answered with into the typed error, because on this API the status alone does not say what went wrong. A
 * listing called without the filter it requires and a listing called with a malformed cursor are both
 * `400`, and WorkOS puts the difference in a body this used to discard. Measured: a sync reported only
 * `…/organization_memberships?limit=100 answered HTTP 400`, which named the status and left the reason to
 * be looked up in the vendor's documentation.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type WorkosApiError, WorkosApiErrors } from "./errors.js";
import type { WorkosHttpMethod } from "./model.js";
import { WORKOS_API_ORIGIN } from "./routeCandidates.js";

/**
 * How much of a refusing endpoint's body is carried into the typed failure.
 *
 * Bounded at the point of CAPTURE rather than at the point of display, per `typescript-patterns.md`'s rule
 * against letting a data-sized payload through one JS string: the atlas never controls what a rejecting
 * endpoint chooses to send back. 400 characters is far more than WorkOS's own error envelopes need — the
 * longest measured one, the four-field `Validation failed` in `workosFixtures.ts`, is under 250 — and far
 * less than an HTML error page. Reproduce a real one with `slopweaver atlas workos sync --json` and read
 * `contentReason`.
 *
 * @internal
 */
export const WORKOS_ERROR_BODY_LIMIT = 400;

/** What one HTTP round trip returns to the client. Deliberately text, so a bad body is the caller's to judge. */
export interface WorkosHttpResponse {
  readonly status: number;
  readonly text: string;
}

/** The injected transport. One call, one response, no retries and no redirect following. */
export type WorkosFetch = (args: {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
}) => Promise<WorkosHttpResponse>;

/**
 * Probe one route with no credential at all and return whatever came back.
 *
 * @param fetch the injected transport
 * @param httpMethod the method to probe with
 * @param path the path to probe, already carrying its `_x` placeholders
 * @returns the status and body, or the typed reason the request never completed
 */
export async function workosProbe({
  fetch,
  httpMethod,
  path,
}: {
  fetch: WorkosFetch;
  httpMethod: WorkosHttpMethod;
  path: string;
}): Promise<Result<WorkosHttpResponse, WorkosApiError>> {
  const url = `${WORKOS_API_ORIGIN}${path}`;
  try {
    return ok(await fetch({ headers: { accept: "application/json" }, method: httpMethod, url }));
  } catch (cause: unknown) {
    return err(WorkosApiErrors.transportFailed({ cause, endpoint: url }));
  }
}

/**
 * Send one AUTHENTICATED read and return its body as sent.
 *
 * Separate from {@link workosProbe} rather than a flag on it, because the two have opposite contracts: a
 * probe treats a 401 as the answer it wanted, and a content read treats the same 401 as a failure. Folding
 * them together is how an atlas records "the tenant has no organisations" on the strength of a rejected key.
 *
 * The body is not interpreted here: which shape a 200 must have is the endpoint's, so `contentRead.ts` reads
 * it through that endpoint's strict boundary in `contentBoundaries.ts`.
 *
 * @param fetch the injected transport
 * @param apiKey the WorkOS secret key to authenticate with
 * @param path the path to read, including any query string
 * @returns the 200 body's text, or the typed reason there is none
 */
export async function workosRead({
  fetch,
  apiKey,
  path,
}: {
  fetch: WorkosFetch;
  apiKey: string;
  path: string;
}): Promise<Result<string, WorkosApiError>> {
  const url = `${WORKOS_API_ORIGIN}${path}`;
  let response: WorkosHttpResponse;
  try {
    response = await fetch({
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      method: "GET",
      url,
    });
  } catch (cause: unknown) {
    return err(WorkosApiErrors.transportFailed({ cause, endpoint: url }));
  }
  if (response.status !== 200) {
    return err(
      WorkosApiErrors.httpStatus({
        body: boundedErrorBody({ text: response.text }),
        endpoint: url,
        statusCode: response.status,
      }),
    );
  }
  return ok(response.text);
}

/**
 * Reduce a refusing endpoint's body to the bounded slice a failure may carry.
 *
 * Whitespace is collapsed first, so an indented JSON envelope spends its budget on the message it holds
 * rather than on newlines, and a truncation SAYS it truncated rather than trailing off mid-word.
 *
 * @param text the raw body
 * @returns the slice to carry, marked when the bound cut it
 *
 * @internal
 */
export function boundedErrorBody({ text }: { text: string }): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= WORKOS_ERROR_BODY_LIMIT) {
    return collapsed;
  }
  return `${collapsed.slice(0, WORKOS_ERROR_BODY_LIMIT)}… (truncated at ${String(WORKOS_ERROR_BODY_LIMIT)} characters)`;
}
