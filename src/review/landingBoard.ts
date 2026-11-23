/**
 * The board row a landing row joins to, and the ONE reading of whether that row is still live.
 *
 * Three readers ask the same question of the same joined row: the register (`../cli/commands/github/
 * landingRegister.ts`), which must not file a second row over a branch somebody is working; the dispatch layer
 * (`./landingDispatch.ts`), which must not send a session at a draft a live row already holds; and the bump
 * seat, through the register. Two copies of "which statuses are terminal" would disagree the first time the
 * handover model grew a status, and a disagreement here is exactly a duplicate seat on one branch — so the
 * interpretation lives in this one pure module and every reader imports it.
 *
 * Pure. No I/O.
 */

import type { RunDisposition } from "../handover/boardTypes.js";
import { isTerminalDocStatus, KNOWN_STATUSES } from "../handover/doc.js";

/**
 * Whether the board already has a row for this pull request.
 *
 * The join is a STATED branch and nothing else: the doc's declared `branch:`, or the branch its run journal
 * recorded at `handover start` (`../handover/evaluate.ts`'s `statedBranches`) — the second because an ask row
 * declares none while its seat works one. `HandoverDoc.branch` exists precisely because inferring one
 * measurably failed (`../handover/doc.ts`), and name similarity is the fuzzy matching this repo forbids — so
 * a doc that stated no branch answers `none-declared`, never `none`. The owner's ruling turns on
 * this: an investigation for failing CI is spawned only when there is no row on the board, and a confident
 * false `no` is what produces duplicate work.
 */
export type LandingBoardRow =
  | {
      readonly kind: "row";
      readonly slug: string;
      readonly status: string;
      /** What the row's settlement names as its proof — often the head the settling seat left it at. */
      readonly settlementWitness?: string;
      /** The `owner/name` the row's `repo:` resolves to — a checkout's `origin`, or the slug it spells. */
      readonly repoSlug?: string;
      /**
       * The run behind the row, as its journal reads (`../handover/boardTypes.ts`'s `runDisposition`). A row's
       * authored `ready` survives a seat starting on it, so this — not the status — says nobody is on it.
       * Absent when the reader did not look, which `./landingClosure.ts` reads as NOT proven unattended.
       */
      readonly run?: RunDisposition["kind"];
      /**
       * Present only on an `active` run whose seat closed at rest between turns: `wake` when the park named a
       * wake (`handover wake` reseats it once due), `no-wake` when nothing will ever reseat it unasked. Only
       * these two words cross into the landing document — never the parked checkpoint itself, which carries
       * saved screen lines and worktree detail a recorded reading has no business holding.
       */
      readonly parked?: LandingBoardPark;
    }
  | { readonly kind: "none-declared"; readonly why: string };

/** Whether a seat-closed park will be reseated by `handover wake` (`wake`) or by nothing (`no-wake`). */
export type LandingBoardPark = "wake" | "no-wake";

/**
 * The park word a run's disposition earns, or undefined when the run is not an active, seat-closed park.
 *
 * A `waiting-on-owner` run is never one, even when it stopped between turns: it is parked on the owner, and a reseat
 * would put a session back inside a question the owner has not answered.
 *
 * @param run the run's disposition as `../handover/boardTypes.ts` folds it
 * @returns `wake` or `no-wake`, or undefined for every other disposition
 */
export function landingBoardPark({ run }: { run: RunDisposition }): LandingBoardPark | undefined {
  if (run.kind !== "active" || run.parked === undefined) {
    return undefined;
  }
  return run.parked.wake === undefined ? "no-wake" : "wake";
}

/**
 * Whether a joined row is live but ORPHANED: its run is active, its seat closed at rest, and no wake will ever
 * reseat it — the shape that holds a row as `waiting` indefinitely with nobody on it.
 *
 * Only this exact shape escapes a draft's board hold. An open seat, a wake-armed park, a run parked on the owner, an
 * unread run and a terminal row all answer false, so nothing here can seat a second session beside a live one.
 *
 * @param boardRow the row the read joined to the pull request's head branch
 * @returns true only for a non-terminal row whose active run is parked with no wake
 */
export function boardRowNeedsReseat({ boardRow }: { boardRow: LandingBoardRow }): boolean {
  return (
    boardRow.kind === "row" &&
    !boardRowIsTerminal({ status: boardRow.status }) &&
    boardRow.run === "active" &&
    boardRow.parked === "no-wake"
  );
}

/**
 * Whether a board row's declared status means the work will not continue.
 *
 * The board row arrives as an unrestricted string, so the status is MATCHED against the declared set rather
 * than asserted into it: a status this build does not know is treated as live, which holds a registration
 * back rather than duplicating a row somebody is working.
 *
 * @param status the status the joined board row declares
 * @returns whether it is one of the three terminal statuses
 */
export function boardRowIsTerminal({ status }: { status: string }): boolean {
  const known = KNOWN_STATUSES.find((candidate) => candidate === status);
  return known !== undefined && isTerminalDocStatus(known);
}

/**
 * The sentence naming a LIVE board row that already holds this branch, or undefined when none does.
 *
 * Live means declared and not terminal, an unknown status included ({@link boardRowIsTerminal}). A terminal
 * row holds nothing here: whether it ended at THIS head is the register's separate question, because an
 * ending is about one commit and a live row is about the branch.
 *
 * @param boardRow the row the read joined to this pull request's head branch
 * @returns the sentence naming the row's slug and status, or undefined when no live row holds the branch
 */
export function liveBoardHold({ boardRow }: { boardRow: LandingBoardRow }): string | undefined {
  if (boardRow.kind !== "row" || boardRowIsTerminal({ status: boardRow.status })) {
    return undefined;
  }
  return `${boardRow.slug} already holds this branch and is ${boardRow.status}`;
}
