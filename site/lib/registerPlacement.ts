/**
 * Where each register's row belongs — the one placement per record the queue, the workstreams board and every
 * figure over them read (`./workspacePlacement.ts` holds the evidence and the rule that settles it). A register placed
 * by the address it carries, never by a board row, is placed in `./registerPlacementDirect.ts`.
 *
 * Split out of `./queueRows.ts`, which projects the rows and ranks them, so each module stays under the
 * 300-line cap `file-size-ratchet` holds it to. A row is placed only from its structured fields, never its words.
 */

import type { BoardRow, HandStep } from "../components/live/read";
import type { BoardRowDestination } from "../components/live/readAction";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { LiveState } from "../components/live/useLive";
import { declaredContextsOf, tagsInDoubt } from "./boardContext";
import { type BoardRowIndex, rowsCarrying } from "./boardRowIndex";
import { queueLinkTarget } from "./queueLink";
import { WORK_CONTEXTS } from "./workContext";
import {
  actKindEvidence,
  installationStateEvidence,
  joinedEvidence,
  placementOf,
  slackRegisterEvidence,
  statedEvidence,
  type Workspace,
  type WorkspaceEvidence,
  type WorkspacePlacement,
  type WorkspacePlacer,
} from "./workspacePlacement";
import { findingLabel, shownInContext, workspaceOfContext } from "./workspacePlacementContext";

/** The board-row fields a placement reads — and nothing else, so no other field can drift into one. */
export type PlacedBoardFields = Pick<
  BoardRow,
  | "action"
  | "contextUnread"
  | "prUrls"
  | "prUrlsPartial"
  | "slug"
  | "tags"
  | "tagsIncomplete"
  | "tagsRead"
  | "workspace"
  | "workspaceUnread"
>;

/**
 * A Slack destination as a finding names it: its label and the conversation it resolves to — a thread by its
 * channel AND its timestamp — so a mark overruling it says which channel, thread or DM it was, and two threads in
 * one channel never read the same.
 *
 * @returns the words
 */
function slackDestinationAddress({ destination }: { destination: BoardRowDestination }): string {
  if (destination.kind === "dm") {
    return `Slack destination ${destination.label} (${destination.conversation})`;
  }
  if (destination.kind === "thread") {
    return `Slack destination ${destination.label} (${destination.channel} thread ${destination.threadTs})`;
  }
  return `Slack destination ${destination.label} (${destination.channel})`;
}

/**
 * The links a Slack destination carries — a channel's `url`, a thread's `permalink` — each an address to weigh.
 *
 * @returns the links, empty for a DM or a destination carrying none
 */
function destinationLinks({ destination }: { destination: BoardRowDestination }): readonly string[] {
  if (destination.kind === "channel" && destination.url !== undefined) {
    return [destination.url];
  }
  if (destination.kind === "thread" && destination.permalink !== undefined) {
    return [destination.permalink];
  }
  return [];
}

/**
 * Where a board row belongs — an ask on the queue, a row on the workstreams board. Its stated `workspace:` and its
 * declared `context=` tag (`./boardContext.ts`), the repositories of the pull requests it names, and the Slack
 * destinations its action would send to, with any link one carries. A row whose tags read in doubt, or whose `workspace:` line, `context=` tag, action or pull-request links would not read, is a finding, whatever else it carries: a
 * hidden `context=` may say otherwise. Never its
 * `repo:`, which is only the checkout its seat runs in; never its `anchor:`, which is where the ruling that made
 * it was spoken — the owner speaks in Acme's Slack about Slopweaver work (`push-resolves-repo-root-from-the-plugin-mirror`
 * is anchored in an Acme channel); never its `summaryAnchor`, the Slack thread its summary quotes, for the same
 * reason; and never its words.
 *
 * @param placer the organisation's address readers
 * @returns the placement
 */
