/**
 * Whether the worktree a spawn would REUSE is already another row's — the decision, pure, over facts its caller
 * read.
 *
 * MEASURED: a finding row registered with `handover register --branch <b>`, `<b>` the head branch of
 * a working seat's open pull request, was seated by `cmux spawn` straight into that seat's worktree.
 * `./spawnTree.ts` reuses whichever tree holds a candidate branch, the doc's declared `branch:` first, and nothing
 * asked whose tree it was — so two sessions shared one working tree and one index. Reproduce the selection with a
 * declared branch another tree holds: `existingSpawnTree` returns that tree.
 *
 * The selection is left exactly as it is. This is a SECOND question asked of the tree it chose, and the signal is
 * ROW IDENTITY: a run journal records the tree its writer launched in (`launched`, `claimed`) and a parked seat the
 * tree it closed in (`parked`). A holder whose slug is the spawning slug is the row's own tree — a parked or crashed
 * seat reseated where it stood, unchanged whatever the old writer's liveness. A holder under any OTHER slug makes the
 * tree foreign, at any liveness — a dead writer's unfinished run still belongs to its row until a lifecycle verb says
 * otherwise — unless its session is one this row's own holding there names: one session that started a second row in
 * its own tree is still one occupant. Branch names, slug shapes and the conventional path are never the signal — the
 * defect is precisely a branch shared by two rows. The main checkout is never asked: it is shared by design.
 *
 * A holder counts against the tree it is INSIDE, the innermost listed worktree containing its path: a writer whose
 * `cwd` was a subdirectory of a seat's tree holds that tree, and a writer in a linked worktree beneath the main
 * checkout never holds the main checkout.
 */

import type { RunEvent } from "../handover/ledger.js";
import { runStateOf } from "../handover/ledger.js";
import { activeParkedCheckpoint } from "../handover/parked.js";
import { runOwnership } from "../handover/runOwner.js";
import { worktreePathKey } from "../worktree/location.js";

/** One row's claim on a directory, read from its run journal. */
export interface TreeHolder {
  /** The row whose run holds the directory. */
  readonly slug: string;
  /** The directory the journal records, in the spelling it was written. */
  readonly path: string;
  /**
   * How the journal holds it: an unclosed run's writer, a seat parked there with its state kept, or a journal over
   * the read bound that names the tree and so cannot be shown NOT to hold it.
   */
  readonly via: "run" | "parked" | "unparsed";
  /** The session the journal names, a bare id — never a note or other free text; `undefined` for an unparsed one. */
  readonly sessionId: string | undefined;
}

/** What a spawn may do with the tree it selected; `main` is the main checkout, shared by design and never asked. */
export type TreeOccupancy =
  | { readonly kind: "free" }
  | { readonly kind: "own" }
  | { readonly kind: "main" }
  | { readonly kind: "foreign"; readonly holder: TreeHolder };

/**
 * The directories one row's journal holds now. A closed run holds nothing, whoever last wrote it; an open or
 * waiting one holds its writer's tree — claimed or released alike, since a release is a handoff in progress, not a
 * free tree — and a seat parked now holds the tree it closed in, the writer it released notwithstanding.
 *
 * @param slug the row the journal belongs to
 * @param events the journal's events, in order
 * @returns the holding, a standing park's over its released writer's, empty when the journal holds no directory
 */
export function treeHoldersOf({ slug, events }: { slug: string; events: readonly RunEvent[] }): readonly TreeHolder[] {
  if (runStateOf({ events }).phase === "closed") {
    return [];
  }
  // A park RELEASES its writer, so ownership reads it `released` over the same seat: the park is the truer account
  // of how the tree is held, and naming it alone keeps one holding from being reported twice.
  const parked = activeParkedCheckpoint({ events });
  if (parked !== undefined) {
    return [{ path: parked.worktree, sessionId: parked.sessionId, slug, via: "parked" }];
  }
  const ownership = runOwnership({ events, sessionId: undefined });
  if (ownership.kind === "unowned" || ownership.writer.worktree === undefined) {
    return [];
  }
  return [{ path: ownership.writer.worktree, sessionId: ownership.writer.sessionId, slug, via: "run" }];
}

