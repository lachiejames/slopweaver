/**
 * `slopweaver session re-seat` — re-seat every workspace standing behind a wall it cannot answer through:
 * reopened LOGGED OUT after a machine restart, or sitting on Claude Code's usage-limit
 * RETRY spinner after its plan spent its window (owner ruling relayed: _"nudge or respawn a
 * limit-hit seat, never leave it retrying"_). One boot at a time under the capacity read. The judgement — what
 * each wall looks like, which ledger row a renumbered workspace belongs to, and what is never touched — is
 * `../../../sessions/seatRecovery.ts`; this file is the socket, the capacity wait, the close and the boot.
 *
 * ## The order is the design
 *
 * Per seat, strictly in sequence: refuse a model pin `cmux spawn` would refuse, take a fleet spawn admission
 * (the same wait `cmux spawn --wait` runs, `../cmux/spawnCapacityWait.ts`), close the walled workspace and its
 * ledger row, then run `cmux spawn <slug> --model <model>` past the backoff it has already cleared, whose plan
 * routing is what moves a limit-walled seat onto a plan with headroom. The admission is taken BEFORE the
 * close, never after it — a boot the HOLD defers must leave the seat where it stood, not closed and
 * unreplaced. The close comes before the spawn so the old `claude` is gone
 * before its successor's `handover resume` asks whether the run's writer is live. A HOLD that outlasts its
 * wait stops the pass: every seat after it is reported held and left alone, because booting the next one
 * into the same HOLD is the thundering herd one-at-a-time exists to prevent. A HOLD exits deferred, never
 * clean: the seat is still walled and the sweep runs this again.
 *
 * Once a workspace may be closed, its boot is ALWAYS attempted. A close that answers an error is believed
 * only if a fresh inventory still lists the workspace (an unreadable one is reported `close-unknown`, never
 * booted, never read as untouched), and a ledger write that fails is reported on the
 * seat's line and fails the exit rather than skipping the spawn. A screen that cannot be read is neither
 * healthy nor walled: it is reported as a scan problem, the other seats are still recovered, and the exit
 * fails so nobody narrates the fleet as clear.
 */
import { ResultAsync } from "neverthrow";

