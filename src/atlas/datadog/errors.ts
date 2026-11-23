/**
 * The failure kinds a Datadog atlas read can genuinely produce, as a typed union.
 *
 * Per `.claude/rules/error-handling.md` this domain earns a union rather than `readonly string[]`, because
 * callers BRANCH on these: a `surface-refused` is a programming error that must fail the sync outright, a
 * `rate-limited` read is a budget condition that says come back rather than that anything is broken, and a
 * `forbidden` on one family while others succeed is the difference between a broken credential and a
 * permission boundary this organisation genuinely does not cross.
 *
 * The rate-limit member is the one that is Datadog-shaped rather than inherited. `src/datadog/rateLimit.ts`
 * records why the budget is first-class here in a way it is not for the sibling atlases: Datadog meters per
 * endpoint family and answers 429 with an `x-ratelimit-reset` and no `retry-after`, so a family that ran
 * out of budget has a KNOWN time at which it becomes readable again — which is a coverage state with an
 * `unblockedBy`, not a transport failure.
 */
import type { BoundaryDrift } from "#lib/boundary.js";

/** How many distinct drifted fields a shape refusal's message names before it counts the rest. */
const DRIFT_NAMED = 3;

/**
 * The drift findings a message names: one per distinct field, an array index folded to `[]`, so a field every
 * record on a first page grew reads once rather than as a hundred copies of one finding.
 */
function distinctDrift({ drift }: { drift: readonly BoundaryDrift[] }): readonly string[] {
  return [...new Set(drift.map((entry) => entry.detail.replaceAll(/\[\d+\]/g, "[]")))];
}

/**
 * This repository's own console page registry is empty, so a walk would report full coverage over nothing.
 *
 * The one member of this union that is not about a provider response: it is a defect in `consolePages.ts`
 * rather than anything Datadog did; its `surface` names the walk that refused rather than a call that failed.
 * @internal
 */
export interface DatadogConsoleRegistryEmptyError {
  readonly code: "CONSOLE_REGISTRY_EMPTY";
  readonly message: string;
  readonly surface: string;
}

/**
 * A caller named a surface the closed registry does not admit, or admits only as excluded.
 * @internal
 */
export interface DatadogSurfaceRefusedError {
  readonly code: "SURFACE_REFUSED";
  readonly message: string;
  readonly surface: string;
  /** Present when the surface exists but is inventoried-and-refused, so the reason can be shown. */
  readonly excludedBecause?: string;
}

/**
 * The credential was rejected outright — neither key is valid for this site.
 * @internal
 */
export interface DatadogUnauthorisedError {
  readonly code: "UNAUTHORISED";
  readonly message: string;
  readonly surface: string;
}

/**
 * The credential is valid and this organisation may not read this family.
 * @internal
 */
export interface DatadogForbiddenError {
  readonly code: "FORBIDDEN";
  readonly message: string;
  readonly surface: string;
}

/**
 * The endpoint family's rate-limit budget is spent, and Datadog said when it refills.
 * @internal
 */
export interface DatadogRateLimitedError {
  readonly code: "RATE_LIMITED";
  readonly message: string;
  readonly surface: string;
  /** Seconds until the budget refills, from Datadog's own `x-ratelimit-reset`; `null` when it sent none. */
  readonly resetSeconds: number | null;
}

/**
 * The operation is reachable and needs a QUERY parameter the caller did not supply.
 *
 * Its own variant rather than a transport failure, because it is the one 400 that is not a defect at all.
 * MEASURED on the first live pass over this organisation: kinds reported it, and Datadog
 * names the parameter in its own response body — `missing parameter "page_id" in "query"`. Folded into
 * `UNEXPECTED_SHAPE` those kinds read as "Datadog answered with a shape this build does not admit", which is
 * false in a way a reader would act on: the request was wrong, not the answer.
 *
 * The distinction is also the whole difference between a defect and a BACKLOG item. A path parameter and a
 * mandatory query parameter are the same problem — an operation needing an input this pass cannot supply —
 * and `descriptor.ts` framed the tractable half as "takes no path parameter" before this pass measured the
 * second half of that class into existence.
 * @internal
 */
export interface DatadogMissingParameterError {
  readonly code: "MISSING_PARAMETER";
  readonly message: string;
  readonly surface: string;
  /** The parameter Datadog itself named, or `null` when its 400 named none. */
  readonly parameter: string | null;
}

/**
 * Datadog declares the operation and this site does not serve it.
 *
 * A 501, which is a fact about the SITE rather than about the request or this organisation's data. Kept
 * apart from `FORBIDDEN` because no permission grant would change it, and apart from `UNEXPECTED_SHAPE`
 * because nothing about the answer was malformed.
 * @internal
 */
export interface DatadogNotImplementedError {
  readonly code: "NOT_IMPLEMENTED";
  readonly message: string;
  readonly surface: string;
}

/**
 * The provider answered, but not with something this surface's schema admits.
 * @internal
 */
export interface DatadogUnexpectedShapeError {
  readonly code: "UNEXPECTED_SHAPE";
  readonly message: string;
  readonly surface: string;
  readonly detail: string;
}

/**
 * Datadog answered JSON in a shape this operation's strict boundary does not admit, so nothing it answered is held.
 *
 * Apart from `UNEXPECTED_SHAPE`, which is a body that is not JSON at all: this one is a field Datadog added,
 * dropped, renamed or retyped, and `drift` carries every finding so a reader can regenerate the boundary from it.
 * @internal
 */
export interface DatadogBodyShapeChangedError {
  readonly code: "BODY_SHAPE_CHANGED";
  readonly message: string;
  readonly surface: string;
  readonly drift: readonly BoundaryDrift[];
}

