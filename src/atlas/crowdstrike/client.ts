/**
 * Execute an admitted Falcon call, and turn every provider outcome into a typed fact.
 *
 * ## The client cannot be asked for an arbitrary request
 *
 * {@link requestCrowdstrike} takes a CALL ID, not a method and a path. The URL is built here from the row
 * `inventory.ts` holds, so there is no argument a caller could pass that reaches an endpoint the inventory
 * does not list. That is the property the whole read-only claim rests on in code, and it is why this module
 * exports no generic `get`/`post` helper — adding one would quietly defeat it.
 *
 * ## Three outcomes that look alike from the outside, kept apart here
 *
 * Measured live: a scope this credential lacks answers HTTP 403 with exactly
 * `access denied, scope not permitted`; an authorised but empty query answers 200 with an empty list; an
 * absent or unprovisioned product answers 404. Coverage depends on telling those apart — `unreadable`,
 * `synced` and `unavailable` respectively — so the discrimination lives here once rather than being
 * re-derived by string-matching at each call site.
 *
 * A 401 is retried EXACTLY once, after re-minting. A second 401 on a fresh bearer is not a transient
 * problem: it means the host, the id or the secret is wrong, and retrying would only make the same wrong
 * answer arrive more slowly.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type CrowdstrikeError, CrowdstrikeErrors } from "./errors.js";
import { type CrowdstrikeCall, findCrowdstrikeCall, isCrowdstrikeCallId } from "./inventory.js";
import type { TokenProvider } from "./tokenProvider.js";

/**
 * A raw provider answer, before any projection.
 *
 * @internal
 */
export interface CrowdstrikeResponse {
  readonly statusCode: number;
  readonly body: unknown;
  /** `meta.pagination.total`, when the provider reported one. */
  readonly total: number | null;
  /** The opaque `after` cursor, when the provider offered one. */
  readonly afterCursor: string | null;
  /** The endpoint actually called, for the provenance a stored record carries. */
  readonly endpoint: string;
}

/** The HTTP seam, injected so every test runs without a network. */
export type CrowdstrikeFetch = (args: {
  url: string;
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body: string | null;
}) => Promise<{ status: number; text: string }>;

/**
 * Query parameters for one call. A value may be a LIST, because Falcon takes an id batch as a repeated
 * `ids` parameter and a builder that kept one value per name would silently fetch one entity per batch.
 *
 * @internal
 */
export type CrowdstrikeQuery = Readonly<Record<string, string | readonly string[]>>;

/**
 * What one call needs beyond its inventory row.
 *
 * @internal
 */
export interface CrowdstrikeRequestInput {
  /** Query parameters, already validated by the caller; never a caller-supplied path. */
  readonly query?: CrowdstrikeQuery;
  /** Body fields for an admitted POST — an id batch, in practice. */
  readonly body?: Readonly<Record<string, unknown>>;
}

/** Everything `requestCrowdstrike` needs to reach the provider. */
export interface CrowdstrikeClientDeps {
  readonly apiHost: string;
  readonly tokens: TokenProvider;
  readonly fetch: CrowdstrikeFetch;
  readonly nowMs: () => number;
}

/** The exact body Falcon returns when a scope is missing. Matched, not guessed. */
const SCOPE_REFUSAL = "access denied, scope not permitted";

/**
 * Build the absolute URL for an admitted call.
 *
 * @param apiHost the normalised origin
 * @param call the admitted inventory row
 * @param query the query parameters to append
 * @returns the absolute URL
 */
export function buildCrowdstrikeUrl({
  apiHost,
  call,
  query = {},
}: {
  apiHost: string;
  call: CrowdstrikeCall;
  query?: CrowdstrikeQuery;
}): string {
  const url = new URL(`${apiHost}${call.path}`);
  for (const [key, value] of Object.entries(query)) {
    // A list APPENDS: Falcon's id-batch endpoints take `ids=a&ids=b`, and `set` would keep only the last.
    for (const entry of typeof value === "string" ? [value] : value) {
      url.searchParams.append(key, entry);
    }
  }
  return url.toString();
}

/** Does this parsed body carry Falcon's exact scope-refusal message? */
function isScopeRefusal({ body }: { body: unknown }): boolean {
  if (!isRecord(body) || !Array.isArray(body["errors"])) {
    return false;
  }
  return body["errors"].some((entry: unknown) => {
    if (!isRecord(entry)) {
      return false;
    }
    const message = entry["message"];
    return typeof message === "string" && message.includes(SCOPE_REFUSAL);
  });
}

