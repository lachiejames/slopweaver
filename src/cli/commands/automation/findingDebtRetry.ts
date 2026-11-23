/**
 * Pay the findings failed firings OWE the board (`../../../live/automation/findingDebt.ts`), once per
 * `automation run-due` tick.
 *
 * A held row whose finding did not register cannot fire again to retry it, so this is the retry: every tick
 * re-runs each owed `handover register` argv and clears the debt only once the board holds the row — whatever an
 * exit code said, because a mirror failure exits non-zero over a row it wrote. A debt still owed is a FAILED
 * outcome, so the tick exits non-zero and a `run-due || alert` caller hears it every tick until it is paid.
 * A dry run retries nothing and clears nothing, but reads everything: an owed debt and an orphaned hold fail it too.
 *
 * When the debt itself did not write, the row's own failure hold still names the finding, so a standing hold on
 * a slug no board row carries — live or archived — and no debt owes is a FAILED outcome too: the hold is the
 * durable trace, read every tick, rather than a diagnostic gone with the process that printed it. Beneath the owner's own
 * hold, which names none, the trace is the failure's own row on the slot ledger, settled before the finding path ran.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import {
  clearFindingDebt,
  type FindingDebt,
  findingOnBoard,
  readFindingDebts,
  whyNotOnBoard,
} from "../../../live/automation/findingDebt.js";
import { ownerHeldFailures } from "../../../live/automation/ownerHeldFailures.js";
import { readAutomationRetirements, retiredRecipeIds } from "../../../live/automation/retirementStore.js";
import type { RecipeRunDueDeps, RowOutcome } from "./rowRunners.js";
import { seatGiveBacks } from "./runDueAttempt.js";
import { type FailureHoldDeps, registerFinding } from "./slotFailureHold.js";
import type { SlotRunDeps } from "./slotRun.js";

/** One outcome line for the report, never a run of the row itself. */
function owedOutcome({ failed, line, recipeId }: { failed: boolean; line: string; recipeId: string }): RowOutcome {
  return { detail: [], exitCode: null, failed, line, ran: false, recipeId };
}

/** Clear a paid debt, saying so — a clear that did not write is still owed on disk, so it fails. */
function paid({
  finding,
  home,
  line,
  recipeId,
}: {
  finding: string;
  home: string;
  line: string;
  recipeId: string;
}): RowOutcome {
  const cleared = clearFindingDebt({ finding, home });
  if (cleared.isErr()) {
    return owedOutcome({
      failed: true,
      line: `${line}, but its debt did not clear (${cleared.error.message})`,
      recipeId,
    });
  }
  return owedOutcome({ failed: false, line, recipeId });
}

/** Retry one owed finding — or, on a dry run, only say what a retry would do — and report how it stands. */
async function retryDebt({
  debt: { argv, finding, recipeId },
  deps,
  dryRun,
  home,
}: {
  readonly debt: FindingDebt;
  readonly deps: Pick<FailureHoldDeps, "register">;
  readonly dryRun: boolean;
  readonly home: string;
}): Promise<RowOutcome> {
  const head = `recipe ${recipeId} · owed finding ${finding}`;
  const onBoard = findingOnBoard({ finding, home });
  if (dryRun) {
    const line = onBoard ? `${head} is on the board — would be paid` : `${head} is owed — would be retried`;
    return owedOutcome({ failed: !onBoard, line, recipeId });
  }
  if (onBoard) {
    return paid({ finding, home, line: `${head} is on the board — paid`, recipeId });
  }
  const exited = await registerFinding({ argv, deps });
  if (findingOnBoard({ finding, home })) {
    return paid({ finding, home, line: `${head} registered on retry`, recipeId });
  }
  const why = whyNotOnBoard({ exited });
  return owedOutcome({
    failed: true,
    line: `${head} still could not be registered (${why}) — the next run-due retries it`,
    recipeId,
  });
}

/**
 * A standing failure hold whose finding is on no board row and owed no retry — the debt did not write either, so
 * the hold itself is the durable trace left, and it fails every tick until a row by that slug exists.
 */
function orphanedHolds({
  debts,
  definitions,
  home,
}: {
  debts: ReadonlySet<string>;
  definitions: readonly RecipeDefinition[];
  home: string;
}): RowOutcome[] {
  return definitions.flatMap(({ hold, recipeId }) => {
    const finding = hold?.finding;
    if (finding === undefined || hold?.clearedBy !== null || debts.has(finding) || findingOnBoard({ finding, home })) {
      return [];
    }
    const line =
      `recipe ${recipeId} · HELD on finding ${finding}, which is on no board row and owed no retry — register ` +
      `a row by that slug by hand (slopweaver handover register ${finding} …) and the hold reads it`;
    return [owedOutcome({ failed: true, line, recipeId })];
  });
}

/**
 * A failure beneath the owner's own hold whose finding is on no board row and owed no retry — read back off the slot
 * ledger, because the owner's hold names no finding and the debt did not write either (`ownerHeldFailures.ts`).
 */
