/**
 * `session close-done`'s trash pass: SETTLE the declared checkouts' reclaim trash — put an orphaned batch back
 * into the tree git kept — and delete nothing, then say in one line what waits for the prune.
 *
 * Deleting one batch per sweep under a 45-second budget cannot work. One batch is a seat's whole
 * `node_modules`, which that budget could not finish, so a sweep would start a delete it then cut short and the
 * trash would grow by a batch per closed seat: measured, 325 batches stood in slopweaver's trash
 * (`find <repo>/.claude/worktrees.noindex/.reclaim-trash -mindepth 1 -maxdepth 1 | wc -l`). The delete is now
 * `worktree prune --apply`'s, in its tail, with no batch limit and a window of its own
 * (`../worktree/pruneApplyPass.ts`), so it runs at least hourly through the standing row.
 */
import { mainCheckoutsFromProfile } from "../../../profileStore.js";
import { reclaimTrashDir, settleReclaimTrash, type TrashSettled } from "../../../worktree/reclaimTrash.js";

/**
 * Settle every declared checkout's reclaim trash, deleting nothing.
 *
 * @param home the state home whose profile declares the main checkouts
 * @returns how many batches went back into their tree and how many wait for the prune to delete
 */
export function settleCheckoutTrash({ home }: { readonly home: string }): TrashSettled {
  return settleReclaimTrash({
    roots: mainCheckoutsFromProfile({ home }).map((config) => reclaimTrashDir({ repoRoot: config.path })),
  });
}

/**
 * The trash pass as one line, or `undefined` when the trash is empty.
 *
 * @param trash what the settle restored and left waiting
 * @returns the line to print
 */
export function renderTrash({ trash }: { readonly trash: TrashSettled }): string | undefined {
  if (trash.waiting === 0 && trash.restored === 0) {
    return undefined;
  }
  let restored = "";
  if (trash.restored > 0) {
    restored = `put ${String(trash.restored)} back into a tree git kept, `;
  }
  return `reclaim trash: ${restored}${String(trash.waiting)} batch(es) wait for \`worktree prune --apply\` to delete`;
}
