/**
 * `cmux spawn`'s refusal to open a row inside a worktree ANOTHER row holds — the shell around
 * `../../../cmux/treeOccupancy.ts`, run beside the base preflight and before admission, so a refused spawn takes no
 * admission, cuts no tree and opens no tab.
 *
 * Only a REUSED tree is asked about: a tree the spawn creates is new, so nothing can hold it. The verdict keeps a
 * row's own reseat exactly as it was — a parked or crashed seat's row reopens the tree its own journal names — and
 * refuses only a different row's spawn there, naming the holding row and the tree, never cutting a second tree in
 * silence: the row declared that branch for a reason, and which tree it should have is a question for whoever
 * registered it.
 */

import type { SpawnPlan } from "../../../cmux/plan.js";
import { scanTreeHolders } from "../../../cmux/treeHolderScan.js";
import { foreignHolderDetail, treeOccupancy } from "../../../cmux/treeOccupancy.js";
import { listWorktrees } from "../../../cmux/worktree.js";
import { slopweaverHome } from "../../../config.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { stateHomePaths } from "../../../stateHome.js";

/** The variable that waives this refusal — the `foreign-worktree-holder` row in `../../../hatch/registry.ts`. */
const ALLOW_FOREIGN_WORKTREE_HOLDER_ENV = "SLOPWEAVER_ALLOW_FOREIGN_WORKTREE_HOLDER";

/**
 * The refusal for a spawn whose reused tree another row holds, or `undefined` when it may open there.
 *
 * @param plan the decided plan: its slug, the tree it reuses and whether that tree already exists
 * @param home the `--home` the spawn reads its state from, or `undefined` for the ambient one
 * @param env the environment the hatch is read from
 * @returns the four-line refusal, or `undefined` to proceed
 */
export function foreignTreeRefusal({
  env,
  home,
  plan,
}: {
  env: NodeJS.ProcessEnv;
  home: string | undefined;
  plan: Pick<SpawnPlan, "cwd" | "repoRoot" | "slug" | "worktreeExists">;
}): string | undefined {
  if (!plan.worktreeExists || env[ALLOW_FOREIGN_WORKTREE_HOLDER_ENV] === "1") {
    return undefined;
  }
  let stateHome = slopweaverHome();
  if (home !== undefined) {
    stateHome = home;
  }
  const worktrees = listWorktrees({ repoRoot: plan.cwd }).map((worktree) => worktree.path);
  const { holders } = scanTreeHolders({ runsDir: stateHomePaths({ home: stateHome }).runs, tree: plan.cwd });
  const verdict = treeOccupancy({
    holders,
    // git lists the main checkout first; the plan's repoRoot is the doc's own spelling of it.
    mainCheckouts: [plan.repoRoot, ...worktrees.slice(0, 1)],
    slug: plan.slug,
    tree: plan.cwd,
    worktrees,
  });
  if (verdict.kind !== "foreign") {
    return undefined;
  }
  return hatchRefusal({
    detail: foreignHolderDetail({ holder: verdict.holder, slug: plan.slug, tree: plan.cwd }),
    hatch: hatchFor({ id: "foreign-worktree-holder" }),
  });
}
