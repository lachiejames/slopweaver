/**
 * What `atlas jumpcloud sync` runs on in production — split out of `sync.ts`, which takes these as injected
 * dependencies so a test needs no network and no clock.
 *
 * A leaf: it imports nothing from `sync.ts`. So `JumpcloudSyncDeps` is declared here rather than there, and
 * `sync.ts` imports it.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { productionJumpcloudFetch } from "./client.js";
import { resolveJumpcloudCredentials } from "./credentials.js";
import { admitJumpcloudPage } from "./responseRegistry.js";
import type { JumpcloudWalkDeps } from "./syncEngine.js";

/**
 * Everything the sync needs, injected so a test needs no network and no clock: the walk's own dependencies, less the
 * atlas directory the sync derives from its home.
 */
export type JumpcloudSyncDeps = Omit<JumpcloudWalkDeps, "directory">;

/**
 * Build the production dependencies from the environment and the secrets store.
 *
 * @param env the process environment
 * @param home the resolved state home
 * @param progress where a progress line goes
 * @returns the dependencies, or why the credential could not be resolved
 */
export function productionJumpcloudSyncDeps({
  env,
  home,
  progress,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  progress: (line: string) => void;
}): Result<JumpcloudSyncDeps> {
  const credentials = resolveJumpcloudCredentials({ env, home });
  if (credentials.isErr()) {
    return err(credentials.error);
  }
  return ok({
    admit: admitJumpcloudPage,
    client: {
      apiKey: credentials.value.apiKey,
      fetch: productionJumpcloudFetch(),
      orgId: credentials.value.orgId,
    },
    now: () => new Date().toISOString(),
    progress,
  });
}
