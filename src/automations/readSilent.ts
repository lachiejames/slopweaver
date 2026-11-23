/**
 * The Automations page's silent rows: which scheduled rows have gone quiet, one per recipe id, read over the stores
 * `./read.ts` already opened. Split out of that reader along the one seam it has — this half judges silence, the
 * rest folds cards.
 */
import type { RecipeDefinition } from "../live/automation/definition.js";
import type { RecipeDefinitionRuns } from "../live/automation/definitionRunStore.js";
import type { ProcessAlive } from "../live/automation/holderLiveness.js";
import { silentRowsAmong, stampedOutcomeOf, storedSlotAttempt } from "../live/automation/silentRowReader.js";
import type { SilentRow } from "../live/automation/silentRows.js";
import type { RecipeSlotAttempt } from "../live/automation/slotAttempt.js";
import { explainSilentRows } from "../live/automation/supervisorStops.js";

/**
 * The silent rows by recipe, judged over the definitions, run stamps and firings the caller already read — none when
 * the run stamps would not read, which the caller has already said. A stopped row's reason is read off the
 * supervisor's tick ledger once for every row, and that ledger failing to read is said into `issues` as well.
 *
 * @param runsRead whether the run stamps read at all; when not, no row can be judged quiet
 * @param attempts every firing on disk by recipe, for the outcome a run stamp describes
 * @param issues where an unreadable tick ledger is said
 * @param processAlive the probe a held firing's holder is checked with
 * @returns the silent row each recipe id's card reads
 */
export function silentAmong({
  definitions,
  runs,
  runsRead,
  attempts,
  home,
  issues,
  nowIso,
  processAlive,
}: {
  definitions: readonly RecipeDefinition[];
  runs: RecipeDefinitionRuns;
  runsRead: boolean;
  attempts: ReadonlyMap<string, readonly RecipeSlotAttempt[]>;
  home: string;
  issues: string[];
  nowIso: string;
  processAlive: ProcessAlive;
}): Map<string, SilentRow> {
  if (!runsRead) {
    return new Map();
  }
  const among = silentRowsAmong({
    definitions,
    nowIso,
    processAlive,
    runs,
    // The current firing's hold is read off the canonical file the scheduler reads, not `attempts`: that scan
    // takes any body in the directory, and a hold read from one the scheduler never sees would read running.
    slotAttemptFor: ({ recipeId, slotIso }) => storedSlotAttempt({ home, recipeId, slotIso }),
    stampedOutcomeFor: ({ recipeId, run }) => {
      const mine = attempts.get(recipeId);
      if (mine === undefined) {
        return null;
      }
      return stampedOutcomeOf({ attempts: mine, run });
    },
  });
  const explained = explainSilentRows({ home, rows: among.silent });
  if (explained.ledgerIssue !== null) {
    issues.push(explained.ledgerIssue);
  }
  return silentByRecipe({ rows: explained.rows });
}

/**
 * One silent row per recipe id, the way each card looks its own up. Definitions may share an id, so a row nobody
 * holds is never displaced by a duplicate's held one: a held firing reads `running`, and one definition's must not
 * paint another's stop running. Otherwise the later row wins, as it always has.
 *
 * @param rows every silent row this read judged, in definition order
 * @returns the row each recipe id's card reads
 */
export function silentByRecipe({ rows }: { rows: readonly SilentRow[] }): Map<string, SilentRow> {
  const byRecipe = new Map<string, SilentRow>();
  for (const row of rows) {
    const kept = byRecipe.get(row.recipeId);
    const keepsUnheld = kept?.currentSlotHold === null && row.currentSlotHold !== null;
    if (!keepsUnheld) {
      byRecipe.set(row.recipeId, row);
    }
  }
  return byRecipe;
}
