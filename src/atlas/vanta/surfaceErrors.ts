/**
 * Why a sync could not read one Vanta Manage API surface, graded into the gap vocabulary while the failure
 * was still TYPED.
 *
 * A union of its own per `.claude/rules/error-handling.md`, and the only error the sync-facing half of the
 * client (`client.ts`'s `VantaAtlasSyncClient`) fails with. Each variant carries the lines the failure prints
 * — already redacted by the client — and a `code` chosen from the failure's own typed code: a refused
 * status from `HTTP_STATUS`, a pagination fault from the walk's own codes, a schema fault from the parser's.
 * `syncKind.ts` reads the code; nothing reads the lines but a human.
 *
 * Before this existed the gap was chosen by searching the joined lines for phrases this repository wrote
 * itself — `"HTTP 401"`, `"cursor"`, `"cannot read"` — so rewording one sentence silently re-graded every
 * gap it produced, and a provider id that happened to contain one of those words graded a failure it had
 * nothing to do with.
 *
 * Pure: values in, values out.
 */
import type { VantaGapCondition } from "./gaps.js";
import { isVantaHttpError, type VantaHttpError, type VantaTransportFailure } from "./httpErrors.js";

/** One graded failure: its code, its lines, and the lines joined as one sentence. */
interface Graded<C extends string> {
  readonly code: C;
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every grade a sync surface failure can carry — one per manage-api gap condition a read can open. */
export type VantaSurfaceError =
  | Graded<"API_CREDENTIAL_NOT_CONFIGURED">
  | Graded<"API_SCOPE_REFUSED">
  | Graded<"PAGINATION_INCOMPLETE">
  | Graded<"SCHEMA_DRIFT">
  | Graded<"DETAIL_UNREADABLE">;

/** The closed set of grades. */
type VantaSurfaceErrorCode = VantaSurfaceError["code"];

/**
 * The grades in the order a failure carrying several is graded by: the most specific explanation wins, and
 * an ungraded failure is `DETAIL_UNREADABLE`. The same order the gap was chosen in before it had a type.
 */
const GRADE_PRIORITY: readonly Exclude<VantaSurfaceErrorCode, "DETAIL_UNREADABLE">[] = [
  "API_CREDENTIAL_NOT_CONFIGURED",
  "API_SCOPE_REFUSED",
  "PAGINATION_INCOMPLETE",
  "SCHEMA_DRIFT",
];

/** The one builder every factory goes through, so a variant's message cannot drift from its lines. */
function graded({ code, reasons }: { code: VantaSurfaceErrorCode; reasons: readonly string[] }): VantaSurfaceError {
  return { code, message: reasons.join("; "), reasons };
}

/**
 * The grade one typed HTTP failure earns. Exhaustive: a new transport, walk or parser code fails to compile
 * here until someone decides what gap it opens.
 */
function httpErrorGrade({ error }: { error: VantaHttpError }): VantaSurfaceErrorCode {
  switch (error.code) {
    case "HTTP_STATUS": {
      if (error.status === 401 || error.status === 403) {
        return "API_SCOPE_REFUSED";
      }
      return "DETAIL_UNREADABLE";
    }
    case "CURSOR_MISSING":
    case "CURSOR_REPEATED":
    case "PAGE_LIMIT_EXCEEDED":
    case "DUPLICATE_PROVIDER_ID":
      return "PAGINATION_INCOMPLETE";
    case "BODY_NOT_JSON":
    case "PAGE_UNREADABLE":
    case "OBJECT_UNREADABLE":
    case "BODY_UNREADABLE":
      return "SCHEMA_DRIFT";
    case "REDIRECT_REFUSED":
    case "BODY_UNREAD":
    case "UNREACHABLE":
    case "RETRIES_EXHAUSTED":
    case "SAMPLE_LIMIT_INVALID":
    case "NOT_CENSUS_FAMILY":
    case "NOT_CHILD_SURFACE":
      return "DETAIL_UNREADABLE";
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * The grade a manage-api gap condition corresponds to; a condition no read opens grades as unreadable.
 * Exhaustive: a new gap condition fails to compile here until someone decides what grade it inherits as.
 */
function conditionGrade({ condition }: { condition: VantaGapCondition }): VantaSurfaceErrorCode {
  switch (condition) {
    case "api-credential-not-configured":
      return "API_CREDENTIAL_NOT_CONFIGURED";
    case "api-scope-refused":
      return "API_SCOPE_REFUSED";
    case "pagination-incomplete":
      return "PAGINATION_INCOMPLETE";
    case "schema-drift":
      return "SCHEMA_DRIFT";
    case "api-browser-disagreement":
    case "api-config-invalid":
    case "artifact-integrity-failed":
    case "browser-content-download-unreadable":
    case "browser-surface-unreadable":
    case "child-surface-unsupported-for-parent":
    case "content-download-unreadable":
    case "deep-link-unverified":
    case "detail-unreadable":
    case "openapi-drift":
    case "openapi-inventory-unreadable":
    case "outside-planned-scope":
    case "sso-redirect-host-unallowlisted":
    case "stable-identity-unverified":
      return "DETAIL_UNREADABLE";
    default: {
      const unhandled: never = condition;
      return unhandled;
    }
  }
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VantaSurfaceErrors = {
  /** No credentials are configured at all, so no surface was asked anything. */
  apiCredentialNotConfigured: ({ reasons }: { reasons: readonly string[] }): VantaSurfaceError =>
    graded({ code: "API_CREDENTIAL_NOT_CONFIGURED", reasons }),
  /** A failure with no more specific explanation. */
  detailUnreadable: ({ reasons }: { reasons: readonly string[] }): VantaSurfaceError =>
    graded({ code: "DETAIL_UNREADABLE", reasons }),
  /**
   * A transport, token or walk failure, graded from its typed arm's code. The printed-only lines arm — a
   * policy refusal or a held mint lock — carries no HTTP fact, so it grades as unreadable.
   *
   * `reasons` is passed rather than rendered here because the client renders AND redacts them first.
   */
  fromTransportFailure: ({
    failure,
    reasons,
  }: {
    failure: VantaTransportFailure;
    reasons: readonly string[];
  }): VantaSurfaceError => {
    if (!isVantaHttpError(failure)) {
      return graded({ code: "DETAIL_UNREADABLE", reasons });
    }
    return graded({ code: httpErrorGrade({ error: failure }), reasons });
  },
  /**
   * A failure inherited from the gaps another kind already opened — a child fan-out over a parent that did
   * not read — graded as the most specific of them.
   */
  inheritedFrom: ({
    conditions,
    reasons,
  }: {
    conditions: readonly VantaGapCondition[];
    reasons: readonly string[];
  }): VantaSurfaceError => {
    const grades = new Set(conditions.map((condition) => conditionGrade({ condition })));
    const strongest = GRADE_PRIORITY.find((grade) => grades.has(grade));
    if (strongest === undefined) {
      return graded({ code: "DETAIL_UNREADABLE", reasons });
    }
    return graded({ code: strongest, reasons });
  },
  /** The same grade as an upstream failure, carrying different lines — a fan-out naming the parent it failed on. */
  regraded: ({ upstream, reasons }: { upstream: VantaSurfaceError; reasons: readonly string[] }): VantaSurfaceError =>
    graded({ code: upstream.code, reasons }),
} as const;

/**
 * The gap condition a surface failure opens. Exhaustive over the union, so a new grade fails to compile here
 * until it names its condition.
 *
 * @returns the condition `syncKind.ts` opens the gap with
 */
export function vantaSurfaceCondition({ error }: { error: VantaSurfaceError }): VantaGapCondition {
  switch (error.code) {
    case "API_CREDENTIAL_NOT_CONFIGURED":
      return "api-credential-not-configured";
    case "API_SCOPE_REFUSED":
      return "api-scope-refused";
    case "PAGINATION_INCOMPLETE":
      return "pagination-incomplete";
    case "SCHEMA_DRIFT":
      return "schema-drift";
    case "DETAIL_UNREADABLE":
      return "detail-unreadable";
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}
