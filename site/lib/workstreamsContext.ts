/**
 * The Workstreams page's two readings, narrowed to the workspace the console is looked at in.
 *
 * The page draws `handover list --json` (the board) and `handover reconcile --json` (the fleet against it).
 * The board's rows carry their own fields, so each is placed by `boardRowPlacement` exactly as the Queue places
 * an ask. A reconcile row carries only its id, which IS the board row's slug — so it is placed by JOINING to the
 * board this page read, never by its label. A ranked id the board does not carry is unplaced.
 *
 * **The lists carry only rows placed HERE; every finding is set apart.** MEASURED over `handover
 * list --json`: 768 of the 770 RUN NOW rows state no workspace and name no pull request. Drawn inline in both
 * workspaces, those findings made one workspace's page read as the other's, which is wrong for an owner who chose
 * that workspace. So a finding is labelled and counted in its own group rather than interleaved with the rows a
 * workspace actually owns, and is drawn in ONE workspace, the one the default rule places it in
 * (`workspaceOfPlacement`), never both. A ranked id no board row carries, or whose board rows join as a conflict,
 * follows the same default. Re-measure with `slopweaver handover alignment-board --json`: rows with no `workspace`
 * and no `prUrls`.
 *
 * What is not narrowed, and says so: the reading's `headline`, `rankedCount`, `ungroomed`, an outcome's `rows`
 * count and whether anybody covers it, and its intake are the verb's own totals over the WHOLE board, and
 * recomputing them here would be a second ranking. An outcome's live and unspawned ROWS are narrowed like every
 * other list.
 */

import { type Board, type BoardRow } from "../components/live/read";
import { type Placed, type RankedRow, type Reconcile } from "../components/live/readWorkstreams";
import { boardRowPlacement } from "./registerPlacement";
import { type WorkContext } from "./workContext";
import {
  placementOf,
  type WorkspaceEvidence,
  type WorkspacePlacement,
  type WorkspacePlacer,
} from "./workspacePlacement";
import {
  type ContextTally,
  contextTally,
  DEFAULT_WORKSPACE,
  findingLabel,
  shownInContext,
  workspaceOfContext,
} from "./workspacePlacementContext";
import { isOpen, type Workstreams, workstreamsOf } from "./workstreams";

/**
 * Every board row with the placement its own fields give it.
 *
 * @param placer the organisation's address readers, which place each row
 * @returns the rows, each beside its placement, in board order
 */
export function placedBoardRows({
  board,
  placer,
}: {
  board: Board;
  placer: WorkspacePlacer;
}): readonly { readonly row: BoardRow; readonly placement: WorkspacePlacement }[] {
  return board.rows.map((row) => ({ placement: boardRowPlacement({ placer, row }), row }));
}

/**
 * Whether a placement is one this workspace owns — placed, and placed here.
 *
 * @returns true only for a row placed in the context's own workspace
 */
function ownedHere({ context, placement }: { context: WorkContext; placement: WorkspacePlacement }): boolean {
  return placement.kind === "placed" && placement.workspace === workspaceOfContext({ context });
}

/**
 * Every piece of evidence a placement rests on, whichever way it came out.
 *
 * @returns the evidence
 */
function evidenceOf({ placement }: { placement: WorkspacePlacement }): readonly WorkspaceEvidence[] {
  if (placement.kind === "conflict") {
    return placement.evidence;
  }
  if (placement.kind === "unplaced") {
    return [];
  }
  if (placement.overruled === undefined) {
    return placement.by;
  }
  return [...placement.by, ...placement.overruled];
}

/**
 * Each board slug's placement, for joining a ranked id to it. A slug is a doc's file name, so the board carries
 * each once (0 repeats in 3,509 rows: `slopweaver handover list --json | jq '[.rows[].slug] |
 * group_by(.) | map(select(length > 1)) | length'`); should one ever repeat, its rows' evidence is pooled, so
 * two rows naming different workspaces join as a conflict rather than as whichever came last.
 *
 * @param placer the organisation's address readers, which place each row
 * @returns the placements by slug
 */
export function placementsBySlug({
  board,
  placer,
}: {
  board: Board;
  placer: WorkspacePlacer;
}): ReadonlyMap<string, WorkspacePlacement> {
  const bySlug = new Map<string, WorkspacePlacement>();
  for (const { row, placement } of placedBoardRows({ board, placer })) {
    const seen = bySlug.get(row.slug);
    if (seen === undefined) {
      bySlug.set(row.slug, placement);
      continue;
    }
    bySlug.set(
      row.slug,
      placementOf({
        evidence: [...evidenceOf({ placement: seen }), ...evidenceOf({ placement })],
        why: "no board row carrying this slug names a workspace",
      }),
    );
  }
  return bySlug;
}

