/**
 * Whether a relay row's `summary` still rebuilds to the digest its turn committed to — the relay-words guard's test for
 * a summary a hand edit CHANGED (`./relayWordsJudge.ts`).
 *
 * The turn file stores `digest`: the sha256 `../talk/relayDraftDigest.ts` took over the ask the row was registered
 * with and everything that ask was bound to. That stored hash is the historical commitment, so a changed summary is
 * judged against it rather than by re-composing the ask with today's composer, which may have moved on while turns
 * written by older checkouts still sit in the one shared home.
 *
 * ## What it can rebuild, and the residue it cannot
 *
 * Every bound field but two is on the turn record: the picture, the offer, the ordered other cards, the
 * discuss-first record and whether the heard words were cut. The workspace is not, so it is read off the row's own
 * `workspace:`/`workspaceBecause:` lines, before and after the write. Whether the ask quoted every word is not
 * recorded either, so both forms are tried and the hash decides. The candidate ruling a relay can carry is on
 * neither the turn nor the row, so a summary whose relay carried one never rebuilds here: a restore of such a row is
 * refused and goes through the hatch. That direction is the safe one — a refusal costs a retry with the hatch, while
 * a guessed rebuild would let a reword through.
 *
 * Pure: values in, a boolean out.
 */
import type { StatedWorkspace } from "../handover/workspace.js";
import type { DiscussFirstRecord } from "../talk/discussFirst.js";
import { type DigestBound, draftDigest } from "../talk/relayDraftDigest.js";
import type { TurnRecord } from "../talk/relayStore.js";

/** The bound fields a turn record holds, in the draft's own form: a stored `null` is the draft's `undefined`. */
function boundFromTurn({ turn, workspace }: { turn: TurnRecord; workspace: StatedWorkspace | undefined }): DigestBound {
  // `freshTurnOf` stores an absent discuss-first record as `null`; the draft carried `undefined`.
  let discussFirst: DiscussFirstRecord | undefined;
  if (turn.discussFirst !== null && turn.discussFirst !== undefined) {
    discussFirst = turn.discussFirst;
  }
  let alsoAnswers: readonly string[] = [];
  if (turn.alsoAnswers !== undefined) {
    alsoAnswers = turn.alsoAnswers;
  }
  return {
    alsoAnswers,
    candidateVerdict: undefined,
    discussFirst,
    heardTailCut: turn.heardTailCut,
    offered: turn.offered,
    // The digest never reads the triage ruling: the ask text already spells it.
    triageRuling: undefined,
    workspace,
  };
}

/**
 * Every workspace binding worth trying, each once: none, and whichever the row stated before and after the write.
 *
 * @param stated the workspace the row stated before the write and after it, each `undefined` when it stated none
 * @returns the distinct candidates, `undefined` first
 */
export function workspaceCandidates({
  stated,
}: {
  stated: readonly (StatedWorkspace | undefined)[];
}): readonly (StatedWorkspace | undefined)[] {
  const candidates: (StatedWorkspace | undefined)[] = [undefined];
  for (const one of stated) {
    const seen = candidates.some(
      (known) =>
        known !== undefined && one !== undefined && known.workspace === one.workspace && known.because === one.because,
    );
    if (one !== undefined && !seen) {
      candidates.push(one);
    }
  }
  return candidates;
}

/**
 * Whether a summary rebuilds to the digest its turn stored, under any binding the turn and the row leave open.
 *
 * @param summary the row's `summary` after the write
 * @param turn the relay turn the row's anchor names
 * @param workspaces the workspace bindings to try ({@link workspaceCandidates})
 * @returns true when one complete rebuild equals the stored digest
 */
export function summaryRebuilds({
  summary,
  turn,
  workspaces,
}: {
  summary: string;
  turn: TurnRecord;
  workspaces: readonly (StatedWorkspace | undefined)[];
}): boolean {
  // A quote that carried every word digests with no whole-heard hash; a cut one binds every word as well.
  const wholeHeardForms: readonly (string | undefined)[] = [undefined, turn.heard];
  return workspaces.some((workspace) =>
    wholeHeardForms.some(
      (wholeHeard) =>
        draftDigest({ ask: summary, bound: boundFromTurn({ turn, workspace }), picture: turn.picture, wholeHeard }) ===
        turn.digest,
    ),
  );
}
