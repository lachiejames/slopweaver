/**
 * `slopweaver automation seat` — open ONE visible session on the automations that need a session.
 *
 * The schedule is native to Slopweaver and fully wired, and nothing outside that design stays. No standing session
 * is needed: nothing stands by for an automation. A supervisor
 * pass reads `automation due`, decides by judgement that a spawn-shaped row is worth a slot, and types this.
 *
 * ## What it is NOT
 *
 * It is not a scheduler. It runs nothing itself, it holds no loop, it wakes on nothing and it exits as soon
 * as the workspace is open — the session it seats is the executor, and that session is visible, watchable
 * and interruptible exactly as `AGENTS.md` rule 2 requires. There is no cron here and there will not be
 * one.
 *
 * ## The order of operations is the whole design
 *
 * Resolve the checkout, claim, register the board row, spawn — and when the session does not open, CANCEL the row
 * and only then release every claim. Each step is a measured lesson rather than taste.
 * `cli/commands/vulnerabilityFix/run.ts` resolved its checkout AFTER writing its row and left a row on
 * the board nobody was working; a claim taken for a session that never opened would hold its row until the row's own
 * next firing, which for a four-hourly resync is four hours of silence with nothing running; and a row left
 * `ready` after its claims were released carried tokens the ledger no longer held, so a chair that spawned it on
 * once booted a session `run-due` refused (`./seatRetirement.ts` carries the order, `./seatRetirementText.ts`
 * the measurement).
 */
