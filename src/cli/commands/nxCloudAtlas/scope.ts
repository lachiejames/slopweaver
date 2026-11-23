/**
 * Resolving WHICH organisation and workspace a verb acts on, in one place both verbs share.
 *
 * ## Why the scope is a flag once and never again
 *
 * Nx Cloud's own organisation list is not a reliable way to discover it. MEASURED: an account
 * that reads a workspace, its runs and its analytics can still list ZERO organisations, because that list is
 * built from the VCS accounts a profile has linked rather than from membership. So the first run is TOLD the
 * pair, every later run reads it back out of the stored `workspace` entities, and the atlas raises the
 * roster mismatch as a gap rather than quietly discovering nothing.
 *
 * Both ids are in any `cloud.nx.app` pipeline URL's own page, and the workspace id is the `nxCloudId` a
 * repository's `nx.json` already carries — which is why asking for them once is a fair price rather than a
 * missing feature.
 */
import type { NxCloudAtlasPaths } from "../../../atlas/nxCloud/store.js";
import { storedNxCloudScopes } from "../../../atlas/nxCloud/sync.js";
import type { NxCloudScope } from "../../../atlas/nxCloud/webData.js";
import { err, ok, type Result } from "../../../lib/result.js";

/**
 * The scopes a verb should act on: the pair given on the command line, or every pair the store holds.
 *
 * @param paths the resolved atlas paths
 * @returns the scopes to act on, or why there are none
 */
export function resolveNxCloudScopes({
  paths,
  orgId,
  workspaceId,
}: {
  paths: NxCloudAtlasPaths;
  orgId: string | undefined;
  workspaceId: string | undefined;
}): Result<readonly NxCloudScope[]> {
  if (orgId !== undefined && workspaceId !== undefined) {
    return ok([{ orgId, workspaceId }]);
  }
  if (orgId !== undefined || workspaceId !== undefined) {
    return err(["--org and --workspace are given together or not at all: one without the other names nothing"]);
  }
  const stored = storedNxCloudScopes({ paths });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value.length === 0) {
    return err([
      "no Nx Cloud organisation and workspace to act on, and the stored generation holds none either",
      "pass --org <id> --workspace <id> once; later runs read the pair back out of the generation",
      "both ids are in any cloud.nx.app pipeline URL, and the workspace id is the `nxCloudId` in nx.json",
    ]);
  }
  return ok(stored.value);
}