/**
 * The call did not complete — transport, timeout, or a status with no more specific meaning.
 * @internal
 */
export interface DatadogTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly surface: string;
  readonly cause?: unknown;
}

/**
 * A `--limit` that keeps no route at all, which would publish a generation over an empty walk.
 * @internal
 */
export interface DatadogConsoleLimitEmptyError {
  readonly code: "CONSOLE_LIMIT_EMPTY";
  readonly message: string;
  readonly surface: string;
  /** The bound as it was asked for, so the message can name it back. */
  readonly limit: number;
}

/**
 * Every way a Datadog atlas read can fail.
 * @internal
 */
export type DatadogAtlasError =
  | DatadogConsoleLimitEmptyError
  | DatadogConsoleRegistryEmptyError
  | DatadogSurfaceRefusedError
  | DatadogUnauthorisedError
  | DatadogForbiddenError
  | DatadogRateLimitedError
  | DatadogMissingParameterError
  | DatadogNotImplementedError
  | DatadogUnexpectedShapeError
  | DatadogBodyShapeChangedError
  | DatadogTransportFailedError;

/**
 * Construct each failure the same way the real code does, so a test built from these catches a factory that
 * stops matching its own type.
 * @internal
 */
export const DatadogAtlasErrors = {
  bodyShapeChanged: ({
    surface,
    drift,
  }: {
    surface: string;
    drift: readonly BoundaryDrift[];
  }): DatadogBodyShapeChangedError => {
    const distinct = distinctDrift({ drift });
    const named = distinct.slice(0, DRIFT_NAMED);
    const more = distinct.length > DRIFT_NAMED ? ` (+${String(distinct.length - DRIFT_NAMED)} more)` : "";
    return {
      code: "BODY_SHAPE_CHANGED",
      drift,
      message: `${surface} answered a shape this version does not read, so nothing it answered is held: ${named.join("; ")}${more}`,
      surface,
    };
  },
  consoleLimitEmpty: ({ limit }: { limit: number }): DatadogConsoleLimitEmptyError => ({
    code: "CONSOLE_LIMIT_EMPTY",
    limit,
    message: `--limit ${String(limit)} keeps no console route, so the walk would publish a generation over an empty visit. --limit is for proving the lane with a handful of pages; pass at least 1, or leave it off for the whole registry`,
    surface: "console",
  }),
  consoleRegistryEmpty: (): DatadogConsoleRegistryEmptyError => ({
    code: "CONSOLE_REGISTRY_EMPTY",
    message:
      "the Datadog console registry declared no routes, so a walk would report full coverage over nothing. That is a defect in src/atlas/datadog/consolePages.ts, never a fact about the console",
    surface: "console",
  }),
  forbidden: ({ surface }: { surface: string }): DatadogForbiddenError => ({
    code: "FORBIDDEN",
    message: `${surface} answered 403: the credentials are valid and this organisation may not read it. One family failing this way while others succeed is a permission boundary, not a broken key`,
    surface,
  }),
  missingParameter: ({
    surface,
    parameter,
  }: {
    surface: string;
    parameter: string | null;
  }): DatadogMissingParameterError => ({
    code: "MISSING_PARAMETER",
    message:
      parameter === null
        ? `${surface} is reachable and answered 400 for a query parameter it requires; Datadog did not name which. This is a request this pass cannot yet build, NOT an empty product`
        : `${surface} is reachable and requires the query parameter \`${parameter}\`, which this pass does not supply. This is a request this pass cannot yet build, NOT an empty product`,
    parameter,
    surface,
  }),
  notImplemented: ({ surface }: { surface: string }): DatadogNotImplementedError => ({
    code: "NOT_IMPLEMENTED",
    message: `${surface} answered 501: the pinned client declares this operation and this Datadog site does not serve it. No permission grant changes that, so it is a bound of the SITE rather than of this organisation's data`,
    surface,
  }),
  rateLimited: ({
    surface,
    resetSeconds,
  }: {
    surface: string;
    resetSeconds: number | null;
  }): DatadogRateLimitedError => ({
    code: "RATE_LIMITED",
    message:
      resetSeconds === null
        ? `${surface} answered 429 and sent no reset header, so nothing here knows when its budget refills`
        : `${surface} answered 429; its budget refills in ${String(resetSeconds)}s`,
    resetSeconds,
    surface,
  }),
  surfaceRefused: ({
    surface,
    excludedBecause,
  }: {
    surface: string;
    excludedBecause?: string;
  }): DatadogSurfaceRefusedError =>
    excludedBecause === undefined
      ? {
          code: "SURFACE_REFUSED",
          message: `${surface} is not a surface this atlas admits — the registry is closed, so this is a programming error rather than a provider condition`,
          surface,
        }
      : {
          code: "SURFACE_REFUSED",
          excludedBecause,
          message: `${surface} is inventoried and deliberately never called: ${excludedBecause}`,
          surface,
        },
  transportFailed: ({ surface, cause }: { surface: string; cause: unknown }): DatadogTransportFailedError => ({
    cause,
    code: "TRANSPORT_FAILED",
    message: `${surface} did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
    surface,
  }),
  unauthorised: ({ surface }: { surface: string }): DatadogUnauthorisedError => ({
    code: "UNAUTHORISED",
    message: `${surface} answered 401: the API key or application key is not valid for this site. Check both with \`slopweaver datadog verify\``,
    surface,
  }),
  unexpectedShape: ({ surface, detail }: { surface: string; detail: string }): DatadogUnexpectedShapeError => ({
    code: "UNEXPECTED_SHAPE",
    detail,
    message: `${surface} answered with a shape this surface does not admit: ${detail}`,
    surface,
  }),
} as const;
