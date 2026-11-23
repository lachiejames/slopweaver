/**
 * The one sidebar line under a spawned workspace's title, composed from the plan.
 *
 * Split from `./spawn.ts` on size alone; the measurement and the owner rulings that decided what the line
 * may carry are on the function itself.
 */

import type { VisibleSessionPlan } from "./plan.js";

/**
 * The cmux `--description` text for a workspace, or `undefined` when there is nothing worth the space.
 *
 * The description renders directly under the title in the sidebar and wraps rather than truncating, so it is
 * the most expensive line on the row — measured, the old `id: <slug> · spawned: <iso>` cost TWO
 * wrapped lines on every handover row to say the slug the title already said, plus a millisecond timestamp
 * nothing renders relatively and nothing in this repository ever reads back. The owner's judgement of it:
 * _"a less readable duplicate of the title"_. So both halves are gone, and what is left is only what the
 * title cannot carry:
 *
 * - **That the row is a SPAWNED session**, when it is one. This is what the colour cannot say: a colour on a
 *   row means it is one of the three always-on surfaces, and the absence of one is not by itself a claim that
 *   anything opened this row on purpose. The line is kept for spawned rows
 *   because it was once dropped for duplicating the title, not because the row had nothing left to say — the line was dropped because it duplicated the title, not because the row had
 *   nothing left to say. The three standing surfaces omit it: they are tinted, so it would be the duplication
 *   that got the old line removed.
 * - **The raw addressing id, but only when the title does not already contain it.** For a handover spawn the
 *   title IS the slug (`cmux-sidebar-improvements handover`), so the id is pure duplication and is dropped.
 *   For an ask or review session the title is the question and the id is the Slack coordinate
 *   (`ask-<channel>-<ts>`) — the only way back to the thread from the sidebar, so it stays.
 * - **Who the session is answering**, when there is one addressed user.
 *
 * With neither, the description is omitted entirely and the row is two lines shorter. The workspace's
 * `workspace:N` ref is NOT here — it goes to its own pill, see `./spawn.ts`'s `publishOpeningSidebar`, because a pill
 * is the one per-workspace field a tool may key for itself and it leaves this line free for the id.
 *
 * @param plan the already-decided plan carrying the fields to compose
 * @returns the composed description text, or `undefined` when every part would duplicate the title
 */
export function composeWorkspaceDescription({ plan }: { plan: VisibleSessionPlan }): string | undefined {
  const parts: string[] = [];
  const { role } = plan;
  // A plan names its role only when its planner knew one, and the three standing surfaces always do, so a
  // plan with no role is a spawned session exactly as one naming `session` is.
  if (role === undefined || role === "session") {
    parts.push("spawned session");
  }
  if (!plan.workspaceTitle.includes(plan.workspaceName)) {
    parts.push(plan.workspaceName);
  }
  if (plan.respondingToHandle !== undefined) {
    parts.push(`for ${plan.respondingToHandle}`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}
