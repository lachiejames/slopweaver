/**
 * Whose work a relayed steer is, as the page knows it when the relay is handed off — the workspace `talk relay`
 * states on the row it registers, so the owner's words land in the workspace of the card they answer.
 *
 * Two facts, two instants: the card key the owner's words began over is stamped as they speak, and where that card is placed is
 * read once, at hand-off, from the Queue the page holds then. A card re-placed in between is the same card corrected,
 * so the relay follows it; the wire then carries the answer unchanged through the post and its retry.
 *
 * A relay row carries only the owner's words and the card key they spoke over, and the placement rules read neither
 * (`./registerPlacement.ts`), so without a statement every relay is a finding. The page holds two facts the row does
 * not: where the card the owner spoke over is placed, and which console they are looking at. The card wins, because their
 * words answer it; a card that is itself a finding or a conflict, or one the page's Queue does not hold, states nothing:
 * the relay is then placed by the same default rule the card was (`workspaceOfPlacement`), marked as the card is, and
 * a default copied in as a statement would outlive the card's own fix. Only words over no card at all take the console they were
 * said on — stamped as the owner spoke (`./heardOver.ts`'s `relaySpokenIn`), never the one they switched to before the voice
 * relayed them. Pure.
 */
import type { WorkContext } from "./workContext";
import type { Workspace, WorkspacePlacement } from "./workspacePlacement";
import { workspaceOfContext } from "./workspacePlacementContext";

/** The statement a relay carries: the workspace, and the one line the row keeps saying why. */
export interface RelayWorkspace {
  readonly workspace: Workspace;
  readonly because: string;
}

/** The fields of a Queue row this reads. */
export interface PlacedQueueRow {
  readonly key: string;
  readonly aliases?: readonly string[];
  readonly placement: WorkspacePlacement;
}

/**
 * The workspace a relay states.
 *
 * @param about the card key the owner's words began over, or empty
 * @param spokenIn the console the owner's words over no card were said on, or `undefined` when none places them
 * @param rows the Queue rows the page holds, every context's, with their placements
 * @returns the card's own workspace when it is placed; the console's when the owner spoke over no card on one; nothing
 *   when the card is a finding, a conflict, or a key the page's Queue does not hold, or no console places the words
 */
export function relayWorkspace({
  about,
  spokenIn,
  rows,
}: {
  about: string;
  spokenIn: WorkContext | undefined;
  rows: readonly PlacedQueueRow[];
}): RelayWorkspace | undefined {
  if (about === "") {
    if (spokenIn === undefined) {
      return undefined;
    }
    const workspace = workspaceOfContext({ context: spokenIn });
    return { because: `the owner said it on the ${workspace} console, over no card`, workspace };
  }
  // A key the page's Queue does not hold may be a row still loading or one placed in the other workspace, so the
  // console the owner is on says nothing about it. Two rows answering to the key that disagree, or one that is not
  // placed, state nothing either, rather than whichever was read first.
  const workspaces = new Set<Workspace>();
  for (const row of rows) {
    if (row.key !== about && row.aliases?.includes(about) !== true) {
      continue;
    }
    if (row.placement.kind !== "placed") {
      return undefined;
    }
    workspaces.add(row.placement.workspace);
  }
  const workspace = workspaces.values().next().value;
  if (workspaces.size !== 1 || workspace === undefined) {
    return undefined;
  }
  return { because: `the owner's words answer ${about}, which is placed in ${workspace}`, workspace };
}
