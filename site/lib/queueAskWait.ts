/**
 * Who an ask is really waiting on, as the Queue ranks it: a colleague, the fleet, or nobody because the owner already ruled.
 */
import type { BoardRow, HandStep } from "../components/live/read";
import { queueLinkTarget } from "./queueLink";
import type { WorkspacePlacement } from "./workspacePlacement";

/**
 * Whether an ask ranks as blocking a colleague: placed in the team's workspace by something a colleague is on — a pull
 * request, a Slack, Linear or Vanta address — never by a stated `workspace:` alone. A stated workspace says whose work
 * it is, which the view filter and the mark read; it names nobody waiting. Stating `team` on an inbox-archive ask must
 * not file it under "Blocking a colleague" (whether an ask blocks the fleet is the question the owner reads first).
 *
 * @param placement the ask's placement (`boardRowPlacement`)
 * @returns true when an address on the row places it in the team's workspace
 */
export function askTeamFacing({ placement }: { placement: WorkspacePlacement }): boolean {
  if (placement.kind !== "placed" || placement.workspace !== "team") {
    return false;
  }
  return placement.by.some(
    (evidence) => evidence.workspace === "team" && evidence.source !== "stated" && evidence.source !== "joined-stated",
  );
}

/**
 * When the owner ruled on the ask a hand step opens, while every board row under that slug reads `already-ruled` — the
 * step then waits on a seat, not on the owner, and so must not lead the Queue.
 *
 * Every matching row, not the first: two rows may share a slug, and one still waiting on the owner keeps the step theirs.
 *
 * @param step the hand step
 * @param rows every board row, unfiltered
 * @returns the latest ruling instant, or `undefined` when the step opens no ask or any row under it is not ruled
 */
export function ruledAskIso({ step, rows }: { step: HandStep; rows: readonly BoardRow[] }): string | undefined {
  const target = queueLinkTarget({ url: step.url });
  if (target?.kind !== "ask") {
    return undefined;
  }
  const matching = rows.filter((row) => row.slug === target.id);
  const ruled = matching.filter((row) => row.ownerWait === "already-ruled");
  const instants = ruled.flatMap((row) => (row.ruledSinceQuestionIso === undefined ? [] : [row.ruledSinceQuestionIso]));
  if (matching.length === 0 || instants.length !== matching.length) {
    return undefined;
  }
  return instants.toSorted((a, b) => a.localeCompare(b)).at(-1);
}
