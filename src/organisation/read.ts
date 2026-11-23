/**
 * THE one read of the organisation. A reader that takes it calls this once at its effectful edge and passes the
 * value down; nothing reads the row any other way, and nothing caches it.
 *
 * No cache, deliberately, and the opposite call from the profile context's (`../context/cache.ts`): a profile
 * delivered stale is better than none at session start, while an organisation read stale places work under the
 * wrong company with full confidence. A reader that cannot reach the store refuses with `ORG_QUERY_FAILED`, which is
 * a different sentence from `ORG_NOT_CONFIGURED`.
 *
 * The self repository is DERIVED here, never stored: this build's own checkout's `origin`, resolved exactly as
 * `../cli/commands/github/findingRulingGate.ts` resolves "the repository this build lives in". So it follows the
 * repository wherever it moves, and a clone at another company names its own.
 */
import { resolveRepository } from "../config.js";
import { installedTreeRoot } from "../lib/pluginRoot.js";
import { err, ok, type Result } from "../lib/result.js";
import { connectStore } from "../store/client.js";

import type { Organisation } from "./core.js";
import { type OrganisationError, OrganisationErrors } from "./errors.js";
import { closeAfterAnswer, readStoredOrganisation, type StoredOrganisation } from "./store.js";

/**
 * The organisation a reader takes, out of the stored row and the derived self repository. Pure.
 *
 * @param stored the validated row
 * @param selfRepository this build's own `owner/repo`, lowercased
 * @returns the organisation
 */
export function organisationOf({
  stored,
  selfRepository,
}: {
  stored: StoredOrganisation;
  selfRepository: string;
}): Organisation {
  return {
    ...stored.record,
    revision: stored.revision,
    selfRepository,
    updatedAtIso: stored.updatedAtIso,
  };
}

/**
 * This build's own repository, `owner/repo` lowercased, off the `origin` of the tree it lives in.
 *
 * @param home the Slopweaver home whose declared main checkouts the resolution is judged against
 * @returns the slug, or `SELF_REPOSITORY_UNRESOLVED` naming why
 */
export function resolveSelfRepository({ home }: { home: string }): Result<string, OrganisationError> {
  const mine = resolveRepository({ cwd: installedTreeRoot({ importMetaUrl: import.meta.url }), home });
  if (mine.isErr()) {
    return err(OrganisationErrors.selfUnresolved({ reasons: mine.error }));
  }
  return ok(`${mine.value.owner}/${mine.value.repo}`.toLowerCase());
}

/**
 * Read the organisation from the store, with the self repository derived beside it.
 *
 * @param home the Slopweaver home the store selection is read under
 * @returns the organisation, or `ORG_NOT_CONFIGURED` naming what is missing and `slopweaver org set`, or the typed
 *   refusal for an unreachable store, an unreadable row or an unresolvable self repository
 */
export async function readOrganisation({ home }: { home: string }): Promise<Result<Organisation, OrganisationError>> {
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return err(OrganisationErrors.queryFailed({ cause: opened.error }));
  }
  let stored: Result<StoredOrganisation, OrganisationError>;
  try {
    stored = await readStoredOrganisation({ client: opened.value });
  } finally {
    await closeAfterAnswer({ client: opened.value });
  }
  if (stored.isErr()) {
    return err(stored.error);
  }
  const self = resolveSelfRepository({ home });
  if (self.isErr()) {
    return err(self.error);
  }
  return ok(organisationOf({ selfRepository: self.value, stored: stored.value }));
}
