/**
 * What "production" means in a Datadog query — a CONFIGURABLE set of `env` tag values, not a single one.
 *
 * A team running more than one deployment often has more than one live spelling of "production" — a
 * historical migration between env-tag conventions, a multi-region rollout that never converged on one
 * value, or simply two teams that named it differently before anyone noticed. Filtering on a single value
 * silently drops whichever traffic uses the other spelling, and it drops it as an empty-ish result rather
 * than an error, so the query looks like it worked.
 *
 * {@link DEFAULT_PROD_ENVS} is this package's own default set. A caller with a different convention passes
 * its own `prodEnvs` to every function here rather than editing this file — that is the whole point of
 * making it a parameter: the mechanism (derive a filter fragment from a list, and never apply it silently)
 * is generic, and only the list of values is a per-installation fact.
 *
 * ## The one thing this module deliberately does NOT do
 *
 * **It is never applied by default.** A meaningful share of telemetry in a real estate typically carries no
 * `env` tag at all, so ANY env-scoped query silently excludes it. That makes an implicit env filter a hidden
 * narrowing of every result, which is why the filter is offered as an explicit opt-in and never folded into
 * a query builder by default.
 *
 * Verifying that the matched events really are prod is a separate job, and it is a real one: a string
 * filter is not a hard scope, so an event whose env tag is unindexed or absent can slip past it. That guard
 * lives in `envFacetGuard.ts`, which re-checks the actual `env` facet of the matched events.
 * {@link isProdEnv} is the predicate the two share, so the filter and the guard cannot disagree about what
 * "prod" means.
 */

/**
 * This package's default env tag values that count as production. A caller with a different convention
 * passes its own `prodEnvs` to every function below instead of editing this constant.
 */
export const DEFAULT_PROD_ENVS = ["prod", "production"] as const;

/**
 * The Logs Search prod env filter fragment, derived from `prodEnvs` so the filter and the list can never
 * drift apart.
 *
 * @param prodEnvs the env tag values that count as production; defaults to {@link DEFAULT_PROD_ENVS}
 * @returns the query fragment, e.g. `env:(prod OR production)`
 */
export function prodEnvFilter({ prodEnvs = DEFAULT_PROD_ENVS }: { prodEnvs?: readonly string[] } = {}): string {
  return `env:(${prodEnvs.join(" OR ")})`;
}

/**
 * The prod env filter for a metrics tag scope (`{...}`), rather than a Logs Search query. Datadog's two
 * grammars write the same OR differently — a metrics tag scope has no `field:(a OR b)` shorthand — so this
 * is a second fragment derived from `prodEnvs` rather than a second place the env list is typed out.
 *
 * @param prodEnvs the env tag values that count as production; defaults to {@link DEFAULT_PROD_ENVS}
 * @returns the tag-scope fragment, e.g. `(env:prod OR env:production)`
 */
export function prodMetricEnvFilter({ prodEnvs = DEFAULT_PROD_ENVS }: { prodEnvs?: readonly string[] } = {}): string {
  return `(${prodEnvs.map((env) => `env:${env}`).join(" OR ")})`;
}

/**
 * Whether an env tag value counts as production.
 *
 * Case-insensitive and trimmed, because this reads a facet value that came back from Datadog rather than a
 * literal somebody typed — and a bucket key arrives however the emitting service spelled it.
 *
 * @param env the env tag value from a matched event's facet
 * @param prodEnvs the env tag values that count as production; defaults to {@link DEFAULT_PROD_ENVS}
 * @returns true when the value is one of `prodEnvs`
 */
export function isProdEnv({
  env,
  prodEnvs = DEFAULT_PROD_ENVS,
}: {
  env: string;
  prodEnvs?: readonly string[];
}): boolean {
  const normalised = env.trim().toLowerCase();
  return prodEnvs.some((candidate) => candidate.toLowerCase() === normalised);
}