export function boardRowPlacement({
  placer,
  row,
}: {
  placer: WorkspacePlacer;
  row: PlacedBoardFields;
}): WorkspacePlacement {
  if (tagsInDoubt({ row })) {
    return {
      kind: "unplaced",
      why: "its tags or run journal were not read whole, so a declared context= may be hidden or unvouched (NOT MEASURED)",
    };
  }
  if (row.workspaceUnread !== undefined) {
    // A misspelt line is a statement that did not read, never a row stating nothing.
    return {
      kind: "unplaced",
      why: `its workspace: line would not read as one workspace (${JSON.stringify(row.workspaceUnread)}) (NOT MEASURED)`,
    };
  }
  if (row.contextUnread !== undefined) {
    // The same for a context= tag the registry refused: a declaration that did not read.
    return {
      kind: "unplaced",
      why: `its context= tag would not read as one workspace (${JSON.stringify(row.contextUnread)}) (NOT MEASURED)`,
    };
  }
  if (row.prUrlsPartial) {
    // A list refused whole for one bad member drops every link beside it, an address among them.
    return {
      kind: "unplaced",
      why: "its pull-request links did not read as a list of links, so an address may be hidden (NOT MEASURED)",
    };
  }
  if (row.action.kind === "invalid") {
    // An action that would not read drops every destination it carries, a Slack address among them.
    // The parse's own reason is the warning beside the finding, never set inside its hover.
    return {
      kind: "unplaced",
      warning: { lead: "Its action would not read", subject: "this row's action", why: row.action.why },
      why: "its action would not read, so a Slack destination may be hidden (NOT MEASURED)",
    };
  }
  const tagged: WorkspaceEvidence[] = declaredContextsOf({ row }).map((declared) => ({
    source: "stated",
    value: `context=${declared}`,
    workspace: workspaceOfContext({ context: declared }),
  }));
  const destinations: WorkspaceEvidence[] = [];
  if (row.action.kind === "action") {
    for (const destination of row.action.action.destinations) {
      destinations.push(slackRegisterEvidence({ register: slackDestinationAddress({ destination }) }));
      // A destination's link is written by the session that shaped the action, so it is an address like any
      // other: one naming a repository weighs against the Slack send it rides on.
      destinations.push(...placer.addressEvidence({ values: destinationLinks({ destination }) }));
    }
  }
  return placementOf({
    evidence: [
      ...statedEvidence({ workspace: row.workspace }),
      ...tagged,
      ...placer.addressEvidence({ values: row.prUrls }),
      ...destinations,
    ],
    why: "it states no workspace:, declares no context=, names no pull request and sends to no Slack destination",
  });
}

/**
 * The finding a record is when one of its addresses is a link the URL parser would rewrite: where it points cannot
 * be told, so its other addresses never place the record alone.
 *
 * @returns the finding, naming each such address
 */
function repairedFinding({ repaired }: { repaired: readonly string[] }): WorkspacePlacement {
  const named = repaired.map((value) => JSON.stringify(value)).join(" and ");
  return { kind: "unplaced", why: `its address ${named} is spelt as a link the parser would rewrite (NOT MEASURED)` };
}

/**
 * Where a hand step belongs: its stated context, the addresses it cites, opens or sends the owner to, the board row it
 * unblocks (`--row`) and the ask its link opens.
 *
 * @param step the hand step
 * @param rows every board row, for the row the step unblocks and the ask its link opens
 * @param placer the organisation's address readers
 * @returns the placement
 */
export function handPlacement({
  placer,
  step,
  rows,
}: {
  placer: WorkspacePlacer;
  step: Pick<HandStep, "cites" | "context" | "row" | "url" | "where">;
  rows: readonly PlacedBoardFields[];
}): WorkspacePlacement {
  let stated: Workspace | undefined;
  if (step.context !== undefined) {
    stated = workspaceOfContext({ context: step.context });
  }
  const addresses = [...step.cites];
  if (step.url !== undefined) {
    addresses.push(step.url);
  }
  if (step.where !== undefined) {
    addresses.push(step.where);
  }
  const repaired = placer.repairedAddresses({ values: addresses });
  if (repaired.length > 0) {
    return repairedFinding({ repaired });
  }
  const slugs = new Set<string>();
  if (step.row !== undefined) {
    slugs.add(step.row);
  }
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind === "ask") {
    slugs.add(target.id);
  }
  // Every row carrying a joined slug, as the act join reads them: a repeated slug pools, never first-wins.
  const joined = rows
    .filter((row) => slugs.has(row.slug))
    .flatMap((row) => joinedEvidence({ placement: boardRowPlacement({ placer, row }), slug: row.slug }));
  return placementOf({
    evidence: [...statedEvidence({ workspace: stated }), ...placer.addressEvidence({ values: addresses }), ...joined],
    why: "it was posted with no --context, cites no address, unblocks no placed board row and opens no placed ask",
  });
}

/**
 * Whether a hand row may absorb the ask it opens, so the ask draws no row of its own: only when the ask is placed
 * with no mark and the hand row is drawn in exactly the views the ask is. A finding ask always keeps its own row,
 * under its own mark and in its own finding count, beside the hand row drawing the same decision; an ask placed in
 * one workspace keeps its row there when the hand row is drawn elsewhere.
 *
 * @param ask the board row the step opens
 * @param placement the hand row's own placement
 * @param placer the organisation's address readers, which place the ask
 * @returns true when drawing the ask only under the hand row hides no finding and no row from any view
 */
export function handAbsorbsAsk({
  ask,
  placement,
  placer,
}: {
  ask: PlacedBoardFields;
  placement: WorkspacePlacement;
  placer: WorkspacePlacer;
}): boolean {
  const asked = boardRowPlacement({ placer, row: ask });
  if (findingLabel({ placement: asked }) !== undefined) {
    return false;
  }
  return WORK_CONTEXTS.every(
    (context) => shownInContext({ context, placement: asked }) === shownInContext({ context, placement }),
  );
}

