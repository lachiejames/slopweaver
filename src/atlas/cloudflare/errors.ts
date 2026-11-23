/**
 * Typed discriminated-union domain errors for `src/atlas/cloudflare/**`. Two separate unions, not one —
 * `CloudflareClientError` is what the guarded SDK boundary in `client.ts` can throw at the HTTP layer;
 * `CloudflareScopeError` is a plain data-validation failure (zero/many zones matched a configured name)
 * that never comes from a thrown SDK exception at all. Folding them into one union would blur that the
 * second kind needs no network call to reproduce.
 *
 * Each factory returns its own specific interface, not the wider union — the same shape
 * `src/corpus/github/errors.ts` uses — so a caller that already knows which variant it built (or a test
 * that calls one factory directly) never needs to re-narrow a union it just constructed.
 */
import { errorMessage } from "../../lib/errorMessage.js";

export interface CloudflareAuthenticationError {
  readonly kind: "authentication";
  readonly operation: string;
  readonly status: 401;
  readonly message: string;
}

export interface CloudflarePermissionError {
  readonly kind: "permission";
  readonly operation: string;
  readonly status: 403;
  readonly message: string;
}

export interface CloudflareNotFoundError {
  readonly kind: "not-found";
  readonly operation: string;
  readonly status: 404;
  readonly message: string;
}

export interface CloudflareRateLimitError {
  readonly kind: "rate-limit";
  readonly operation: string;
  readonly status: 429;
  readonly message: string;
}

export interface CloudflareProviderError {
  readonly kind: "provider";
  readonly operation: string;
  readonly status: number;
  readonly message: string;
}

export interface CloudflareTransportError {
  readonly kind: "transport";
  readonly operation: string;
  readonly message: string;
}

export interface CloudflareResponseEnvelopeError {
  readonly kind: "response-envelope";
  readonly operation: string;
  readonly message: string;
}

export interface CloudflareSchemaError {
  readonly kind: "schema";
  readonly operation: string;
  readonly message: string;
}

/**
 * A GraphQL call reached the API (HTTP 200) but its own `errors` array reported the query itself failed —
 * an unknown field, a bad argument, a dataset the token cannot see. Distinct from `CloudflareResponseEnvelopeError`
 * because the REST envelope's `success:false` and GraphQL's `errors` array are different response shapes with
 * different messages, not the same failure wearing two names.
 */
export interface CloudflareGraphqlError {
  readonly kind: "graphql-error";
  readonly operation: string;
  readonly message: string;
}

/** Every failure the guarded Cloudflare SDK client (`client.ts`) can produce for one call. */
export type CloudflareClientError =
  | CloudflareAuthenticationError
  | CloudflarePermissionError
  | CloudflareNotFoundError
  | CloudflareRateLimitError
  | CloudflareProviderError
  | CloudflareTransportError
  | CloudflareResponseEnvelopeError
  | CloudflareSchemaError
  | CloudflareGraphqlError;

