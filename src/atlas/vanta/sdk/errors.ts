/**
 * Typed discriminated-union error for `atlas/vanta/sdk/**` — the one domain in this port whose failures
 * are genuinely two distinct kinds a caller might branch on: a request that never completed successfully
 * (`API_ERROR`), and a 2xx response the endpoint's strict boundary refused (`RESPONSE_VALIDATION_ERROR`).
 * Every SDK method returns `Result<T, VantaSdkError>` rather than throwing — this repo's error-handling
 * convention has no exception for a client meant to read like a real SDK.
 */
import type { BoundaryError } from "#lib/boundary.js";

/** The HTTP verb every SDK operation issues. */
export type VantaSdkMethod = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * The request never completed successfully — a non-2xx response from Vanta, or the request never reaching
 * Vanta at all. `transport.ts` does not distinguish those two cases structurally (both arrive as a plain
 * `string[]` of reasons), so neither does this: `reasons` is transport's own classified text.
 */
export interface VantaSdkApiError {
  readonly code: "VANTA_SDK_API_ERROR";
  readonly message: string;
  readonly operationId: string;
  readonly method: VantaSdkMethod;
  readonly path: string;
  readonly reasons: readonly string[];
}

/**
 * Vanta answered with a 2xx, but the endpoint's strict boundary refused the body — text that is not JSON, or
 * JSON with a field added, dropped, renamed or retyped. `boundaryError` carries the refusal whole: its
 * `endpoint` is the path TEMPLATE the boundary was declared for, while `path` is this one call's filled path.
 */
export interface VantaSdkResponseValidationError {
  readonly code: "VANTA_SDK_RESPONSE_VALIDATION_ERROR";
  readonly message: string;
  readonly operationId: string;
  readonly method: VantaSdkMethod;
  readonly path: string;
  readonly boundaryError: BoundaryError;
}

/** Every failure `atlas/vanta/sdk/**` can produce. */
export type VantaSdkError = VantaSdkApiError | VantaSdkResponseValidationError;

export const VantaSdkErrors = {
  apiError: ({
    operationId,
    method,
    path,
    reasons,
  }: {
    operationId: string;
    method: VantaSdkMethod;
    path: string;
    reasons: readonly string[];
  }): VantaSdkApiError => ({
    code: "VANTA_SDK_API_ERROR",
    message: reasons.join("; "),
    method,
    operationId,
    path,
    reasons,
  }),
  responseValidationError: ({
    operationId,
    method,
    path,
    boundaryError,
  }: {
    operationId: string;
    method: VantaSdkMethod;
    path: string;
    boundaryError: BoundaryError;
  }): VantaSdkResponseValidationError => ({
    boundaryError,
    code: "VANTA_SDK_RESPONSE_VALIDATION_ERROR",
    message: boundaryError.message,
    method,
    operationId,
    path,
  }),
} as const;
