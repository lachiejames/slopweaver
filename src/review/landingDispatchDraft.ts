/**
 * The DRAFT half of a dispatch verdict — whether a draft of the owner's is held by a seat already on its branch, or is
 * the `finish-or-card-close` act a session picks up.
 *
 * Split out of `./landingDispatch.ts` beside `./landingDispatchAsk.ts` and `./landingDispatchGate.ts`: the ladder
 * there decides that a row is a draft, and this module answers the one question a draft turns on — is anybody
 * actually on it. MEASURED (`github landing --repo <self> --include-drafts`): four of the owner's drafts sat red
 * for one to four days, two of them `waiting` on board rows whose runs were parked at rest with the seat closed
 * and no wake, which nothing ever reseats.
 *
 * Pure. No network, no clock, no filesystem.
 */

import { boardRowNeedsReseat, liveBoardHold } from "./landingBoard.js";
import type { DispatchDecision, DispatchInputs } from "./landingDispatch.js";

/**
 * The verdict for a draft: `waiting` on the live board row that already holds its branch, otherwise
 * `finish-or-card-close` — and `finish-or-card-close` too over a live row whose seat closed at rest with no
 * wake, its brief naming that row's reseat, because nothing else ever reseats one.
 *
 * A TERMINAL row holds nothing — `done`, `cancelled` or `rejected` ended somebody's work, and the draft is
 * still open, so it gets the act. An unrecognised status stays live (`./landingBoard.ts`), holding the row
 * back rather than seating a second session on a branch somebody may be working. So does an open seat, a
 * wake-armed park (`handover wake` owns that reseat) and a run parked on the owner.
 *
 * The `why` is the whole brief a seated session gets (`../cli/commands/github/landingRegister.ts`), so it names
 * every piece of evidence to read, both ways the work can end, and the two things it must never do: close the
 * pull request itself, or treat the draft's age as evidence. A draft of anybody else's is `outside-the-set`
 * before any of that — {@link DispatchInputs.authoredByOwner}.
 *
 * @returns the draft's verdict
 */
export function draftVerdict({ inputs }: { inputs: DispatchInputs }): DispatchDecision {
  const { boardRow, state } = inputs;
  if (!inputs.authoredByOwner) {
    return {
      kind: "outside-the-set",
      why: `it is still a draft, and it is ${state.authorLogin}'s — finishing or closing it is theirs, not a session's`,
    };
  }
  if (boardRow.kind === "row" && boardRowNeedsReseat({ boardRow })) {
    return finishOrCardClose({
      board:
        `it is a draft and ${boardRow.slug} holds its branch, but its run is parked at rest with the seat ` +
        `closed and no wake, so nothing reseats it — reseat that row with \`slopweaver cmux spawn ${boardRow.slug}\`, ` +
        "never a second row",
      inputs,
    });
  }
  const hold = liveBoardHold({ boardRow });
  if (hold !== undefined) {
    return { kind: "waiting", why: `it is a draft, and ${hold} — that seat finishes it` };
  }
  const board =
    boardRow.kind === "row"
      ? `it is a draft and its only board row, ${boardRow.slug}, is ${boardRow.status}`
      : "it is a draft and no board row states its branch";
  return finishOrCardClose({ board, inputs });
}

/**
 * The `finish-or-card-close` act with its whole brief, opened by the clause saying where the draft stands.
 *
 * @param board the opening clause: the draft's board standing, and who acts on it
 * @returns the act verdict
 */
function finishOrCardClose({ board, inputs }: { board: string; inputs: DispatchInputs }): DispatchDecision {
  return {
    kind: "act",
    verdict: "finish-or-card-close",
    why:
      `${board} — read the linked Linear ticket's current state, look for a merged pull ` +
      `request that supersedes it, and read the branch at ${inputs.state.headOid.slice(0, 7)}; if the work is still ` +
      "wanted, finish it unasked: clear CodeRabbit, make the required checks green, then undraft it; if the " +
      "evidence says it is dead, record a shaped card proposing the close with `handover ask --action` and " +
      "never close it yourself — its age is never evidence either way",
  };
}
