/**
 * The ONE reading of which board row a live cmux workspace is a seat on, shared by every reconcile step that places
 * a workspace — the recipe-failure filter (`./recipeFailureSeats.ts`) runs BEFORE the worked mapping
 * (`./reconcileRows.ts`), so two readings would let a seat skip the first's host proof and still count in the
 * second.
 *
 * ## The recorded binding first, the directory second
 *
 * `cmux spawn` writes a `spawned` event naming the slug and the workspace it opened (`../../../sessions/session.ts`),
 * so which row a seat is on is a fact the spawner knew for certain. `./seatName.ts` reads a row off the workspace's
 * DIRECTORY instead, which is right only when the worktree is named for the row: a seat spawned into a REUSED
 * worktree named for its branch stands in a directory naming no row, and read as unregistered for ever — short the
 * live and seat counts the supervisor fills capacity from. So the binding is read first and the directory is the
 * fallback.
 *
 * ## Bound by the workspace ID, never the ref
 *
 * A ref is comparable only within one run of cmux: a restart renumbers refs and keeps ids
 * (`skills/supervisor/reference/reboot.md`, `../../../fleet/goneSeats.ts`). A seat that died with no `closed` event
 * leaves an OPEN row behind, and a ref join would hand that row to whichever unrelated workspace the restart gave
 * the same number. The ledger's `cwd` cannot rescue a ref match either: this defect is about REUSED worktrees, so two
 * rows can stand in one checkout at different times. Stated residue: a row written before `cmux spawn` recorded the
 * id binds nothing and keeps the directory reading, so a seat already open in a branch-named worktree reads
 * unregistered until it is reseated.
 *
 * ## A binding holds only while the workspace stands where it was spawned
 *
 * The id says WHICH workspace; it does not say the workspace is still doing that row's work. A shell that has since
 * moved into another row's worktree with no new `spawned` line leaves the old binding open, and read alone it would
 * keep the workspace on the row it left. So the binding counts only while the workspace's
 * directory is the spawn's recorded `cwd` or under it — a seat whose shell went into `src/` is still bound — and
 * otherwise the directory reading decides. That keeps the case this module exists for: a reused worktree named for
 * some OTHER row, the seat still standing in it, reads as the row it was spawned for.
 */
import { posix } from "node:path";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type SessionItem } from "../../../sessions/session.js";
import { worktreePathKey } from "../../../worktree/location.js";
import { seatNameOf } from "./seatName.js";

/**
 * The board row this workspace is a seat on: an OPEN ledger row's recorded binding to its workspace id, else the row
 * its worktree directory names, else `undefined`.
 *
 * Only an open row binds, because a `closed` event retires its workspace, and only while the workspace still stands
 * in or under the directory that row was spawned into, and while `seatNameOf`'s reading of where it stands names no
 * different board row than its reading of that directory does. That reading is the OUTERMOST worktree segment, the
 * same one the directory fallback uses, so a worktree nested inside the spawn's own worktree is residue, stated: a
 * seat that walks into one keeps its binding, exactly as the directory reading alone keeps it on the outer row.
 * `cmux spawn` creates every worktree flat under the main checkout (`../../../worktree/location.ts`'s
 * `worktreePath`). When two rows name one workspace the most recently spawned IS the binding, which is the order
 * `foldSessions` returns, and an older one never stands in for it: a newest
 * binding that is closed, names a slug the board does not carry, or that the workspace has left binds nothing, and
 * the directory reading decides.
 *
 * @param rowIds every board row id a seat may stand on
 * @param sessions the folded session ledger, most recently opened first
 * @param workspace the live workspace being placed
 * @returns the row id, or `undefined` when neither the ledger nor the directory names a board row
 */
export function seatRowOf({
  rowIds,
  sessions,
  workspace,
}: {
  rowIds: ReadonlySet<string>;
  sessions: readonly SessionItem[];
  workspace: Pick<CmuxWorkspaceSummary, "currentDirectory" | "workspaceId">;
}): string | undefined {
  // The NEWEST row on this id is the binding, and only then is it judged — open, on the board, still in place.
  // Filtering on any of those first would let an older, superseded row bind once the newer one fails it.
  const binding = sessions.find((session) => session.workspaceId === workspace.workspaceId);
  // Both paths in the one spelling the worktree code already keys on — `..` resolved, the macOS `/private` alias and
  // the `worktrees`/`worktrees.noindex` pair folded — so one physical directory never reads as two.
  const directory = worktreePathKey({ path: workspace.currentDirectory });
  const slug = binding?.status === "open" ? binding.slug : undefined;
  const root = binding?.cwd;
  const name = seatNameOf({ directory });
  // A workspace that has moved into a worktree naming a DIFFERENT board row than its spawn directory did is read by
  // that directory, as origin/main read it — containment alone lets a broad recorded root (`/`) hold a seat that
  // now stands in another row's tree. The same worktree name, in any case, keeps the binding: that is
  // the reused-worktree seat this binding exists for. The root is keyed exactly as the directory is, so a `..` in the
  // recorded cwd cannot name a different worktree than the one it resolves to.
  const movedToAnotherRow =
    rowIds.has(name) &&
    root != null &&
    name.toLowerCase() !== seatNameOf({ directory: worktreePathKey({ path: root }) }).toLowerCase();
  if (
    slug != null &&
    rowIds.has(slug) &&
    root != null &&
    !movedToAnotherRow &&
    isWithin({ directory: workspace.currentDirectory, root })
  ) {
    return slug;
  }
  return rowIds.has(name) ? name : undefined;
}

/**
 * Whether `directory` is `root` or a path under it, compared segment-wise so `/w/seat-2` is not under `/w/seat`.
 *
 * Case is folded BEFORE either path is keyed. The macOS default volume is case-insensitive, so cmux can report
 * `.CLAUDE/…` for the directory a row recorded as `.claude/…`. A case-sensitive test would reject that valid binding,
 * and the directory fallback (`seatNameOf`, itself case-insensitive) would then place the seat on whatever row the
 * worktree is named for. Folding after keying is not enough, because the worktrees-segment fold only
 * matches the lowercase spelling.
 *
 * Residue, stated: this is a LEXICAL heuristic over the string cmux reports. It closes `..`, the `/private` alias,
 * the worktrees spellings and case. It does not close a symlink inside the spawn directory that points into another
 * row's worktree, nor, on a case-SENSITIVE volume, two board rows whose slugs differ only in case. Each needs a
 * constructed input, not one `cmux spawn` produces. A `realpath` of both sides on the live filesystem is the
 * mechanism that would close them, at one filesystem read per seat on every reconcile.
 *
 * @param directory the path a workspace stands in now, as cmux reports it
 * @param root the directory its seat was spawned into, as the ledger recorded it
 * @returns true when the workspace has not left the spawn's directory
 */
function isWithin({ directory, root }: { directory: string; root: string }): boolean {
  // `relative` rather than a prefix test, so a spawn rooted at `/` still holds its descendants.
  const climb = posix.relative(
    worktreePathKey({ path: root.toLowerCase() }),
    worktreePathKey({ path: directory.toLowerCase() }),
  );
  return climb !== ".." && !climb.startsWith("../") && !posix.isAbsolute(climb);
}
