/**
 * The repository-resolution edge every `github` verb that takes `--repo` and `--home` injects.
 *
 * It was spelled out identically inside each verb's own production deps until `duplicate-windows` caught
 * `ci-runs` and `run-log` sharing the whole block verbatim. One copy, because the rule it encodes is one
 * decision: an explicit slug is parsed as given, and its absence means "the checkout I am standing in".
 */

import { parseRepositorySlug, type Repository, resolveRepository } from "../../../config.js";
import type { Result } from "../../../lib/result.js";

/**
 * Resolve the repository a verb should act on.
 *
 * @param explicit the `--repo owner/name` a caller passed, or undefined
 * @param home the Slopweaver state home a caller passed, which scopes the git checkout lookup
 * @returns the resolved repository, or why neither source named one
 */
export function resolveRepoEdge({
  explicit,
  home,
}: {
  explicit: string | undefined;
  home: string | undefined;
}): Result<Repository> {
  if (explicit !== undefined) {
    return parseRepositorySlug({ slug: explicit });
  }
  return resolveRepository(home === undefined ? {} : { home });
}
