/**
 * Whether a firing killed by a signal holds its row — the one exception to "a row that fails once is paused".
 *
 * A failure hold exists so a BROKEN row stops firing to fail the same way (`./failureHold.ts`). A firing whose own
 * `automation run-due` received SIGTERM, SIGINT or SIGHUP did not fail on its own evidence: something outside it
 * ended it, so the row is not shown broken. Holding on that left the hourly worktree prune off for twelve hours on one
 * killed firing, every later slot logging `not due`, until a board row was settled by hand. So a first kill retires
 * its firing and stamps the schedule past it exactly as any death does, and the NEXT slot fires with no hold and no
 * finding. A row killed on two consecutive stamped firings is no longer one outside event, so the second kill holds
 * it as every other death does.
 *
 * What this does NOT give, stated rather than discovered: the slot ledger is keyed by row AND slot (`./slotLedger.ts`),
 * so it stops two takes of ONE firing, never a firing that runs past the next slot overlapping that next one. A row
 * whose effect must never run twice at once carries its own lock — the worktree prune's apply lock
 * (`cli/commands/worktree/pruneApplyLock.ts`), where a second apply steps aside — and this grace changes neither. Two
 * such overlapping firings killed together can each read the other's death as not yet stamped and both hold nothing;
 * the next slot then fires, and a kill there holds.
 *
 * The previous firing is read off the row's last stamped run, whose `failureCause` a dead letter opens with its
 * reason and a later stamped success clears (`./definitionRunStore.ts`). PURE.
 */
import type { RecipeDefinitionRun } from "./definitionRunStore.js";
import type { RecipeSlotDeathReason } from "./slotAttempt.js";

/** The death reason this grace applies to, as `./slotAttempt.ts` names it. */
const SIGNAL_DEATH: RecipeSlotDeathReason = "KILLED_BY_SIGNAL";

/**
 * Whether this death holds the row.
 *
 * @param reason why this firing died
 * @param previous the row's last stamped run before this death is stamped, or `null` when it never ran; a runs file
 *   that would not read is `"unreadable"`, and then the death holds, since an unread history is never read as clean
 * @returns `true` when the row is held on this death, `false` when the next slot fires instead
 */
export function signalDeathHolds({
  reason,
  previous,
}: {
  readonly reason: RecipeSlotDeathReason;
  readonly previous: RecipeDefinitionRun | null | "unreadable";
}): boolean {
  if (reason !== SIGNAL_DEATH) {
    return true;
  }
  if (previous === "unreadable") {
    return true;
  }
  if (previous?.failureCause === undefined) {
    return false;
  }
  // The reader keeps any string, so a bare reason with no detail after it is still the same death.
  const cause = previous.failureCause;
  return cause === SIGNAL_DEATH || cause.startsWith(`${SIGNAL_DEATH}:`);
}
