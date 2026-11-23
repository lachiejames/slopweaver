/**
 * Which red checks hold a landing and which do not — the one rule `github landing`'s `ci-green` test and
 * `github enqueue`'s CI finding both judge an ADVISORY red by, so the read that selects a press and the verb that
 * performs it can never disagree about it.
 *
 * A merge queue gates on the base branch's REQUIRED contexts and nothing else, so a red advisory check is not a
 * reason GitHub holds a pull request — and it was not a reason the fleet should either. MEASURED: a pull request in
 * `acme/acme-admin` sat approved, mergeable and green on every context `staging` requires until the owner
 * pressed 'Merge when ready' by hand, while every landing reading in
 * between classed it `spawn-ci` over three red `Advisory local browser E2E` lanes. Reproduce with
 * `jq '.rows[] | select(.number==<pr>) | [.action, .ciFailure, .failingChecks[].required]'` over the
 * `$SLOPWEAVER_HOME/readings/github-landing/*.json` readings taken while it sat.
 *
 * Pure. No I/O.
 */

/**
 * The check on this repository whose subject is the pull-request DESCRIPTION.
 *
 * `dev-gate` is the job that runs `pr-format`, so it is the one red check a rewritten body can turn green.
 * Named as a constant because two modules compare against it and a typo in either would read as "no bump is
 * ever body-fixable" — the silent half of the failure.
 */
export const DEV_GATE_CHECK = "dev-gate";

/**
 * Checks that hold a landing although no branch protection can REQUIRE them.
 *
 * `lachiejames/slopweaver`'s `main` can only require `build` and `integration`
 * (`skills/github/reference/merge-queue.md`), while `dev-gate` is the pull-request body and proof gate rule 1
 * lands on. Read by its requirement alone it would be advisory, and an advisory red is now pressed over — so it
 * is named here as blocking, whatever the required set says.
 */
const GATING_UNREQUIRED_CHECKS: ReadonlySet<string> = new Set([DEV_GATE_CHECK]);

/**
 * Whether a check holds a landing although the base branch does not require it.
 *
 * @param name the check's name as GitHub reports it
 * @returns true for a check in the gating-but-unrequirable set
 */
export function isGatingUnrequired({ name }: { name: string }): boolean {
  return GATING_UNREQUIRED_CHECKS.has(name);
}

/**
 * The names of every non-passing check when the red is PROVEN advisory, or undefined when it is not.
 *
 * Proven means all four: the base requires at least one context (a base requiring nothing would make every red
 * read advisory), the checks page was read whole (a capped page can only LOSE a failing required context), at
 * least one check is not passing, and none of those is required or {@link isGatingUnrequired}. A required
 * context that is still RUNNING is non-passing and in the required set, so it is never advisory here.
 *
 * @param checks the head's latest-per-name checks, each with its state
 * @param requiredContexts the status-check contexts the base branch requires
 * @param truncated whether the checks page was capped
 * @returns the advisory checks' names, or undefined when the red is not proven advisory
 */
export function advisoryOnlyNames({
  checks,
  requiredContexts,
  truncated,
}: {
  checks: readonly { readonly name: string; readonly state: string }[];
  requiredContexts: readonly string[];
  truncated: boolean;
}): readonly string[] | undefined {
  if (requiredContexts.length === 0 || truncated) {
    return undefined;
  }
  const notPassing = checks.filter((check) => check.state !== "passed");
  if (notPassing.length === 0) {
    return undefined;
  }
  const blocking = notPassing.some(
    (check) => requiredContexts.includes(check.name) || isGatingUnrequired({ name: check.name }),
  );
  return blocking ? undefined : notPassing.map((check) => check.name);
}
