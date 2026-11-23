/**
 * How a row's workspace placement shows across the context switcher: which view a workspace is, what a context shows
 * and counts, and the mark a finding wears. The placement itself is `./workspacePlacement.ts`.
 *
 * A team card belongs on the team context and never on the Slopweaver context, and a Slopweaver card never wears the
 * team's mark; either is a bug of a whole class. A row that states no workspace is a finding, and a finding drawn in
 * BOTH views, or given the team's mark by a second, separate rule, is that bug.
 *
 * So there is ONE rule for a row no stated fact places, and every surface reads it through
 * {@link workspaceOfPlacement}: it belongs to `self`, this installation's own workspace — a role, never a name — and
 * keeps a mark saying the default placed it. Never both views. The team's work carries an address (a pull request in
 * the organisation's repositories, its Slack, Linear or Vanta) or a statement; a row that carries neither is placed
 * where the owner can see it, marked, and fixed at its source with `handover set-workspace`.
 */

import type { WorkContext } from "./workContext";
import type { Workspace, WorkspacePlacement } from "./workspacePlacementBasis";

/** The workspace a row no stated fact places belongs to — the one default rule (`skills/handover/reference/one-board.md`). */
export const DEFAULT_WORKSPACE: Workspace = "self";

/**
 * The ONE workspace a placement puts its row in: a placed row's own, and {@link DEFAULT_WORKSPACE} for a row its
 * fields leave unplaced or name both workspaces with no statement to settle them. The placement kind still says which,
 * so the row keeps its mark.
 *
 * @returns the workspace the row is drawn and counted in
 */
export function workspaceOfPlacement({ placement }: { placement: WorkspacePlacement }): Workspace {
  if (placement.kind === "placed") {
    return placement.workspace;
  }
  return DEFAULT_WORKSPACE;
}

/**
 * The view a workspace is shown in — the switcher keeps its original ids, `work` for the team's and `slopweaver` for
 * this installation's own.
 *
 * @returns the view id
 */
export function contextOfWorkspace({ workspace }: { workspace: Workspace }): WorkContext {
  if (workspace === "team") {
    return "work";
  }
  return "slopweaver";
}

/**
 * The workspace a view id shows, the other half of {@link contextOfWorkspace}.
 *
 * @returns the workspace
 */
export function workspaceOfContext({ context }: { context: WorkContext }): Workspace {
  if (context === "work") {
    return "team";
  }
  return "self";
}

/**
 * Whether a row is shown in a context: exactly one context shows each row, the one {@link workspaceOfPlacement} puts
 * it in.
 *
 * @param context the context being looked at
 * @returns true when the row's workspace is this context's
 */
export function shownInContext({
  context,
  placement,
}: {
  context: WorkContext;
  placement: WorkspacePlacement;
}): boolean {
  return workspaceOfPlacement({ placement }) === workspaceOfContext({ context });
}

/** How a set of rows falls across the switcher, from the context being looked at. */
export interface ContextTally {
  /** Rows this context shows, the default-placed ones among them. */
  readonly here: number;
  /** Rows the other context shows, which this one neither shows nor counts. */
  readonly other: number;
  /** Of `here`, the rows carrying no workspace evidence — placed by the default, each a finding. */
  readonly unplaced: number;
  /** Of `here`, the rows whose evidence names both workspaces — placed by the default, each a finding. */
  readonly conflict: number;
}

/**
 * Where each row sits relative to the context being looked at. `here + other` is every row, and `here` is exactly
 * what the context shows, since it counts through the same {@link shownInContext}; `unplaced` and `conflict` are the
 * marked rows within `here`, so a context never announces a finding it does not draw.
 *
 * @param context the context being looked at
 * @param placements every row's placement, before any filtering
 * @returns the four figures
 */
export function contextTally({
  context,
  placements,
}: {
  context: WorkContext;
  placements: readonly WorkspacePlacement[];
}): ContextTally {
  let here = 0;
  let other = 0;
  let unplaced = 0;
  let conflict = 0;
  for (const placement of placements) {
    if (!shownInContext({ context, placement })) {
      other += 1;
      continue;
    }
    here += 1;
    if (placement.kind === "unplaced") {
      unplaced += 1;
    } else if (placement.kind === "conflict") {
      conflict += 1;
    }
  }
  return { conflict, here, other, unplaced };
}

/**
 * The context a deep-linked row has to be opened in, when the one being looked at hides it.
 *
 * A link from a floating note's Open can land on a row the context being looked at hides. A link names ONE row, so following it is choosing that row's context — a default-placed finding's included.
 *
 * @param context the context being looked at
 * @param placement the linked row's placement
 * @returns the row's own context when it differs from the one being looked at, else `undefined`
 */
export function contextToOpen({
  context,
  placement,
}: {
  context: WorkContext;
  placement: WorkspacePlacement;
}): WorkContext | undefined {
  const own = contextOfWorkspace({ workspace: workspaceOfPlacement({ placement }) });
  if (own === context) {
    return undefined;
  }
  return own;
}

/**
 * The words a finding row wears — or a placed row whose stated workspace overruled an address — and `undefined`
 * for any other placed row.
 *
 * @returns the label and what it rests on
 */
export function findingLabel({
  placement,
}: {
  placement: WorkspacePlacement;
}): { readonly label: string; readonly title: string } | undefined {
  if (placement.kind === "unplaced") {
    return {
      label: "placed by default: no workspace",
      title: `placed in ${DEFAULT_WORKSPACE} by default: no field names a workspace: ${placement.why}`,
    };
  }
  if (placement.kind === "conflict") {
    const named = placement.evidence.map((one) => `${one.source} ${one.value} → ${one.workspace}`).join("; ");
    return {
      label: "placed by default: workspace conflict",
      title: `placed in ${DEFAULT_WORKSPACE} by default: its fields name both workspaces: ${named}`,
    };
  }
  if (placement.overruled !== undefined) {
    const named = placement.overruled.map((one) => `${one.source} ${one.value} → ${one.workspace}`).join("; ");
    return { label: "stated over a conflict", title: `stated ${placement.workspace}, overruling: ${named}` };
  }
  return undefined;
}

/**
 * The line a page prints for its findings — the rows no field places and the rows placed twice.
 *
 * @param unplaced rows with no workspace evidence
 * @param conflict rows whose evidence names both workspaces
 * @returns the sentence, or `undefined` when there is none
 */
export function findingsLine({ unplaced, conflict }: { unplaced: number; conflict: number }): string | undefined {
  const parts: string[] = [];
  if (unplaced > 0) {
    parts.push(`${String(unplaced)} ${unplaced === 1 ? "row names" : "rows name"} no workspace`);
  }
  if (conflict > 0) {
    parts.push(`${String(conflict)} ${conflict === 1 ? "row has" : "rows have"} fields naming both workspaces`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `${parts.join("; ")} (placed here by default, each a finding)`;
}

/**
 * How many of some rows wear a workspace mark — a finding, or a statement over a conflict — so a surface that folds
 * rows behind a count says how many of them are marked rather than hiding the mark with the row.
 *
 * @param rows the rows folded away
 * @returns how many carry a mark
 */
export function markedCount({ rows }: { rows: readonly { readonly placement: WorkspacePlacement }[] }): number {
  return rows.filter((row) => findingLabel({ placement: row.placement }) !== undefined).length;
}
