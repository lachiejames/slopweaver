/**
 * How the GitHub atlas grades a refused read: whether the call expected it, whether GitHub's 404 was really a
 * permission refusal, and whether a kind is dark for permissions alone and so earns `permissionBlocked`.
 *
 * Separate from `sync.ts` because this is the one judgement the publish gate turns on — a kind stamped here is
 * exempt from `atlas/kit/mandatoryKinds.ts`, so a wrong grade either publishes a defect as a boundary or
 * refuses a healthy atlas for a boundary it had already named.
 */
import type { AtlasPermissionBlock } from "../kit/permissionBlock.js";
import { type GithubAtlasError, GithubAtlasErrors } from "./errors.js";
import type { GithubCall } from "./inventoryShape.js";
import type { GithubKind } from "./model.js";

/**
 * One failed call, carrying the typed code the display reason has already flattened away.
 *
 * `GithubSyncSummary.failures` still exposes only `route`/`reason` of the UNEXPECTED ones — the extra fields
 * are for the sync's own per-kind judgement, and widening the summary would change a value several suites
 * compare.
 */
export interface GithubKindFailure {
  readonly code: GithubAtlasError["code"];
  /** Whether the call declares this refusal — an honest boundary rather than a failure a reader must see. */
  readonly expected: boolean;
  readonly kind: GithubKind;
  readonly reason: string;
  readonly route: string;
}

/** How many refused routes a permission block names before it counts the rest. */
const PERMISSION_DETAIL_ROUTES = 3;

/**
 * Whether a failure is one this call expects rather than one worth alarming about.
 *
 * @param call the admitted call
 * @param error the typed failure
 * @returns whether the failure is an expected boundary
 */
export function isExpectedRefusal({ call, error }: { call: GithubCall; error: GithubAtlasError }): boolean {
  if (error.code === "SCOPE_REFUSED") {
    return call.expectedRefusals.includes(403);
  }
  return error.code === "ROUTE_ABSENT" && call.expectedRefusals.includes(404);
}

/**
 * A failure as this call means it: GitHub's 404 on a route declared `notFoundWhenUnpermitted` is a
 * permission refusal, and every other failure is left exactly as the client classified it.
 *
 * @param call the admitted call
 * @param error the client's classification
 * @param route the concrete route, so the refusal names it
 * @returns the failure to grade
 */
export function permissionGraded({
  call,
  error,
  route,
}: {
  call: GithubCall;
  error: GithubAtlasError;
  route: string;
}): GithubAtlasError {
  if (error.code === "ROUTE_ABSENT" && call.notFoundWhenUnpermitted === true) {
    return GithubAtlasErrors.hiddenAsNotFound({ route });
  }
  return error;
}

/**
 * Whether one kind is dark for PERMISSIONS alone this run, and what would lift that.
 *
 * Every UNEXPECTED failure recorded against the kind has to be `SCOPE_REFUSED`, and at least one refusal —
 * expected or not — has to be one. A kind refused on one route and broken on another is a boundary AND a
 * defect, and stamping it as the first would exempt it from the kit's publish gate
 * (`atlas/kit/mandatoryKinds.ts`) on the strength of a failure a later run could clear. See
 * `atlas/kit/permissionBlock.ts` for the owner ruling that made this a field rather than prose.
 *
 * An EXPECTED permission refusal counts: a 403 the call declares is still
 * a surface this token may not see, and leaving it unstamped would leave the kind reading as a plain failure to
 * `summary.uncovered`, so the sync would exit 1 under any non-owner token for a boundary it had already named.
 * An expected refusal of any OTHER code — a 404 for a feature that is simply off — is an honest absence
 * rather than a permission boundary, so it neither counts towards nor spoils the stamp.
 *
 * @param at this run's ISO timestamp
 * @param failures this kind's own failures, expected ones included
 * @param kind the kind being stamped
 * @returns the field to spread into the status, empty when this is not purely a permission boundary
 */
export function permissionBlockedField({
  at,
  failures,
  kind,
}: {
  at: string;
  failures: readonly GithubKindFailure[];
  kind: GithubKind;
}): { readonly permissionBlocked?: AtlasPermissionBlock } {
  const judged = failures.filter(
    (failure) => failure.kind === kind && (!failure.expected || failure.code === "SCOPE_REFUSED"),
  );
  if (judged.length === 0 || !judged.every((failure) => failure.code === "SCOPE_REFUSED")) {
    return {};
  }
  // Bounded, because `kindReason` prints `detail` inside one sentence and a refusal per repository would
  // make that sentence as long as the organisation is wide.
  const shown = judged.slice(0, PERMISSION_DETAIL_ROUTES).map((failure) => failure.reason);
  const more = judged.length - shown.length;
  return {
    permissionBlocked: {
      at,
      detail: more > 0 ? `${shown.join("; ")}; and ${String(more)} more route(s) refused alike` : shown.join("; "),
      unblockedBy:
        "a GitHub credential holding the permission GitHub named, the repository admin or organisation owner" +
        " role on an admin-gated route, or the SSO authorisation for this organisation — the data exists and" +
        " this token may not see it",
    },
  };
}