/**
 * The board rows one workspace owns, its findings apart, and the tally the page's notes are drawn from.
 *
 * @param placer the organisation's address readers, which place each row
 * @returns the owned rows, the findings this context draws (unplaced or conflicting, placed here by the default
 *   rule), and how the whole board split
 */
export function boardInContext({
  board,
  context,
  placer,
}: {
  board: Board;
  context: WorkContext;
  placer: WorkspacePlacer;
}): {
  readonly rows: readonly BoardRow[];
  readonly findings: readonly BoardRow[];
  readonly tally: ContextTally;
} {
  const placed = placedBoardRows({ board, placer });
  return {
    findings: placed
      .filter(({ placement }) => placement.kind !== "placed" && shownInContext({ context, placement }))
      .map(({ row }) => row),
    rows: placed.filter(({ placement }) => ownedHere({ context, placement })).map(({ row }) => row),
    tally: contextTally({ context, placements: placed.map(({ placement }) => placement) }),
  };
}

/**
 * The board row a panel holds, found again in the CURRENT reading AND in this context: one of this workspace's
 * rows or a finding. A row the other workspace owns — the selector switched with its panel open, or a `?row=`
 * link arrived in the wrong context — is not drawn here, and says where it is instead.
 *
 * A click opens the row it was made on, by its position in the board, so a second row sharing a slug opens its
 * own panel and mark rather than the first's. A `?row=` link names only a slug, so it opens the first
 * row carrying it, as does a click whose position a re-read has since moved to another slug.
 *
 * @param slug the slug the panel was opened on, if any
 * @param at the clicked row's index in the board's rows; absent for a `?row=` link
 * @param placer the organisation's address readers, which place each row
 * @returns the row to draw, the slug of one the other workspace holds, or nothing open
 */
export function openedInContext({
  at,
  board,
  context,
  placer,
  slug,
}: {
  at?: number | undefined;
  board: Board;
  context: WorkContext;
  placer: WorkspacePlacer;
  slug: string | undefined;
}):
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly row: BoardRow }
  | { readonly kind: "elsewhere"; readonly slug: string } {
  if (slug === undefined) {
    return { kind: "none" };
  }
  const shown = boardInContext({ board, context, placer });
  const drawn = [...shown.rows, ...shown.findings];
  const clicked = at === undefined ? undefined : board.rows.at(at);
  if (clicked?.slug === slug) {
    if (drawn.includes(clicked)) {
      return { kind: "open", row: clicked };
    }
    return { kind: "elsewhere", slug };
  }
  const here = drawn.find((row) => row.slug === slug);
  if (here !== undefined) {
    return { kind: "open", row: here };
  }
  if (board.rows.some((row) => row.slug === slug)) {
    return { kind: "elsewhere", slug };
  }
  return { kind: "none" };
}

/**
 * The Queue's workstream band over the rows one workspace owns, and how many OPEN board rows this context draws as
 * findings and so folds into none of its streams — the band speaks of open rows only, so its findings count does too.
 *
 * @param nowMs the instant the page is drawn at, which decides what is slipping
 * @param placer the organisation's address readers, which place each row
 * @returns the fold over this workspace's rows, the open findings it left out, and the placement of each folded
 *   row a stated workspace placed over a conflict, by slug — every one of them, so a second row sharing a slug keeps
 *   its own mark rather than absorbing the first's
 */
export function workstreamsInContext({
  board,
  context,
  nowMs,
  placer,
}: {
  board: Board;
  context: WorkContext;
  nowMs: number;
  placer: WorkspacePlacer;
}): {
  readonly folded: Workstreams;
  readonly findings: number;
  readonly stated: ReadonlyMap<string, readonly WorkspacePlacement[]>;
} {
  const shown = boardInContext({ board, context, placer });
  const here = new Set(shown.rows);
  const stated = new Map<string, WorkspacePlacement[]>();
  for (const { row, placement } of placedBoardRows({ board, placer })) {
    if (!here.has(row) || findingLabel({ placement }) === undefined) {
      continue;
    }
    const seen = stated.get(row.slug);
    if (seen === undefined) {
      stated.set(row.slug, [placement]);
    } else {
      seen.push(placement);
    }
  }
  return {
    findings: shown.findings.filter((row) => isOpen({ row })).length,
    folded: workstreamsOf({ nowMs, rows: shown.rows }),
    stated,
  };
}

