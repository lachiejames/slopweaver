/**
 * Whether GitHub Actions runs on a repository at all — read and switch off, on the write lane's context
 * (`./writeCtx.ts`). `../../outbound/github/repoActions.ts` builds that context itself rather than adding to
 * `./write.ts`, which sits at the file-size ratchet's cap (`src/devLint/fileSizeRatchet.ts`).
 *
 * Only OFF is offered here. Turning Actions back on spends hosted runner minutes on every push, which is the owner's
 * call alone, so the ON write lives in `./repoActionsPolicy.ts` behind `github repo --enable-actions`: it previews,
 * sends only on the preview's approved digest, and establishes a stated policy alongside the switch.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** A repository's Actions switch, as GitHub reports it. */
export interface RepoActionsState {
  /** Whether Actions may run workflows on this repository. */
  readonly enabled: boolean;
  /** Which actions may run when it is on (`all`, `local_only`, `selected`); `undefined` when GitHub sends none. */
  readonly allowedActions: string | undefined;
}

/**
 * Read whether Actions is on for a repository. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository to read
 * @returns the live switch
 */
export function getRepoActionsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<RepoActionsState, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.actions.getGithubActionsPermissionsRepository({ owner, repo });
      const { allowed_actions: allowedActions, enabled } = res.data;
      // The SDK's type is a promise, not a check: a body missing `enabled` must never read as switched off.
      if (typeof enabled !== "boolean") {
        throw new Error("GitHub's Actions permissions carried no boolean `enabled`, so the switch is unknown");
      }
      if (allowedActions === undefined) {
        return { allowedActions: undefined, enabled };
      }
      return { allowedActions, enabled };
    },
    operation: "github.actions.getGithubActionsPermissionsRepository",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Switch Actions off for a repository. Sent once; the caller confirms it with a separate read-back.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository to switch off
 * @returns nothing on GitHub's 204, else the typed provider failure — never proof the write did not land
 */
export function disableRepoActionsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<void, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.actions.setGithubActionsPermissionsRepository({ enabled: false, owner, repo });
    },
    operation: "github.actions.setGithubActionsPermissionsRepository",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
