/**
 * `codex reset --at-limit` — the effectful edge of the fleet claim the chair's tick runs every pass
 * (`../../../supervisor/scratch/fleetReadings.ts`). It reads the register and every unpaused Codex store in ONE
 * batch, hands the pure planner (`../../../codex/resetFleet.ts`) what it needs, and runs each chosen store through
 * the same single-store path `--plan` uses (`./resetOne.ts`), one at a time, under the caller's reset lock — each
 * re-read straight before its claim, so a store an earlier claim this run already refilled is never claimed again.
 *
 * It prints one line per store and nothing else reaches them: a claim that fails is journalled, and the
 * `codex-reset-failed` monitor fired straight after it in the tick raises the one floating note.
 */
import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { storeAtLimit } from "../../../codex/resetEvidence.js";
import {
  type CodexResetFleetCandidate,
  type CodexResetFleetDecision,
  planCodexResetsAtLimit,
} from "../../../codex/resetFleet.js";
import { readCodexResetJournal } from "../../../codex/resetJournalStore.js";
import { RESET_RUN_BUDGET_MS } from "../../../codex/resetLock.js";
import { type CodexResetRunResult, fleetResetExit, resetResultLine } from "../../../codex/resetResult.js";
import { logger } from "../../../lib/logger.js";
import { plansForProvider, unpausedPlansFor } from "../../../plans/register.js";
import type { CodexThresholds } from "../../../plans/thresholds.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { type ResetOneDeps, resetOne } from "./resetOne.js";

/**
 * One store read again straight before its claim. The batch read the planner judged is a snapshot from before any
 * claim this run made, and two stores of one account the planner could not pair — no account id, no address — would
 * otherwise both be claimed off it: the first refill leaves the second reading below its limit here.
 *
 * @param codexHome the store to read
 * @returns its live read now
 */
function rereadBeforeClaim({ codexHome }: { codexHome: string }): CodexAccountLive {
  const [live] = readCodexAccountsLive({ codexHomes: [codexHome], readAtIso: new Date().toISOString() });
  return live!;
}

/**
 * Claim one store the planner chose, or say why not: deferred once the run has spent its lock budget, so a run
 * never outlives the lease that keeps a second run out, and nothing when the re-read finds a
 * store an earlier claim this run already refilled.
 *
 * @param decision the planner's run decision
 * @param deps the stores the run reaches
 * @param home the state home
 * @param startedMs when this run asked for the lock — at or before the lease began, so the budget never runs past it
 * @param thresholds the register's Codex bars the planner judged with, so the re-read is judged by the same bar
 * @returns the claim's result, or undefined when nothing was sent and nothing failed
 */
async function claimDecided({
  decision,
  deps,
  home,
  startedMs,
  thresholds,
}: {
  decision: CodexResetFleetDecision & { kind: "run" };
  deps: ResetOneDeps;
  home: string;
  startedMs: number;
  thresholds: CodexThresholds;
}): Promise<CodexResetRunResult | undefined> {
  const { destination } = decision.candidate;
  if (Date.now() - startedMs > RESET_RUN_BUDGET_MS) {
    return {
      alias: destination.alias,
      kind: "deferred",
      reason: "this run spent its lock budget before reaching it — nothing was sent; the next tick claims it",
    };
  }
  const live = rereadBeforeClaim({ codexHome: destination.codexHome });
  if (!decision.retry && !storeAtLimit({ live, thresholds })) {
    logger.out({
      line: `codex reset: ${destination.alias} — no longer at its limit when re-read, so nothing was sent`,
    });
    return undefined;
  }
  return resetOne({
    deps,
    live,
    requestedCredit: decision.creditId,
    target: { alias: destination.alias, codexHome: destination.codexHome, home, startedMs, thresholds },
  });
}

/**
 * Run the fleet claim over one home. The caller holds the reset lock.
 *
 * @param deps the stores the run reaches
 * @param home the state home
 * @returns the exit code: 0 nothing due or every claim refilled, 4 a claim deferred, 1 anything failed
 */
export async function runCodexResetAtLimit({
  deps,
  home,
  startedMs,
}: {
  deps: ResetOneDeps;
  home: string;
  startedMs: number;
}): Promise<number> {
  const register = await deps.port.read({ home });
  if (register.isErr()) {
    logger.error({ msg: `codex reset --at-limit: ${register.error.message}` });
    return EXIT_ERROR;
  }
  const { plans } = register.value;
  const thresholds = register.value.thresholds.codex;
  for (const paused of plansForProvider({ plans, provider: "codex" }).filter((plan) => plan.paused !== undefined)) {
    logger.out({ line: `codex reset: ${paused.alias} — paused on purpose, never claimed on` });
  }
  const destinations = unpausedPlansFor({ plans, provider: "codex" }).map((plan) => ({
    alias: plan.alias,
    codexHome: plan.storeDir,
  }));
  const journal = readCodexResetJournal({ home });
  if (journal.isErr()) {
    logger.error({ msg: `codex reset --at-limit: ${journal.error.message}` });
    return EXIT_ERROR;
  }
  const lives = readCodexAccountsLive({
    codexHomes: destinations.map((destination) => destination.codexHome),
    readAtIso: new Date().toISOString(),
  });
  const candidates = destinations.map((destination, index): CodexResetFleetCandidate => ({
    destination,
    live: lives[index]!,
  }));
  const decisions = planCodexResetsAtLimit({ candidates, rows: journal.value, thresholds });
  const results: CodexResetRunResult[] = [];
  let planFailures = 0;
  for (const decision of decisions) {
    if (decision.kind === "skip") {
      logger.out({ line: `codex reset: ${decision.alias} — ${decision.reason}` });
      continue;
    }
    if (decision.kind === "fail") {
      planFailures += 1;
      logger.error({ msg: `codex reset: ${decision.alias} — ${decision.reason}` });
      continue;
    }
    const result = await claimDecided({ decision, deps, home, startedMs, thresholds });
    if (result === undefined) {
      continue;
    }
    results.push(result);
    logger.out({ line: resetResultLine({ result }) });
  }
  return fleetResetExit({ planFailures, results });
}
