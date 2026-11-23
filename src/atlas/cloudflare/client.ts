/**
 * The one guarded Cloudflare SDK boundary every reader calls through — construction, the envelope guard,
 * and the live half of account/deep-zone selection. See `config.ts` for the pure, offline half (format
 * validation only); this module is what proves the configured account and deep zone actually exist.
 *
 * ## Why a `guardingFetch`, not just `try`/`catch` around the SDK
 *
 * The SDK's generated response parser (`internal/parse.mjs`) returns whatever JSON body an HTTP-200
 * response carried, without ever checking Cloudflare's own `success` field — and its retry/error logic
 * only triggers on `!response.ok`. A `success:false` body riding on HTTP 200 would therefore read as an
 * ordinary empty success to every caller. `guardingFetch` inspects the body once, and — only for that one
 * shape — hands the SDK back a synthesized, marked, non-retryable error response instead of the real one,
 * so the SDK's own `APIError.generate` throws exactly as it would for a genuine 4xx. Every other response
 * passes through byte-for-byte.
 *
 * ## Why retry is never reimplemented here
 *
 * `src/devLint/resilienceResidue.ts` bans bespoke retry/backoff repo-wide, and the SDK already retries
 * connection failures and 408/409/429/5xx on its own (`maxRetries`). This module only maps what survives
 * those retries into this repo's typed `Result`; it never sleeps, loops, or races a timer.
 */
import Cloudflare, { APIError } from "cloudflare";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { CloudflareSelectionInput } from "./config.js";
import {
  type CloudflareClientError,
  CloudflareClientErrors,
  type CloudflareScopeError,
  CloudflareScopeErrors,
} from "./errors.js";
import type { CloudflareSelection } from "./model.js";

/** The header `guardingFetch` stamps on a synthesized envelope-guard response, so `mapCloudflareError` can
 * tell it apart from a genuine HTTP error at the same status code. */
const ENVELOPE_GUARD_HEADER = "x-slopweaver-cloudflare-envelope-guard";

/**
 * Whether a response's declared content type is JSON — the only shape `guardingFetch` needs to inspect.
 * Media-type tokens are case-insensitive (RFC 7231 §3.1.1.1), so this lowercases before matching — a
 * `Content-Type: Application/JSON` response is exactly as JSON as a lowercase one.
 *
 * @param response the fetch response to check
 * @returns true if the content-type header names a JSON media type
 */
function isJsonResponse({ response }: { response: Response }): boolean {
  return response.headers.get("content-type")?.toLowerCase().includes("json") === true;
}

/**
 * Wrap a `fetch` implementation so an HTTP-200 Cloudflare envelope reporting `success:false` is turned into
 * a synthesized, non-retryable error response the SDK raises as a `Cloudflare.APIError`, instead of a
 * silent empty success. Every other response — including a genuine HTTP error, which the SDK already
 * handles — passes through unchanged.
 *
 * @param fetchImpl the underlying fetch to wrap; defaults to the global `fetch`
 * @returns a fetch-compatible function safe to pass as the SDK's own `fetch` option
 */
export function createGuardingFetch({
  fetchImpl = globalThis.fetch,
}: {
  fetchImpl?: typeof globalThis.fetch;
} = {}): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!response.ok || !isJsonResponse({ response })) {
      return response;
    }
    const clone = response.clone();
    let body: unknown;
    try {
      body = await clone.json();
    } catch {
      return response;
    }
    if (!isRecord(body) || body["success"] !== false) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("x-should-retry", "false");
    headers.set(ENVELOPE_GUARD_HEADER, "1");
    return new Response(JSON.stringify(body), {
      headers,
      status: 400,
      statusText: "cloudflare reported success:false on an HTTP-200 response",
    });
  };
}

/**
 * Build the one shared Cloudflare client every reader is handed. Retry and pagination are the SDK's own;
 * this only wires the token and the envelope guard.
 *
 * @param apiToken the resolved Cloudflare API token (`cloudflareToken()` in `src/config.ts`)
 * @param fetchImpl the underlying fetch `guardingFetch` wraps; defaults to the global `fetch` — a test
 *   overrides this to inject a plain fake response, never the SDK itself
 * @param maxRetries how many times the SDK may retry a retryable failure; defaults to its own default (2).
 *   A characterization test that wants to observe a single failure without retry delay overrides this to 0
 * @returns a constructed `Cloudflare` client
 */
export function createCloudflareClient({
  apiToken,
  fetchImpl,
  maxRetries = 2,
}: {
  apiToken: string;
  fetchImpl?: typeof globalThis.fetch;
  maxRetries?: number;
}): Cloudflare {
  return new Cloudflare({
    apiToken,
    fetch: createGuardingFetch(fetchImpl !== undefined ? { fetchImpl } : {}),
    maxRetries,
    timeout: 60_000,
  });
}

/**
 * Map whatever a Cloudflare SDK call threw into this repo's typed error union. No SDK exception may escape
 * a reader uncaught — this is the one place that mapping happens.
 *
 * @param operation the SDK operation name, for diagnostics
 * @param cause the caught value
 * @returns the typed client error
 */