import { randomUUID } from "node:crypto";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { judgeRecipeDefinitions } from "../../../live/automation/definitionDue.js";
import { lastRecipeRun, readRecipeDefinitionRuns } from "../../../live/automation/definitionRunStore.js";
import { loadLiftedRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { composeDueAskReport, type DueAskReport, type DueAskRow } from "../../../live/automation/dueReport.js";
import { type ProcessAlive, recipeHolderAlive } from "../../../live/automation/holderLiveness.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { tickResyncRecipeIds } from "../../../live/resync/roster.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { runCmuxSpawn } from "../cmux/run.js";
import { runHandoverRegister } from "../handover/askRowRun.js";
import { RECIPE_SEAT_USAGE } from "./core.js";
import { openAttempts } from "./due.js";
import { parseRecipeSeatArgs, type RecipeSeatOptions } from "./seatArgs.js";
import { type SeatedRow, seatAsk } from "./seatAsk.js";
import { claimPlannedRows, releaseSeatedRows } from "./seatClaims.js";
import { emptySeatLine, type UnseatableRow, unseatableRows, unseatableSkipLine } from "./seatRefusals.js";
import { retireSeatRow, retireThenReleaseSeat, type SeatRowRetirement } from "./seatRetirement.js";
import type { SeatRetirementError } from "./seatRetirementErrors.js";

/** Where the flag tail starts: past the runtime, the script, the `recipe` noun and the `seat` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the seat is testable without opening a workspace. */
export interface RecipeSeatDeps {
  readonly now: () => string;
  /** Whether a stored slot attempt's holder pid still runs — `recipeHolderAlive` in production. */
  readonly processAlive: ProcessAlive;
  /** Mints the claim tokens and the board slug's suffix, injected so a test can pin them. */
  readonly mintId: () => string;
  /** Writes the board row the seated session picks up. */
  readonly register: (args: { readonly argv: readonly string[] }) => Promise<number>;
  /** Opens the visible workspace on that row. */
  readonly openSession: (args: { readonly argv: readonly string[] }) => Promise<number>;
  /** Cancels the board row this seat registered when its session did not open — `retireSeatRow` in production. */
  readonly retireRow: (args: {
    readonly home: string;
    readonly slug: string;
    readonly ask: string;
    readonly why: string;
  }) => Promise<Result<SeatRowRetirement, SeatRetirementError>>;
  /**
   * The local checkout the board row names, which `cmux spawn` cuts the seated session's worktree from.
   * Resolved BEFORE anything is claimed or written — see {@link seatCheckout}.
   */
  readonly checkoutFor: (args: { readonly home: string }) => Result<string>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The declared main checkout a seated session opens against: the one whose `origin` is the repository THIS
 * process is running from.
 *
 * The resolution itself lives beside the resolver it calls (`live/checkout/checkoutForRunningRepo`), because
 * it is the shape of every register-then-spawn verb rather than a fact about schedules — `machine watch`
 * shipped without it and seated nothing for 17 dispatches. This wrapper survives only to name the verb the
 * refusal speaks as.
 *
 * @param home the state home whose profile declares the main checkouts
 * @returns the checkout path, or why no declared one is this repository
 */
export function seatCheckout({ home }: { readonly home: string }): Result<string> {
  return checkoutForRunningRepo({ home, verb: "automation seat" });
}

/**
 * The real edges.
 *
 * @returns the production dependencies
 * @internal
 */
export function productionRecipeSeatDeps(): RecipeSeatDeps {
  return {
    checkoutFor: ({ home }) => seatCheckout({ home }),
    mintId: () => randomUUID(),
    now: () => new Date().toISOString(),
    openSession: ({ argv }) => runCmuxSpawn(["node", "slopweaver", "cmux", "spawn", ...argv]),
    processAlive: recipeHolderAlive,
    register: ({ argv }) => runHandoverRegister(["node", "slopweaver", "handover", "register", ...argv]),
    retireRow: (args) => retireSeatRow(args),
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** The rows one seat would hand to one session, the rows it passed over, and the board slug. */
export interface SeatPlan {
  readonly rows: readonly DueAskRow[];
  /** Unseatable rows ranked ahead of the last seated row — the ones stepped past to fill the limit. */
  readonly skipped: readonly UnseatableRow[];
  readonly slug: string;
}
/**
 * Which rows a seat takes, in the order the due report already ranked them.
 *
 * Only ACTIONABLE spawn-shaped rows: a row already claimed is somebody's session's, a row whose cadence will
 * not parse cannot be claimed at all, and a run-here row is not a seating decision — the supervisor runs
 * that one in its own tick. The report has already ordered rows most-overdue first, so a bound is a prefix
 * of a ranking rather than an arbitrary slice.
 *
 * A row the ledger will NOT hand its firing over for is stepped past, not seated, and the next due row
 * fills its place. That refusal used to abort the whole seat. MEASURED, on one chair's seats:
 * `--limit 10` was refused three times in one hour on the first row of its prefix while 25 due rows behind
 * it went unserved for over three hours.
 *
 * `recipeId` narrows it to ONE row, for the same reason `run-due --recipe` exists and one more that is its
 * own: a row less overdue than forty resyncs is unreachable through a prefix, and two rows that each drive
 * the owner's ONE CHROME must not be handed to a single session — MEASURED, two browser-walk seats
 * contended for it and every navigation read ETIMEDOUT. A digest row carrying `shots` is one of those rows.
 *
 * Pure.
 *
 * @param report the due report, as `automation due` composes it
 * @param unseatable the actionable spawn-shaped rows the ledger will refuse, by recipe id
 * @param limit how many rows this seat takes
 * @param id the token the slug is made unique with
 * @param recipeId the one row to seat, or `null` for the prefix of the ranking
 * @returns the rows to seat, the rows passed over, and the board slug to write them under
 */
export function planSeat({
  report,
  unseatable,
  limit,
  id,
  recipeId,
}: {
  readonly report: DueAskReport;
  readonly unseatable: ReadonlyMap<string, UnseatableRow>;
  readonly limit: number;
  readonly id: string;
  readonly recipeId: string | null;
}): SeatPlan {
  const seatable = report.rows.filter((row) => row.actionable && row.shape === "spawn");
  const named = recipeId === null ? seatable : seatable.filter((row) => row.recipeId === recipeId);
  const rows: DueAskRow[] = [];
  const skipped: UnseatableRow[] = [];
  for (const row of named) {
    if (rows.length === limit) {
      break;
    }
    const refused = unseatable.get(row.recipeId);
    if (refused === undefined) {
      rows.push(row);
      continue;
    }
    skipped.push(refused);
  }
  return { rows, skipped, slug: `automations-seat-${id.slice(0, 8)}` };
}

/**
 * Read the store, decide what to seat, and open the session.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export async function seatDueRows({
  deps,
  options,
}: {
  readonly deps: RecipeSeatDeps;
  readonly options: RecipeSeatOptions;
}): Promise<number> {
  const paths = stateHomePaths({ home: options.home }).live.recipe;
  const roster = loadLiftedRecipeDefinitions({ home: options.home });
  const runs = readRecipeDefinitionRuns({ path: paths.definitionRunsJson });
  if (runs.isErr()) {
    runs.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_ERROR;
  }
  const nowIso = deps.now();
  const verdicts = judgeRecipeDefinitions({
    definitions: roster.definitions,
    nowIso,
    runFor: ({ recipeId }) => lastRecipeRun({ recipeId, runs: runs.value }),
  });
  // Planned from the SLOT LEDGER, the same read `automation due` makes: nothing writes the old claims file any
  // more, so planning from it would put rows the ledger already holds into a seat.
  const held = openAttempts({
    definitions: roster.definitions,
    home: options.home,
    processAlive: deps.processAlive,
    verdicts,
    writeDiagnostic: (line) => {
      deps.writeDiagnostic(`automation seat · ${line}`);
    },
  });
  if (!held.readable) {
    return EXIT_ERROR;
  }
  const report = composeDueAskReport({
    claims: held.holders,
    definitions: roster.definitions,
    nowIso,
    rejected: roster.rejected.map((rejection) => `${rejection.file} · REJECTED · ${rejection.error.message}`),
    // The seat plans from `rows` and never renders `stranded`, but the report it builds is the same report
    // `automation due` prints, so it is built from the same build's answer rather than a placeholder.
    tickResyncIds: await tickResyncRecipeIds(),
    verdicts,
  });
  return planAndOpen({ deps, nowIso, options, report });
}

/**
 * Plan the seat past any row the ledger refuses, say what was stepped past, and open it — or say why
 * nothing was seated.
 *
 * The ledger read happens BEFORE the dry-run fork in {@link openSeat}, so `--dry-run` plans and prints
 * exactly what the real seat would claim.
 *
 * @param deps the injected edges
 * @param nowIso the instant the report was composed at, which the retry floors are judged against
 * @param options the resolved invocation
 * @param report the due report this seat plans from
 * @returns the process exit code
 */
async function planAndOpen({
  deps,
  nowIso,
  options,
  report,
}: {
  readonly deps: RecipeSeatDeps;
  readonly nowIso: string;
  readonly options: RecipeSeatOptions;
  readonly report: DueAskReport;
}): Promise<number> {
  const unseatable = unseatableRows({ home: options.home, nowIso, processAlive: deps.processAlive, report });
  if (unseatable.isErr()) {
    deps.writeDiagnostic(unseatable.error.message);
    return EXIT_ERROR;
  }
  const plan = planSeat({
    id: deps.mintId(),
    limit: options.limit,
    recipeId: options.recipeId,
    report,
    unseatable: unseatable.value,
  });
  plan.skipped.forEach((row) => {
    deps.writeOut(unseatableSkipLine({ row }));
  });
  if (plan.rows.length === 0) {
    deps.writeOut(emptySeatLine({ recipeId: options.recipeId, refused: plan.skipped.length > 0 }));
    return EXIT_EXPECTED_EMPTY;
  }
  return openSeat({ deps, options, plan });
}

/**
 * The argv the board row is written with — its own function so {@link openSeat} reads as the ORDER it
 * performs (resolve, claim, register, spawn, release on failure) rather than as a flag list.
 *
 * @param checkout the declared main checkout the seated session's worktree is cut from
 * @param seated every row this seat took, with the token each was claimed under
 * @param slug the board row's slug
 * @returns the argv words past `handover register`
 */
function registerArgv({
  checkout,
  deps,
  options,
  seated,
  slug,
}: {
  readonly checkout: string;
  readonly deps: RecipeSeatDeps;
  readonly options: RecipeSeatOptions;
  readonly seated: readonly SeatedRow[];
  readonly slug: string;
}): readonly string[] {
  return [
    "--ask",
    seatAsk({ seated }),
    // A seat's row is work the session it opens picks up and nothing the owner decides, so it is a DISPATCH row: an
    // unshaped ask is refused, and without this every seat released its claims unopened.
    "--dispatch",
    "--slug",
    slug,
    "--priority",
    "p2",
    "--asked-iso",
    deps.now(),
    // No `--workspace`: a seat mixes kinds, some the team's own work (a project update, the owner's inbox), and no recipe
    // definition carries a workspace to read. A row stating none is drawn on the self view marked placed by default; a guess wears no mark.
    "--repo",
    checkout,
    "--home",
    options.home,
  ];
}

/**
 * Resolve the checkout, claim what the plan covers, write the board row and open the workspace — the
 * effectful half, in that order, releasing every claim it took if any step after the claim fails.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @param plan the rows to seat
 * @returns the process exit code
 */
async function openSeat({
  deps,
  options,
  plan,
}: {
  readonly deps: RecipeSeatDeps;
  readonly options: RecipeSeatOptions;
  readonly plan: SeatPlan;
}): Promise<number> {
  const names = plan.rows.map((row) => row.recipeId).join(", ");
  // Resolved BEFORE anything is claimed or written, never after. MEASURED, on the first real
  // seat: the row was registered, `cmux spawn` answered "names no `repo:`, so there is nowhere to open a
  // worktree in", and the claims this seat had already taken had to be released — leaving a board row
  // nobody was working. `vulnerability-fix topup` measured the same shape one day earlier
  // (`live/checkout/checkoutForRepo.ts`), which is why the resolver is shared rather than copied.
  const checkout = deps.checkoutFor({ home: options.home });
  if (checkout.isErr()) {
    checkout.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    return EXIT_ERROR;
  }
  if (options.dryRun) {
    deps.writeOut(
      `automation seat · would seat ${String(plan.rows.length)} row(s) as ${plan.slug} in ${checkout.value}: ${names}`,
    );
    return EXIT_OK;
  }
  const claimed = await claimPlannedRows({ deps, home: options.home, plan });
  if (claimed.isErr()) {
    claimed.error.problems.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    releaseSeatedRows({ deps, home: options.home, taken: claimed.error.taken });
    return EXIT_ERROR;
  }
  if (claimed.value.length === 0) {
    deps.writeOut("automation seat · every planned row was held before it could be claimed — nothing seated");
    return EXIT_EXPECTED_EMPTY;
  }
  return registerAndOpen({ checkout: checkout.value, deps, options, plan, seated: claimed.value });
}

/**
 * Write the board row for the claimed rows and open the workspace that runs them, releasing every claim if
 * either step fails.
 *
 * @param checkout the checkout the session opens in, resolved before anything was claimed
 * @param seated the rows this seat claimed
 * @returns the process exit code
 */
async function registerAndOpen({
  checkout,
  deps,
  options,
  plan,
  seated,
}: {
  readonly checkout: string;
  readonly deps: RecipeSeatDeps;
  readonly options: RecipeSeatOptions;
  readonly plan: SeatPlan;
  readonly seated: readonly SeatedRow[];
}): Promise<number> {
  const registered = await deps.register({
    argv: registerArgv({ checkout, deps, options, seated, slug: plan.slug }),
  });
  if (registered !== EXIT_OK) {
    deps.writeDiagnostic(`handover register exited ${String(registered)}, so no session was opened`);
    // A non-zero register can still have written the row (its tags or its mirror failed after the doc existed), so
    // the row is retired — or proved absent — before any claim is released, exactly as for a refused spawn.
    const why = `handover register exited ${String(registered)}`;
    await retireThenReleaseSeat({ deps, home: options.home, seated, slug: plan.slug, why });
    return EXIT_ERROR;
  }
  const opened = await deps.openSession({
    argv: [plan.slug, "--model", options.model, "--home", options.home],
  });
  if (opened !== EXIT_OK) {
    deps.writeDiagnostic(`cmux spawn exited ${String(opened)}, so the rows it would have run are released`);
    const why = `cmux spawn exited ${String(opened)}`;
    const released = await retireThenReleaseSeat({ deps, home: options.home, seated, slug: plan.slug, why });
    // A spawn the fleet backoff deferred is NOT YET, never a fault: the released rows stay due for the next run.
    // A row left seatable, or a claim that would not release, holds state the next pass trips on, so either is a
    // fault whatever the spawn said.
    return opened === EXIT_DEFERRED && released ? EXIT_DEFERRED : EXIT_ERROR;
  }
  const seatedNames = seated.map((row) => row.recipeId).join(", ");
  deps.writeOut(
    `automation seat · ${plan.slug} seated on ${options.model} with ${String(seated.length)} row(s): ${seatedNames}`,
  );
  return EXIT_OK;
}

/**
 * The verb entry point.
 *
 * @param argv the whole process argv
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code
 */
export async function runRecipeSeat({
  argv,
  deps = productionRecipeSeatDeps(),
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipeSeatDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECIPE_SEAT_USAGE);
    return EXIT_OK;
  }
  const options = parseRecipeSeatArgs({ defaultHome: slopweaverHome(), rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(RECIPE_SEAT_USAGE);
    return EXIT_USAGE;
  }
  return seatDueRows({ deps, options: options.value });
}

export const recipeSeatCommand = defineCommand({ run: (argv) => runRecipeSeat({ argv }) });
