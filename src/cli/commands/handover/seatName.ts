/**
 * The DIRECTORY reading of which board row a live cmux workspace stands in — the fallback half of
 * `./seatBinding.ts`'s `seatRowOf`, which every reconcile step places a seat by and which reads the session
 * ledger's recorded binding first. One reading for both, because the recipe-failure filter
 * (`./recipeFailureSeats.ts`) runs BEFORE the worked mapping (`./reconcileRows.ts`), and two readings let the first
 * drop a live seat the second would have counted.
 */
import { basename } from "node:path";

/**
 * The directory a seat's path names its row by: the worktree it stands in — the segment right after
 * `.claude/worktrees(.noindex)/`, the layout `../../../worktree/location.ts`'s `worktreePath` builds — wherever under
 * it the shell has moved, else the path's own basename. Basename alone read a seat whose shell moved into a
 * subdirectory as unseated, and the deepest segment naming any row let a subdirectory called after ANOTHER row take
 * the seat (`…/seat-a/src/handover` read as `handover`), so a ready row could be seated twice.
 *
 * The OUTERMOST worktree on the path is the seat's: `cmux spawn` opens a seat at its row's worktree root, so anything
 * worktree-shaped below it — `…/seat-a/tmp/.claude/worktrees/other-row` — is still inside that seat's tree.
 * The `.claude/worktrees` part matches in any case, since a case-insensitive filesystem lets a shell `cd` into
 * `.CLAUDE/…` and cmux reports the path as typed. Residue, stated: a checkout that itself sits under
 * some other `.claude/worktrees/` reads as that outer worktree, and the worktree's OWN name is compared as reported,
 * so a shell that respelt its case matches no row.
 *
 * @param directory the workspace's current directory
 * @returns the name a row match reads
 */
export function seatNameOf({ directory }: { directory: string }): string {
  const outermost = WORKTREE_NAME.exec(directory);
  if (outermost !== null) {
    return outermost[1]!;
  }
  return basename(directory);
}

/** A worktree's name on a path, after the directory every worktree lives in; not global, so `exec` is stateless. */
const WORKTREE_NAME = /\/\.claude\/worktrees(?:\.noindex)?\/([^/]+)/iu;