import { spawnModelRefusal } from "../../../cmux/modelPin.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type CmuxHostInventoryError,
  type CmuxHostSurface,
  withCmuxSessionHost,
} from "../../../sessionHarness/cmuxHost.js";
import {
  planSeatRecovery,
  type RespawnableSeat,
  renderSeatRecoveryOutcome,
  renderSeatRecoverySummary,
  type SeatRecoveryOutcome,
} from "../../../sessions/seatRecovery.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../sessions/sessionStore.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS } from "../../../wait/loop.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { runCmuxSpawnPastBackoff } from "../cmux/run.js";
import { productionSpawnAdmissionDeps, waitForSpawnCapacity } from "../cmux/spawnCapacityWait.js";
import { boolFlag, numberFlag, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { callerWorkspaceId, type SeatScanProblem, scanSeatWalls } from "./seatWallScan.js";

/** What one pass needs from its environment, so a test can hand it a fake client, a temp home and plain fakes. */
export interface ReSeatDeps {
  readonly client: CmuxHostSurface;
  /** The state home holding the session ledger. */
  readonly home: string;
  /** The caller's own workspace id (`CMUX_WORKSPACE_ID`), or `undefined` outside cmux. */
  readonly ownWorkspaceId: string | undefined;
  /** The workspace `cmux pin` recorded as the supervisor's, never read or re-seated whatever cmux's own flag says. */
  readonly chairWorkspaceId: string | undefined;
  readonly nowIso: string;
  readonly dryRun: boolean;
  /** The environment the model-pin refusal reads its Fable override from. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Wait for machine capacity to clear: true to proceed, false when the HOLD outlasted the wait. */
  readonly waitForCapacity: () => Promise<boolean>;
  /** Boot one seat through `cmux spawn`, returning its exit code. */
  readonly boot: (options: { readonly slug: string; readonly model: string }) => Promise<number>;
}

/** One pass: every walled seat's outcome, and every screen it could not read. */
export interface ReSeatPass {
  readonly outcomes: readonly SeatRecoveryOutcome[];
  readonly scanProblems: readonly SeatScanProblem[];
}

/** The live cmux inventory could not be read, so there is no safe set of seats to act on. */
export interface SeatRecoveryInventoryError {
  readonly code: "CMUX_INVENTORY_READ_FAILED";
  readonly message: string;
  readonly cause: CmuxHostInventoryError;
}

/** Why a whole re-seat pass could not run. */
export type SeatRecoveryError = SeatRecoveryInventoryError;

/** The {@link SeatRecoveryError} factory. */
export const SeatRecoveryErrors = {
  inventoryReadFailed: ({ cause }: { cause: CmuxHostInventoryError }): SeatRecoveryInventoryError => ({
    cause,
    code: "CMUX_INVENTORY_READ_FAILED",
    message: `the live cmux inventory could not be read — ${cause.message}`,
  }),
} as const;

/** Re-seat one walled workspace: pin check, capacity, close, spawn — in that order. */
async function respawnOne({ deps, item }: { deps: ReSeatDeps; item: RespawnableSeat }): Promise<SeatRecoveryOutcome> {
  const refusal = spawnModelRefusal({ env: deps.env, model: item.model, slug: item.slug });
  if (refusal !== undefined) {
    return { item, kind: "refused", reason: refusal };
  }
  if (deps.dryRun) {
    return { item, kind: "would-respawn" };
  }
  if (!(await deps.waitForCapacity())) {
    return { item, kind: "held" };
  }
  const closed = await deps.client.closeWorkspace({ workspaceId: item.workspace.workspaceId });
  if (closed.isErr()) {
    const standing = await workspaceStanding({ deps, workspaceId: item.workspace.workspaceId });
    if (standing === "listed") {
      return { item, kind: "close-failed", reason: closed.error.message };
    }
    if (standing === "unknown") {
      return { item, kind: "close-unknown", reason: closed.error.message };
    }
  }
  // The workspace is closed now, so nothing between here and the boot may throw past it: a ledger write that
  // fails is carried onto the outcome and the seat is booted anyway.
  const ledger = recordLedgerClose({ deps, item });
  let exitCode: number;
  try {
    exitCode = await deps.boot({ model: item.model, slug: item.slug });
  } catch (error) {
    // A spawn that throws before it boots anything must still leave a line naming the closed seat.
    const thrown = error instanceof Error ? error.message : String(error);
    return { exitCode: EXIT_ERROR, item, kind: "spawn-failed", thrown, ...ledger };
  }
  if (exitCode !== EXIT_OK) {
    return { exitCode, item, kind: "spawn-failed", ...ledger };
  }
  return { item, kind: "respawned", ...ledger };
}

/**
 * Whether a workspace whose close answered an error is really still there. An error is not proof the close
 * did not happen: a reply past the socket's timeout, or a dropped connection whose retry re-sends the close
 * onto a workspace already gone, both come back as errors after cmux has closed it. So the inventory is read
 * again. An inventory that cannot be read either is `unknown`, and is never booted: spawning on a seat that
 * may still stand could double-seat the doc, so the line says the close may have happened and names the step.
 */
async function workspaceStanding({
  deps,
  workspaceId,
}: {
  deps: ReSeatDeps;
  workspaceId: string;
}): Promise<"listed" | "gone" | "unknown"> {
  const listed = await deps.client.listWorkspaces();
  if (listed.isErr()) {
    return "unknown";
  }
  if (listed.value.some((workspace) => workspace.workspaceId === workspaceId)) {
    return "listed";
  }
  return "gone";
}

/**
 * Close the seat's ledger row, answering the failure rather than throwing it. The ROW's ref, not the live one:
 * cmux renumbers a workspace on restart, and the fold closes the row whose `workspaceRef` the event names
 * (`../../../sessions/closeDone.ts`'s pairing).
 */
function recordLedgerClose({ deps, item }: { deps: ReSeatDeps; item: RespawnableSeat }): {
  readonly ledgerProblem?: string;
} {
  try {
    appendSessionEvent({
      event: {
        kind: "closed",
        sessionKey: item.row.sessionKey,
        tsIso: deps.nowIso,
        workspaceRef: item.row.workspaceRef,
      },
      home: deps.home,
    });
    return {};
  } catch (error) {
    return { ledgerProblem: error instanceof Error ? error.message : String(error) };
  }
}

/** The pass itself, as a promise of its result: read, place, then re-seat one walled seat at a time. */
async function reSeatPass({ deps }: { deps: ReSeatDeps }): Promise<Result<ReSeatPass, SeatRecoveryError>> {
  const workspaces = await deps.client.listWorkspaces();
  if (workspaces.isErr()) {
    return err(SeatRecoveryErrors.inventoryReadFailed({ cause: workspaces.error }));
  }
  const { walls, scanProblems } = await scanSeatWalls({
    client: deps.client,
    chairWorkspaceId: deps.chairWorkspaceId,
    ownWorkspaceId: deps.ownWorkspaceId,
    workspaces: workspaces.value,
  });
  const { events, unreadable } = parseSessionLog({ text: readSessionLogText({ home: deps.home }) });
  if (unreadable.length > 0) {
    logger.error({
      msg: `session re-seat: ${String(unreadable.length)} line(s) of the session ledger could not be read`,
    });
  }
  const plan = planSeatRecovery({
    rows: foldSessions({ events }),
    wallsByWorkspaceId: walls,
    workspaces: workspaces.value,
  });
  const outcomes: SeatRecoveryOutcome[] = [];
  let held = false;
  for (const item of plan) {
    if (item.kind === "not-respawnable") {
      outcomes.push({ item, kind: "reported" });
      continue;
    }
    if (held) {
      outcomes.push({ item, kind: "held" });
      continue;
    }
    const outcome = await respawnOne({ deps, item });
    if (outcome.kind === "held") {
      held = true;
    }
    outcomes.push(outcome);
  }
  return ok({ outcomes, scanProblems });
}

/**
 * Run the whole pass over an already-connected client: read every live screen but a pinned one's and the
 * caller's, place each walled one, and re-seat them one at a time.
 *
 * Exported so the pass is provable against a fake client and a temp ledger without a live `cmux`.
 *
 * @param deps the client, the state home, the caller's own workspace, the clock and the two effect seams
 * @returns every walled workspace's outcome in inventory order and every unread screen, or the typed failure
 *   when the cmux inventory itself could not be read
 */
export function reSeatWithClient({ deps }: { deps: ReSeatDeps }): ResultAsync<ReSeatPass, SeatRecoveryError> {
  return ResultAsync.fromSafePromise(reSeatPass({ deps })).andThen((result) => result);
}

/** The argv `cmux spawn` is handed for one seat: the slug, the model, and `--home` only when the caller named one. */
function spawnArgv({
  slug,
  model,
  home,
}: {
  slug: string;
  model: string;
  home: string | undefined;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "cmux",
    "spawn",
    slug,
    "--model",
    model,
    ...(home === undefined ? [] : ["--home", home]),
  ];
}

/**
 * `session re-seat` — the seat-recovery pass, over a live cmux.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionReSeat(argv: readonly string[]): Promise<number> {
  const verb = "re-seat";
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb }) });
    return EXIT_USAGE;
  }
  const timeout = numberFlag({ name: "timeout-seconds", parsed: parsed.value });
  if ("error" in timeout) {
    logger.error({ msg: `session re-seat: ${timeout.error}` });
    return EXIT_USAGE;
  }
  let timeoutSeconds = DEFAULT_WAIT_TIMEOUT_SECONDS;
  if (timeout.value !== undefined) {
    timeoutSeconds = timeout.value;
  }
  const namedHome = stringFlag({ name: "home", parsed: parsed.value });
  let home = slopweaverHome();
  if (namedHome !== undefined) {
    home = namedHome;
  }
  const dryRun = boolFlag({ name: "dry-run", parsed: parsed.value });
  const swept = await withCmuxSessionHost({
    body: async ({ host }) =>
      reSeatWithClient({
        deps: {
          chairWorkspaceId: readSupervisorPin({ home })?.workspaceId,
          client: host,
          dryRun,
          env: process.env,
          home,
          nowIso: new Date().toISOString(),
          ownWorkspaceId: callerWorkspaceId({ env: process.env }),
          // The admission was taken by `waitForCapacity` before the close, so the boot does not take a second
          // one: a backoff deferral here would leave the seat closed and unreplaced.
          boot: ({ slug, model }) =>
            Promise.resolve(runCmuxSpawnPastBackoff(spawnArgv({ home: namedHome, model, slug }))),
          waitForCapacity: async () =>
            (await waitForSpawnCapacity({
              deps: productionSpawnAdmissionDeps({ home }),
              wait: { timeoutSeconds, wait: true },
            })) === undefined,
        },
      }),
  });
  if (swept.isErr()) {
    logger.error({ msg: `session re-seat: ${swept.error.message}` });
    return EXIT_ERROR;
  }
  printPass({ dryRun, json: boolFlag({ name: "json", parsed: parsed.value }), pass: swept.value });
  return passExitCode({ pass: swept.value });
}

/** One unread screen as the line the verb prints. */
function renderScanProblem({ problem }: { problem: SeatScanProblem }): string {
  return `unread\t${problem.workspace.workspaceRef}\tits screen could not be read (${problem.message}) — whether it is walled is unknown; re-run once cmux answers`;
}

/** Print the pass: one JSON document, or one line per seat and unread screen, then the summary. */
function printPass({ dryRun, json, pass }: { dryRun: boolean; json: boolean; pass: ReSeatPass }): void {
  if (json) {
    logger.out({ line: JSON.stringify({ dryRun, outcomes: pass.outcomes, scanProblems: pass.scanProblems }) });
    return;
  }
  pass.outcomes.forEach((outcome) => {
    logger.out({ line: renderSeatRecoveryOutcome({ outcome }) });
  });
  pass.scanProblems.forEach((problem) => {
    logger.out({ line: renderScanProblem({ problem }) });
  });
  logger.out({
    line: renderSeatRecoverySummary({ dryRun, outcomes: pass.outcomes, unreadScreens: pass.scanProblems.length }),
  });
}

/**
 * The pass's exit: any failure, unrecorded ledger close or unread screen is an error; otherwise a HOLD is NOT
 * YET — the seat is still walled and the sweep runs this again once capacity clears.
 *
 * @param pass what the pass did and could not see
 * @returns the process exit code
 */
export function passExitCode({ pass }: { pass: ReSeatPass }): number {
  const failed = pass.outcomes.some(
    (outcome) =>
      ["close-failed", "close-unknown", "spawn-failed", "refused"].includes(outcome.kind) || "ledgerProblem" in outcome,
  );
  if (failed || pass.scanProblems.length > 0) {
    return EXIT_ERROR;
  }
  return pass.outcomes.some((outcome) => outcome.kind === "held") ? EXIT_DEFERRED : EXIT_OK;
}

export const sessionReSeatCommand = defineCommand({ run: runSessionReSeat });