export function mapCloudflareError({ operation, cause }: { operation: string; cause: unknown }): CloudflareClientError {
  if (cause instanceof APIError) {
    if (cause.headers?.get(ENVELOPE_GUARD_HEADER) === "1") {
      return CloudflareClientErrors.responseEnvelope({ cause, operation });
    }
    // `APIConnectionError`/`APIConnectionTimeoutError` are APIError subclasses with no status at all — a
    // connection or timeout failure never reached a real HTTP response, so it belongs under "transport",
    // never folded into "provider" as a fake status 0.
    if (cause.status === undefined) {
      return CloudflareClientErrors.transport({ cause, operation });
    }
    switch (cause.status) {
      case 401:
        return CloudflareClientErrors.authentication({ cause, operation });
      case 403:
        return CloudflareClientErrors.permission({ cause, operation });
      case 404:
        return CloudflareClientErrors.notFound({ cause, operation });
      case 429:
        return CloudflareClientErrors.rateLimit({ cause, operation });
      default:
        return CloudflareClientErrors.provider({ cause, operation, status: cause.status });
    }
  }
  return CloudflareClientErrors.transport({ cause, operation });
}

/**
 * Run one Cloudflare SDK call, catching whatever it throws and mapping it into the typed `Result`. Every
 * reader in this atlas calls through this rather than touching the SDK's own thrown exceptions directly.
 *
 * @param operation the SDK operation name, for diagnostics
 * @param call the thunk performing the actual SDK call
 * @returns the call's value, or the mapped typed error
 */
export async function callCloudflare<T>({
  operation,
  call,
}: {
  operation: string;
  call: () => Promise<T>;
}): Promise<Result<T, CloudflareClientError>> {
  try {
    return ok(await call());
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation }));
  }
}

/** One matched zone, validated against the runtime response rather than the SDK's declared static type. */
interface MatchedZone {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
}

/**
 * Validate a zone already matched by name, refusing rather than trusting an SDK-declared field the runtime
 * response actually omitted. `id` is typed `unknown` here on purpose: the SDK declares `Zone.id: string`,
 * but that is a compile-time promise about a generated type, not a guarantee about the JSON Cloudflare
 * actually sent — this is the same class of trust gap `guardingFetch` closes for `success`.
 *
 * @param zone the matched zone, narrowed to only the fields this check needs
 * @returns the validated id/name/accountId, or why the response could not be trusted
 */
function validateMatchedZone({
  zone,
}: {
  zone: { id: unknown; name: string; account: { id?: string } };
}): Result<MatchedZone, CloudflareClientError> {
  if (typeof zone.id !== "string" || zone.id.length === 0) {
    return err(
      CloudflareClientErrors.schema({
        cause: `zone "${zone.name}" matching the configured deep zone had no id in the response`,
        operation: "zones.list",
      }),
    );
  }
  if (zone.account.id === undefined) {
    return err(
      CloudflareClientErrors.schema({
        cause: `zone "${zone.name}" (${zone.id}) had no account.id in the response`,
        operation: "zones.list",
      }),
    );
  }
  return ok({ accountId: zone.account.id, id: zone.id, name: zone.name });
}

/**
 * Resolve the live account/deep-zone scope: prove the configured account is reachable, then find exactly
 * one zone under it whose name matches the configured deep zone. Never selects a zone by array position —
 * zero or more than one name match is a hard refusal, not a guess.
 *
 * @param client the constructed Cloudflare client
 * @param selection the format-validated selection input from `resolveCloudflareSelection`
 * @returns the live-verified selection, or the reason it could not be resolved
 */
export async function resolveLiveCloudflareScope({
  client,
  selection,
}: {
  client: Cloudflare;
  selection: CloudflareSelectionInput;
}): Promise<Result<CloudflareSelection, CloudflareClientError | CloudflareScopeError>> {
  const account = await callCloudflare({
    call: () => client.accounts.get({ account_id: selection.accountId }),
    operation: "accounts.get",
  });
  if (account.isErr()) {
    return err(account.error);
  }

  const matches: MatchedZone[] = [];
  try {
    for await (const zone of client.zones.list({ account: { id: selection.accountId } })) {
      if (zone.name.toLowerCase() !== selection.deepZoneName) {
        continue;
      }
      const validated = validateMatchedZone({ zone });
      if (validated.isErr()) {
        return err(validated.error);
      }
      matches.push(validated.value);
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zones.list" }));
  }

  if (matches.length === 0) {
    return err(CloudflareScopeErrors.zoneNotFound({ deepZoneName: selection.deepZoneName }));
  }
  if (matches.length > 1) {
    return err(
      CloudflareScopeErrors.zoneAmbiguous({ deepZoneName: selection.deepZoneName, matchCount: matches.length }),
    );
  }
  const zone = matches[0]!;
  if (zone.accountId !== selection.accountId) {
    return err(
      CloudflareScopeErrors.zoneAccountMismatch({
        actualAccountId: zone.accountId,
        deepZoneName: selection.deepZoneName,
        expectedAccountId: selection.accountId,
      }),
    );
  }

  return ok({ accountId: selection.accountId, deepZone: { id: zone.id, name: zone.name } });
}