export const CloudflareClientErrors = {
  authentication: ({ operation, cause }: { operation: string; cause: unknown }): CloudflareAuthenticationError => ({
    kind: "authentication",
    message: `cloudflare ${operation}: authentication failed (401) — check the configured token: ${errorMessage({ error: cause })}`,
    operation,
    status: 401,
  }),
  notFound: ({ operation, cause }: { operation: string; cause: unknown }): CloudflareNotFoundError => ({
    kind: "not-found",
    message: `cloudflare ${operation}: not found (404): ${errorMessage({ error: cause })}`,
    operation,
    status: 404,
  }),
  permission: ({ operation, cause }: { operation: string; cause: unknown }): CloudflarePermissionError => ({
    kind: "permission",
    message: `cloudflare ${operation}: permission denied (403) — the configured token cannot see this surface: ${errorMessage({ error: cause })}`,
    operation,
    status: 403,
  }),
  provider: ({
    operation,
    status,
    cause,
  }: {
    operation: string;
    status: number;
    cause: unknown;
  }): CloudflareProviderError => ({
    kind: "provider",
    message: `cloudflare ${operation}: provider error (${status}): ${errorMessage({ error: cause })}`,
    operation,
    status,
  }),
  rateLimit: ({ operation, cause }: { operation: string; cause: unknown }): CloudflareRateLimitError => ({
    kind: "rate-limit",
    message: `cloudflare ${operation}: rate limited (429) after the SDK's own retries: ${errorMessage({ error: cause })}`,
    operation,
    status: 429,
  }),
  graphqlError: ({
    operation,
    messages,
  }: {
    operation: string;
    messages: readonly string[];
  }): CloudflareGraphqlError => ({
    kind: "graphql-error",
    message: `cloudflare ${operation}: graphql query returned ${String(messages.length)} error(s): ${messages.join("; ")}`,
    operation,
  }),
  responseEnvelope: ({ operation, cause }: { operation: string; cause: unknown }): CloudflareResponseEnvelopeError => ({
    kind: "response-envelope",
    message: `cloudflare ${operation}: HTTP 200 but the response envelope reported success:false: ${errorMessage({ error: cause })}`,
    operation,
  }),
  schema: ({ operation, cause }: { operation: string; cause: unknown }): CloudflareSchemaError => ({
    kind: "schema",
    message: `cloudflare ${operation}: response failed local schema validation: ${errorMessage({ error: cause })}`,
    operation,
  }),
  transport: ({ operation, cause }: { operation: string; cause: unknown }): CloudflareTransportError => ({
    kind: "transport",
    message: `cloudflare ${operation}: transport failure (timeout/connection): ${errorMessage({ error: cause })}`,
    operation,
  }),
} as const;

export interface CloudflareZoneNotFoundError {
  readonly kind: "zone-not-found";
  readonly deepZoneName: string;
  readonly message: string;
}

export interface CloudflareZoneAmbiguousError {
  readonly kind: "zone-ambiguous";
  readonly deepZoneName: string;
  readonly matchCount: number;
  readonly message: string;
}

export interface CloudflareZoneAccountMismatchError {
  readonly kind: "zone-account-mismatch";
  readonly deepZoneName: string;
  readonly expectedAccountId: string;
  readonly actualAccountId: string;
  readonly message: string;
}

/**
 * Every failure resolving the live account/deep-zone scope (`resolveLiveCloudflareScope`) can produce, once
 * the HTTP calls themselves already succeeded. None of these come from a thrown exception.
 */
export type CloudflareScopeError =
  CloudflareZoneNotFoundError | CloudflareZoneAmbiguousError | CloudflareZoneAccountMismatchError;

export const CloudflareScopeErrors = {
  zoneAccountMismatch: ({
    deepZoneName,
    expectedAccountId,
    actualAccountId,
  }: {
    deepZoneName: string;
    expectedAccountId: string;
    actualAccountId: string;
  }): CloudflareZoneAccountMismatchError => ({
    actualAccountId,
    deepZoneName,
    expectedAccountId,
    kind: "zone-account-mismatch",
    message: `cloudflare deep zone "${deepZoneName}" belongs to account ${actualAccountId}, not the configured account ${expectedAccountId}`,
  }),
  zoneAmbiguous: ({
    deepZoneName,
    matchCount,
  }: {
    deepZoneName: string;
    matchCount: number;
  }): CloudflareZoneAmbiguousError => ({
    deepZoneName,
    kind: "zone-ambiguous",
    matchCount,
    message: `cloudflare deep zone name "${deepZoneName}" matched ${matchCount} zones under the configured account — refusing to guess`,
  }),
  zoneNotFound: ({ deepZoneName }: { deepZoneName: string }): CloudflareZoneNotFoundError => ({
    deepZoneName,
    kind: "zone-not-found",
    message: `cloudflare deep zone "${deepZoneName}" was not found among the configured account's zones`,
  }),
} as const;