/** Whether `inner` is `outer` or a directory beneath it, both already keyed. */
function within({ inner, outer }: { inner: string; outer: string }): boolean {
  return inner === outer || inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
}

/**
 * The innermost listed worktree a path stands in, keyed, or `undefined` when it stands in none.
 *
 * @param path any spelling of a directory
 * @param trees every worktree of the repository, keyed
 * @returns the longest tree containing it
 */
function innermostTree({ path, trees }: { path: string; trees: readonly string[] }): string | undefined {
  const key = worktreePathKey({ path });
  const containing = trees.filter((tree) => within({ inner: key, outer: tree }));
  return containing.toSorted((a, b) => b.length - a.length)[0];
}

/**
 * Whether a spawn for `slug` may open in `tree`.
 *
 * The main checkout is `main` and never asked: every session the console or the chair starts stands there, so it
 * is shared by design — the same rule `./parkedReseat.ts`'s `fleetWorktrees` applies to a park. In a fleet tree the
 * signal is the SESSION: another row's holder is foreign unless its session is one this row's own holding there
 * names — one session that started two rows in its own tree is one occupant, and a respawn after its seat died
 * still matches, since both holdings name the dead session. A row with no holding there gets no such pass, and an
 * unparsed holder names no session, so it stays foreign. Free when nothing holds the tree, own otherwise.
 *
 * @param holders every holding read across the run journals
 * @param mainCheckouts every spelling of the repository's main checkout the caller knows
 * @param slug the row being spawned
 * @param tree the worktree the spawn selected, in any spelling
 * @param worktrees every worktree path of the repository, the selected one included, in any spelling
 * @returns the verdict, naming the first foreign holder when there is one
 */
export function treeOccupancy({
  holders,
  mainCheckouts,
  slug,
  tree,
  worktrees,
}: {
  holders: readonly TreeHolder[];
  mainCheckouts: readonly string[];
  slug: string;
  tree: string;
  worktrees: readonly string[];
}): TreeOccupancy {
  const target = worktreePathKey({ path: tree });
  if (mainCheckouts.some((path) => worktreePathKey({ path }) === target)) {
    return { kind: "main" };
  }
  const keyed = [...new Set([target, ...worktrees.map((path) => worktreePathKey({ path }))])];
  const inTree = holders.filter((holder) => innermostTree({ path: holder.path, trees: keyed }) === target);
  const ownSessions = new Set(
    inTree
      .filter((holder) => holder.slug === slug)
      .flatMap((holder) => (holder.sessionId === undefined ? [] : [holder.sessionId])),
  );
  const foreign = inTree.find(
    (holder) => holder.slug !== slug && (holder.sessionId === undefined || !ownSessions.has(holder.sessionId)),
  );
  if (foreign !== undefined) {
    return { holder: foreign, kind: "foreign" };
  }
  return inTree.length === 0 ? { kind: "free" } : { kind: "own" };
}

/**
 * What a foreign verdict observed, for a refusal's detail: the holding row, how it holds the tree, its session id
 * and the tree — structured fields only, never free text a journal carries.
 *
 * @param holder the foreign holder
 * @param slug the row being spawned
 * @param tree the worktree the spawn selected
 * @returns one clause
 */
export function foreignHolderDetail({
  holder,
  slug,
  tree,
}: {
  holder: TreeHolder;
  slug: string;
  tree: string;
}): string {
  if (holder.sessionId === undefined) {
    return `${tree} may be held by row ${holder.slug}, whose run journal names it but is over the read bound and was not parsed, so ${slug} could share its working tree and index`;
  }
  const how = holder.via === "parked" ? "a seat parked there" : "an unclosed run";
  return `${tree} is held by row ${holder.slug} through ${how} (session ${holder.sessionId}), so ${slug} would share its working tree and index`;
}