function unseenBeneathOwnerHold({
  definitions,
  home,
  owed,
}: {
  definitions: readonly RecipeDefinition[];
  home: string;
  owed: ReadonlySet<string>;
}): RowOutcome[] {
  const { failures, unread } = ownerHeldFailures({ definitions, home });
  const lost = failures
    .filter(({ finding }) => !owed.has(finding) && !findingOnBoard({ finding, home }))
    .map(({ attempt, finding, recipeId, slotIso }) => {
      const line =
        `recipe ${recipeId} · slot ${slotIso} attempt ${String(attempt)} failed beneath the owner's hold, and its ` +
        `finding ${finding} is on no board row and owed no retry — register a row by that slug by hand ` +
        `(slopweaver handover register ${finding} …)`;
      return owedOutcome({ failed: true, line, recipeId });
    });
  const notRead = unread.map((name) => {
    const line = `automation run-due · ${name} did not read, so a failure beneath an owner's hold may be unseen`;
    return owedOutcome({ failed: true, line, recipeId: "slot-attempts" });
  });
  return [...lost, ...notRead];
}

/**
 * The owed findings a tick still retries: every debt but a retired row's.
 *
 * @param debts every debt the store read
 * @param retiredIds the recipe ids this install retired
 * @returns the debts whose row is not retired, in their read order
 */
export function activeFindingDebts({
  debts,
  retiredIds,
}: {
  readonly debts: readonly FindingDebt[];
  readonly retiredIds: ReadonlySet<string>;
}): readonly FindingDebt[] {
  return debts.filter((debt) => !retiredIds.has(debt.recipeId));
}

/**
 * Retry every owed finding once, and report every failure hold left on a finding nothing owes.
 *
 * @param definitions the rows this tick judged, whose failure holds are read for an orphaned finding
 * @param deps the edge that registers
 * @param dryRun whether this tick withholds every effect — the register and the debt clear; every read still runs
 * @param home the state home whose debts and board to read
 * @returns one outcome per owed finding, per debt file that would not read and per orphaned hold, in that order
 */
export async function retryOwedFindings({
  definitions,
  deps,
  dryRun,
  home,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly deps: Pick<FailureHoldDeps, "register">;
  readonly dryRun: boolean;
  readonly home: string;
}): Promise<RowOutcome[]> {
  // A dry run withholds the register and the debt clear, never the reads: an unfiled, unowed failure fails it too.
  const read = readFindingDebts({ home });
  const { unlisted, unread } = read;
  // A retired row's failure is history, never work: its debt is not retried. A registry that will not read retries
  // NOTHING and fails the tick, since "nothing retired" would re-file a retired row's findings.
  const retirements = readAutomationRetirements({ home });
  if (retirements.isErr()) {
    const line = `automation run-due · owed findings not retried — ${retirements.error.message}`;
    return [owedOutcome({ failed: true, line, recipeId: "retirements" })];
  }
  const debts = activeFindingDebts({
    debts: read.debts,
    retiredIds: retiredRecipeIds({ retirements: retirements.value.retirements }),
  });
  const outcomes = unread.map((name) =>
    owedOutcome({
      failed: true,
      line: `automation run-due · owed finding ${name} did not read as one — its failure's finding may be on no board row`,
      recipeId: name,
    }),
  );
  // An unlisted directory hides every debt, so it fails by itself — and the orphan scan below still runs.
  if (unlisted !== null) {
    const line = `automation run-due · owed findings unknown — ${unlisted}`;
    outcomes.push(owedOutcome({ failed: true, line, recipeId: "finding-debt" }));
  }
  for (const debt of debts) {
    outcomes.push(await retryDebt({ debt, deps, dryRun, home }));
  }
  const owed = new Set([...debts.map(({ finding }) => finding), ...unread.map((name) => name.replace(/\.json$/u, ""))]);
  outcomes.push(
    ...orphanedHolds({ debts: owed, definitions, home }),
    ...unseenBeneathOwnerHold({ definitions, home, owed }),
  );
  return outcomes;
}

/**
 * A tick whose runs ledger will not read runs no row, but an owed finding needs no verdict, so it is still retried
 * and reported — the caller fails the tick either way.
 *
 * @param roster every parsed row, whose failure holds are read for an orphaned finding
 * @param why the runs ledger's own diagnostics, printed first
 */
export async function retryWithoutVerdicts({
  deps,
  dryRun,
  home,
  roster,
  why,
}: {
  readonly deps: Pick<RecipeRunDueDeps, "register" | "writeDiagnostic" | "writeOut">;
  readonly dryRun: boolean;
  readonly home: string;
  readonly roster: readonly RecipeDefinition[];
  readonly why: readonly string[];
}): Promise<void> {
  why.forEach((line) => {
    deps.writeDiagnostic(line);
  });
  const owed = await retryOwedFindings({ definitions: roster, deps, dryRun, home });
  owed.forEach(({ line }) => {
    deps.writeOut(line);
  });
}

/**
 * What a `run-due` tick reports before it runs any row: the seats it gives back, then every owed finding it retried.
 *
 * @param definitions the rows this tick runs, whose seats it may give back
 * @param roster every parsed row whatever `--recipe` named, since a held row is never the one a named tick runs
 * @returns the give-backs, then one outcome per owed finding, unreadable debt and orphaned hold
 */
export async function openingOutcomes({
  claimId,
  definitions,
  deps,
  dryRun,
  home,
  roster,
  verdicts,
}: {
  readonly claimId: string | null;
  readonly definitions: readonly RecipeDefinition[];
  readonly deps: SlotRunDeps;
  readonly dryRun: boolean;
  readonly home: string;
  readonly roster: readonly RecipeDefinition[];
  readonly verdicts: readonly RecipeDueVerdict[];
}): Promise<RowOutcome[]> {
  const giveBacks = seatGiveBacks({ claimId, definitions, dryRun, home, nowIso: deps.now(), verdicts });
  return [...giveBacks, ...(await retryOwedFindings({ definitions: roster, deps, dryRun, home }))];
}