/** Read `meta.pagination` without trusting its shape. */
function readPagination({ body }: { body: unknown }): { total: number | null; after: string | null } {
  if (!isRecord(body) || !isRecord(body["meta"]) || !isRecord(body["meta"]["pagination"])) {
    return { after: null, total: null };
  }
  const page = body["meta"]["pagination"];
  const after = page["after"];
  return {
    after: typeof after === "string" && after.length > 0 ? after : null,
    total: typeof page["total"] === "number" ? page["total"] : null,
  };
}

/**
 * Perform one admitted call.
 *
 * @param callId the id of a row in the closed inventory — never a path
 * @param input the query and body for this invocation
 * @param deps the host, token provider, HTTP seam and clock
 * @returns the provider's answer, or a typed failure a coverage grader can branch on
 */
export async function requestCrowdstrike({
  callId,
  input,
  deps,
}: {
  callId: string;
  input: CrowdstrikeRequestInput;
  deps: CrowdstrikeClientDeps;
}): Promise<Result<CrowdstrikeResponse, CrowdstrikeError>> {
  if (!isCrowdstrikeCallId(callId)) {
    return err(
      CrowdstrikeErrors.unusableResponse({
        callId,
        reason: "no such call is admitted by the CrowdStrike inventory, so no request was made",
      }),
    );
  }
  const call = findCrowdstrikeCall({ id: callId });
  const first = await attempt({ call, deps, input });
  if (first.isErr()) {
    return first;
  }
  if (first.value.statusCode !== 401) {
    return grade({ call, response: first.value });
  }
  // Exactly one re-mint. A second 401 on a fresh bearer is a wrong credential, not a transient failure.
  deps.tokens.invalidate();
  const second = await attempt({ call, deps, input });
  if (second.isErr()) {
    return second;
  }
  if (second.value.statusCode === 401) {
    return err(CrowdstrikeErrors.authFailed({ reason: `${call.path} answered HTTP 401 twice`, remintAttempted: true }));
  }
  return grade({ call, response: second.value });
}

/** One HTTP round trip with a live bearer. */
async function attempt({
  call,
  deps,
  input,
}: {
  call: CrowdstrikeCall;
  deps: CrowdstrikeClientDeps;
  input: CrowdstrikeRequestInput;
}): Promise<Result<CrowdstrikeResponse, CrowdstrikeError>> {
  const token = await deps.tokens.token({ nowMs: deps.nowMs() });
  if (token.isErr()) {
    return err(token.error);
  }
  const url = buildCrowdstrikeUrl({
    apiHost: deps.apiHost,
    call,
    ...(input.query === undefined ? {} : { query: input.query }),
  });
  const hasBody = call.method === "POST" && input.body !== undefined;
  try {
    const raw = await deps.fetch({
      body: hasBody ? JSON.stringify(input.body) : null,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token.value}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      method: call.method,
      url,
    });
    let body: unknown = null;
    try {
      body = raw.text.length > 0 ? JSON.parse(raw.text) : null;
    } catch {
      body = null;
    }
    const pagination = readPagination({ body });
    return ok({
      afterCursor: pagination.after,
      body,
      endpoint: call.path,
      statusCode: raw.status,
      total: pagination.total,
    });
  } catch (error: unknown) {
    return err(CrowdstrikeErrors.transportExhausted({ callId: call.id, reason: errorMessage({ error }) }));
  }
}

/** Turn a status code into the typed fact coverage needs. */
function grade({
  call,
  response,
}: {
  call: CrowdstrikeCall;
  response: CrowdstrikeResponse;
}): Result<CrowdstrikeResponse, CrowdstrikeError> {
  if (response.statusCode === 200) {
    return ok(response);
  }
  if (response.statusCode === 403 && isScopeRefusal({ body: response.body })) {
    return err(CrowdstrikeErrors.scopeRefused({ callId: call.id, path: call.path, scope: call.scope }));
  }
  if (response.statusCode === 404) {
    return err(CrowdstrikeErrors.routeAbsent({ callId: call.id, path: call.path }));
  }
  if (response.statusCode === 429) {
    return err(CrowdstrikeErrors.transportExhausted({ callId: call.id, reason: "HTTP 429, rate limited" }));
  }
  return err(CrowdstrikeErrors.unusableResponse({ callId: call.id, reason: `unexpected HTTP ${response.statusCode}` }));
}