/**
 * A placement as a fold key: the workspace a placed record is in, or the kind of finding it is, and the mark it
 * wears. Two acts folded into one card are drawn under the newest one's placement, so a marked act never folds
 * into an unmarked one, nor into one marked over a different address.
 *
 * @returns the key
 */
export function placementFoldKey({ placement }: { placement: WorkspacePlacement }): string {
  let where: string = placement.kind;
  if (placement.kind === "placed") {
    where = `placed:${placement.workspace}`;
  }
  const mark = findingLabel({ placement });
  if (mark === undefined) {
    return where;
  }
  return `${where} · ${mark.title}`;
}

/**
 * Where an autonomy act belongs: what its subject's leading ADDRESS names — a pull request, `owner/repo#n`, a
 * Slack permalink, this installation's `state:` or console, or a board row by slug — the board row its `run`
 * names, and its kind when that kind's recorder guarantees the repository.
 * The rest of a subject is prose and is never read.
 *
 * @param act the ledger row
 * @param board every board row, indexed by slug for the joins
 * @param placer the organisation's address readers
 * @returns the placement
 */
export function actPlacement({
  act,
  board,
  placer,
}: {
  act: Pick<AutonomyRow, "kind" | "run" | "subject">;
  board: BoardRowIndex<PlacedBoardFields>;
  placer: WorkspacePlacer;
}): WorkspacePlacement {
  // The leading word, with any whitespace before it kept: a padded link is one the parser would repair, so it is read
  // as written and refused, never trimmed into an address. The pattern matches every string.
  const address = /^\s*\S*/.exec(act.subject)![0];
  const repaired = placer.repairedAddresses({ values: [address] });
  if (repaired.length > 0) {
    return repairedFinding({ repaired });
  }
  const evidence: WorkspaceEvidence[] = [...placer.addressEvidence({ values: [address] })];
  const state = installationStateEvidence({ value: address });
  if (state !== undefined) {
    evidence.push(state);
  }
  const kind = actKindEvidence({ kind: act.kind });
  if (kind !== undefined) {
    evidence.push(kind);
  }
  const slugs = new Set([address]);
  if (act.run !== undefined) {
    slugs.add(act.run);
  }
  for (const row of rowsCarrying({ index: board, slugs })) {
    evidence.push(...joinedEvidence({ placement: boardRowPlacement({ placer, row }), slug: row.slug }));
  }
  return placementOf({
    evidence,
    why: "its subject is no pull request, Slack message, state: path, console URL or placed board row, its run names none, and its kind guarantees no repository",
  });
}

/**
 * Whether a row's workspace waits on the board: a hand step or an act is placed partly by the board row it joins,
 * so until the board has been read its placement is not yet known, and it is drawn in neither workspace and
 * counted in no figure rather than drawn by the default rule as a finding it may not be.
 * A board that could not be read is different: nothing will place the row, so it is a finding like any other.
 * A card stopping the owner's work waits too, though both views draw one: drawn before its board row is read it would
 * name a provisional owner, the self workspace by the default rule, in both views, and its board row may say team.
 * Absent for the board's first read is the honest transient; named as the wrong workspace's is the defect.
 *
 * @param row the row, by its register
 * @param board the board reading its placement joins
 * @returns true while the board is still loading and the row is a hand step or an act
 */
export function placementWaits({
  row,
  board,
}: {
  row: { readonly record: { readonly kind: string } };
  board: LiveState<unknown>;
}): boolean {
  return board.phase === "loading" && (row.record.kind === "hand" || row.record.kind === "act");
}

/**
 * A hand step or act's placement over the board reading it joins: a board that could not be read leaves it a
 * finding the default rule places and marks, since the row it joins may state a workspace its other evidence contradicts
 *. Placed by what it carries alone, it would be drawn confidently in one.
 *
 * @param placement what the record's own evidence and the rows read gave
 * @param board the board reading its placement joins
 * @returns the placement, or a NOT MEASURED finding when the board could not be read
 */
export function joinedPlacement({
  placement,
  board,
}: {
  placement: WorkspacePlacement;
  board: LiveState<unknown>;
}): WorkspacePlacement {
  if (board.phase !== "not-measured") {
    return placement;
  }
  // The board read's own reason is the warning beside the finding, never set inside its hover.
  return {
    kind: "unplaced",
    warning: { lead: "The board it joins could not be read", subject: "the board it joins", why: board.why },
    why: "the board it joins could not be read, so a row stating its workspace may be hidden (NOT MEASURED)",
  };
}

/**
 * A register as a count over the context shows it: loading while the board its rows are placed by is, because a
 * count of rows drawn before their placement is known would mix the two workspaces.
 *
 * @param state the register's own reading
 * @param board the board reading its rows' placement joins
 * @returns the register's reading, or loading until the board is read
 */
export function placedRegister<T>({ state, board }: { state: LiveState<T>; board: LiveState<unknown> }): LiveState<T> {
  if (board.phase === "loading") {
    return { phase: "loading" };
  }
  return state;
}