/**
 * The reconciliation with every row list narrowed to the rows one workspace owns, how many distinct row ids went
 * to the other workspace, and how many are findings.
 *
 * A ranked id is placed by the board row carrying its slug. One whose row is a finding is kept in the lists of the
 * workspace the default rule places it in, under its mark, and counted in `findings`; in the other it counts as
 * hidden. One NO board row carries is kept in the lists of the default workspace and named in
 * `offBoard`: nothing else on the page could show it, and dropping it would hide it. One whose finding
 * is the JOIN of board rows placed in different workspaces is a conflict no board row is — even beside an unplaced
 * row sharing its slug, which the findings list apart — so it is kept the same way and named in `joinedConflicts`.
 * A session on a row counts where its ROW is; a session on
 * no row the board claims (`unregistered`) is kept, since it is a session, not a row. Totals the verb computed
 * over the whole board are carried through untouched — the module header says why.
 *
 * @param board the board the page read, whose rows place the ranked ids
 * @param placer the organisation's address readers, which place each board row
 * @returns the narrowed reconciliation, the count of ids placed in the other workspace, the count of ids whose
 *   board row is a finding (kept in the lists), the ids no board row carries, kept in the lists, and every board row's placement by
 *   slug, so a list can mark a row a stated workspace placed over a conflict, and the ids kept by the default because
 *   only the join of their board rows conflicts
 */
export function reconcileInContext({
  reconcile,
  board,
  context,
  placer,
}: {
  reconcile: Reconcile;
  board: Board;
  context: WorkContext;
  placer: WorkspacePlacer;
}): {
  readonly reconcile: Reconcile;
  readonly hidden: number;
  readonly findings: number;
  readonly offBoard: readonly string[];
  readonly joinedConflicts: readonly string[];
  readonly placements: ReadonlyMap<string, WorkspacePlacement>;
} {
  const bySlug = placementsBySlug({ board, placer });
  // A ranked id whose joined placement is a finding is drawn by the board findings only when none of its board rows
  // is placed; if one is, the finding is the JOIN of rows placed apart, which no board row draws.
  const placedSlugs = new Set(
    placedBoardRows({ board, placer })
      .filter(({ placement }) => placement.kind === "placed")
      .map(({ row }) => row.slug),
  );
  const joinedConflictIds = new Set<string>();
  const hiddenIds = new Set<string>();
  const findingIds = new Set<string>();
  const offBoardIds = new Set<string>();
  // Every id no stated fact places is the default workspace's, exactly as a Queue row is.
  const defaultHere = workspaceOfContext({ context }) === DEFAULT_WORKSPACE;
  const keeps = ({ id }: { id: string }): boolean => {
    const placement = bySlug.get(id);
    if (placement?.kind === "placed") {
      const kept = ownedHere({ context, placement });
      if (!kept) {
        hiddenIds.add(id);
      }
      return kept;
    }
    if (!defaultHere) {
      hiddenIds.add(id);
      return false;
    }
    if (placement === undefined) {
      offBoardIds.add(id);
      return true;
    }
    if (placedSlugs.has(id)) {
      joinedConflictIds.add(id);
      return true;
    }
    // Listed here too, under its mark, though the board tile also draws its row: a ranked row is its own line, and
    // dropping it would leave it drawn in no reconcile view at all.
    findingIds.add(id);
    return true;
  };
  const rows = <Row extends RankedRow>({ list }: { list: readonly Row[] }): readonly Row[] =>
    list.filter((row) => keeps(row));
  const seats = ({ list }: { list: readonly Placed[] }): readonly Placed[] => list.filter((seat) => keeps(seat.row));
  let held: Reconcile["held"];
  if (reconcile.held !== undefined) {
    held = rows({ list: reconcile.held });
  }
  const narrowed: Reconcile = {
    ...reconcile,
    aligned: seats({ list: reconcile.aligned }),
    held,
    misaligned: seats({ list: reconcile.misaligned }),
    outcomes: reconcile.outcomes.map((outcome) => ({
      ...outcome,
      live: seats({ list: outcome.live }),
      unspawned: rows({ list: outcome.unspawned }),
    })),
    ready: rows({ list: reconcile.ready }),
    staleAsks: rows({ list: reconcile.staleAsks }),
    starving: rows({ list: reconcile.starving }),
    top: rows({ list: reconcile.top }),
    unprioritised: seats({ list: reconcile.unprioritised }),
  };
  return {
    findings: findingIds.size,
    hidden: hiddenIds.size,
    joinedConflicts: [...joinedConflictIds],
    offBoard: [...offBoardIds],
    placements: bySlug,
    reconcile: narrowed,
  };
}
