/**
 * The GitHub repositories the owner DECLARED — every `mainCheckouts` entry in `profile.json`, each resolved through its
 * own `origin` remote.
 *
 * One reader for every leg that must cover all of the owner's repositories rather than the checkout the process happens
 * to run in: session-start's GitHub leg and the landing reading a corpus resync takes afterwards. Measured on the owner's
 * data, 33 of their 35 open pull requests were in the repository a cwd default would not have read,
 * so a checkout whose remote will not resolve is RETURNED, never dropped in silence.
 */
import { resolveRepository } from "../../config.js";
import { mainCheckoutsFromProfile } from "../../profileStore.js";

/** What one read of the declared checkouts found. */
export interface DeclaredRepositories {
  /** `owner/name` slugs, in declaration order, each once. */
  readonly slugs: readonly string[];
  /** Every declared checkout path whose `origin` remote could not be resolved. */
  readonly unresolved: readonly string[];
}

/**
 * Resolve every declared main checkout to its `owner/name` slug.
 *
 * @param home the state home holding `profile.json`
 * @returns the slugs and the checkouts that would not resolve
 */
export function readDeclaredRepositories({ home }: { readonly home: string }): DeclaredRepositories {
  const unresolved: string[] = [];
  const slugs: string[] = [];
  for (const checkout of mainCheckoutsFromProfile({ home })) {
    const resolved = resolveRepository({ cwd: checkout.path, home });
    if (resolved.isErr()) {
      unresolved.push(checkout.path);
      continue;
    }
    const slug = `${resolved.value.owner}/${resolved.value.repo}`;
    if (!slugs.includes(slug)) {
      slugs.push(slug);
    }
  }
  return { slugs, unresolved };
}
