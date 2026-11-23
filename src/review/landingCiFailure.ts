/**
 * Whether a red build is red on a check the base REQUIRES, on advisory checks only, or on something this read
 * cannot classify — the three answers a landing row carries as `ciFailure`.
 *
 * MEASURED over the owner's 31 open `acme/acme-admin` pull requests
 * (`slopweaver github landing --repo acme/acme-admin --author @me --include-drafts --json`, counting rows
 * whose `ci` is `red` against their `failingChecks[].required`): 7 rows read `ci: red` where every failing
 * check carried `required: false` — "Advisory local browser E2E (<lane>)" and its siblings — and each one
 * printed as a build to fix while a code owner was what actually held it. `ci` alone is a rollup word and
 * cannot say which kind of red it is, so the classification rides beside it rather than overloading it.
 *
 * **Unknown is its own answer and is never advisory.** `FailingCheckDetail.required` is three-valued on
 * purpose (`./prStateDetail.ts`): `undefined` means the base's required set was not read. So an `undefined`
 * among the failures, an EMPTY failure list on a red rollup (where `every` is vacuously true), a checks page
 * that was not read or was truncated (a capped page can only LOSE a failing context, which could be the
 * required one), a required set that was unreadable or had a context still unproven, and a base that requires
 * NOTHING (where every red would otherwise read advisory) all read `required: undefined`. A `required: true`
 * anywhere wins over every one of those, because one known required failure is enough to say the red blocks.
 *
 * **`required: false` is what lets a red through to a press** — `./landingTests.ts`'s `ci-green` passes it, the
 * way GitHub's merge queue does. So a check that HOLDS a landing although no branch protection can require it
 * (`./gatingChecks.ts`, slopweaver's `dev-gate`) reads `required: true` here: blocking is what this field
 * answers for a landing, and an unrequirable gate is not advisory.
 *
 * Pure. No I/O.
 */

import { isGatingUnrequired } from "./gatingChecks.js";
import type { PrReviewState } from "./reviewState.js";

/**
 * A landing row's red build, classified.
 *
 * `required` is `true` when at least one failing check is known to be required, `false` when every failing
 * check is known to be advisory, and `undefined` when the read cannot tell — see this module's header for
 * every shape that lands there.
 */
export type LandingCiFailure =
  { readonly kind: "not-red" } | { readonly kind: "red"; readonly required: boolean | undefined };

/**
 * Classify one pull request's red build as required, advisory or unknown.
 *
 * @param state the fields of the pull request's answers the classification rests on — the rollup word, the
 *   failing checks, whether the checks page was read whole, and what the base branch requires
 * @returns `not-red` when the rollup is not red, otherwise the red with its requirement classified
 */
export function landingCiFailure({
  state,
}: {
  state: Pick<PrReviewState, "ci" | "failingChecks" | "checksRead" | "checksTruncated" | "requiredContexts">;
}): LandingCiFailure {
  if (state.ci !== "red") {
    return { kind: "not-red" };
  }
  if (state.failingChecks.some((check) => check.required === true || isGatingUnrequired({ name: check.name }))) {
    return { kind: "red", required: true };
  }
  const gate = state.requiredContexts;
  if (gate.kind === "read" && gate.missing.length > 0) {
    return { kind: "red", required: true };
  }
  const wholeRead =
    state.checksRead.kind === "read" &&
    !state.checksTruncated &&
    gate.kind === "read" &&
    gate.unproven.length === 0 &&
    gate.required.length > 0;
  const allAdvisory = state.failingChecks.length > 0 && state.failingChecks.every((check) => check.required === false);
  if (wholeRead && allAdvisory) {
    return { kind: "red", required: false };
  }
  return { kind: "red", required: undefined };
}
