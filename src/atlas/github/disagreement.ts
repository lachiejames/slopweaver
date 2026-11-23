/**
 * Where GitHub's three surfaces disagree — the atlas's corroboration OUTPUT, which resolves nothing.
 *
 * The owner's ruling: a disagreement between surfaces is a thing the atlas SHOWS, never a thing it settles.
 * Code cannot always resolve a disagreement, because sometimes the vendor is simply like that — the
 * visibility over the gotcha IS the product, and a resolver that quietly preferred one surface would
 * destroy exactly the signal the second surface was added to produce. The owner reserves the question of which
 * surface wins until real instances are visible, so nothing here picks one.
 *
 * ## Two comparisons, and each is a different kind of unknown unknown
 *
 * **Declared but not exposed** — an operation GitHub's own published description declares that the
 * installed Octokit does not expose as a named method. MEASURED against
 * `@octokit/openapi-types` 27.0.0 and the endpoint table shipping beside it: 1,114 routes declared, 970
 * with a method, **144 without**. Those are reachable through `request()` and invisible to anyone reading
 * the client's own surface, which is exactly the "I didn't know that was there" failure the two-surface
 * rule exists for.
 *
 * **Called but not declared** — an endpoint GitHub's own web client asks for that its published
 * description does not declare at all. MEASURED the same day through this repository's transport, the
 * account settings pages alone called `/_filter/organizations`, `/_side-panels/user.json` and
 * `/in-product-messaging/*.json`, none of which appears in the description. A browser-observed call is
 * evidence GitHub HOLDS the data — never that an ordinary token may ask for it, which is what every
 * `web-request` row records in its own `callability` field.
 */
import type { GithubRestOperation, GithubWebRequest } from "./entities.js";

/** One disagreement between two of this atlas's surfaces. */
export interface GithubDisagreement {
  readonly kind: "declared-not-exposed" | "called-not-declared";
  /** The route or path shape the two surfaces disagree about. */
  readonly subject: string;
  /** What each surface says, in the order they are named in `surfaces`. */
  readonly surfaces: readonly string[];
  readonly detail: string;
}

/**
 * Every operation GitHub declares that the installed client does not expose as a named method.
 *
 * @param operations the stored `rest-operation` entities
 * @returns one disagreement per undeclared route, sorted by route
 */
export function declaredNotExposed({
  operations,
}: {
  operations: readonly GithubRestOperation[];
}): readonly GithubDisagreement[] {
  return operations
    .filter((operation) => operation.sdkMethod === null)
    .map((operation): GithubDisagreement => ({
      detail: `GitHub's published description declares ${operation.operationId}; the installed Octokit exposes no named method for it, so it is reachable only through request()`,
      kind: "declared-not-exposed",
      subject: `${operation.method} ${operation.pathTemplate}`,
      surfaces: ["rest-openapi", "rest-live"],
    }))
    .toSorted((left, right) => left.subject.localeCompare(right.subject));
}

/**
 * Every endpoint GitHub's own web client called that its published description does not declare.
 *
 * @param requests the stored `web-request` entities
 * @returns one disagreement per undeclared endpoint, sorted by path shape
 */
export function calledNotDeclared({
  requests,
}: {
  requests: readonly GithubWebRequest[];
}): readonly GithubDisagreement[] {
  return requests
    .filter((request) => !request.declaredInOpenApi)
    .map((request): GithubDisagreement => ({
      detail: `the first-party web client calls this on ${String(request.observedOnPages.length)} page(s) and GitHub's published description declares no matching operation; it returned ${String(request.responseFieldPaths.length)} distinct response field path(s)`,
      kind: "called-not-declared",
      subject: `${request.method} ${request.pathShape}`,
      surfaces: ["github-web", "rest-openapi"],
    }))
    .toSorted((left, right) => left.subject.localeCompare(right.subject));
}

/**
 * A one-line tally of what the two comparisons found.
 *
 * @param disagreements every disagreement found
 * @returns the summary line
 */
export function summariseDisagreements({ disagreements }: { disagreements: readonly GithubDisagreement[] }): string {
  const declared = disagreements.filter((entry) => entry.kind === "declared-not-exposed").length;
  const called = disagreements.filter((entry) => entry.kind === "called-not-declared").length;
  return `${String(declared)} operation(s) GitHub declares and the installed client does not expose; ${String(called)} endpoint(s) its own web client calls and its description does not declare`;
}
