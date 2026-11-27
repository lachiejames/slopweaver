/**
 * `slopweaver cmux spawn` / `slopweaver cmux title` — the reviewed replacement for the remembered recipe.
 * `cmux close` is `./close.ts`.
 */
import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import { type SpawnFailure, spawnFailureKeepsWorkspaceOpen } from "../../../cmux/spawn.js";
import type { CodexDestination } from "../../../codex/destinations.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import type { SessionHarnessError } from "../../../sessionHarness/errors.js";
import { closeHarnessSpawnDeps, type HarnessSpawnDeps } from "../../../sessionHarness/recordedSpawn.js";
import type { SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { foldSessions, parseSessionLog, type SessionItem } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { recordCaughtExhaustion } from "./codexSeat.js";
import { cmuxUsage, parseCmuxVerb, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { reportSpawnPreflight } from "./spawnBase.js";
import { productionSpawnAdmissionDeps, waitForSpawnCapacity } from "./spawnCapacityWait.js";
import { launchSpawnThroughSeam } from "./spawnLaunch.js";
import { spawnSuccessLines, spawnWorktreeLine } from "./spawnOutput.js";
import { recordSeatLeftOpen, recordSpawn } from "./spawnRecord.js";
import { resolveSpawnTarget, spawnDepsFor } from "./spawnTarget.js";

/**
 * Close the workspace a caught Codex exhaustion left standing, and say what happened. Only a cmux launch reports a
 * quota kind today; an app failure carrying one is a broken contract, said as such, never a claimed close.
 *
 * @returns the line to print
 */
async function closeExhaustedWorkspace({
  harnessDeps,
  outcome,
}: {
  harnessDeps: HarnessSpawnDeps;
  outcome: SpawnFailure;
}): Promise<string> {
  switch (harnessDeps.harness) {
    case "app":
      return `cmux spawn: ${outcome.reason} — recorded the exhaustion; an app launch reported a quota kind, which only a cmux launch should, so ${outcome.workspaceRef} was left as it is`;
    case "cmux": {
      const { client } = harnessDeps.deps;
      const resolved = await client.resolveWorkspace({ ref: outcome.workspaceRef });
      if (resolved.isOk()) {
        await client.closeWorkspace({ workspaceId: resolved.value.workspaceId });
      }
      return `cmux spawn: ${outcome.reason} — closed ${outcome.workspaceRef} and recorded the exhaustion`;
    }
    default: {
      const unhandled: never = harnessDeps;
      throw new Error(`no exhaustion close for harness deps ${String(unhandled)}`);
    }
  }
}

/**
 * Report one failed spawn — closing and recording a caught Codex exhaustion first, when that was the cause.
 *
 * Every OTHER failure ends the same way, on purpose: `spawn.ts`'s own control-socket retry
 * (`cmux/socket.ts`'s `withSocketRetry`) already absorbs a transient `write EPIPE`, so whatever reaches here
 * is either that retry exhausted or a different failure entirely — and either way, `worktree/provision.ts`
 * already makes `cwd` idempotent to reopen (`plan.worktreeExists` reuses it), so the honest instruction is
 * always "retry this exact command", never a diagnosis this function cannot make. Two shapes, not one:
 * `outcome.workspaceRef` EMPTY means nothing opened at all (measured live: the empty-placeholder line this
 * used to print, `cmux spawn: opened  but …` plus a blank `--workspace  --surface `, named nothing a reader
 * could act on) — that shape gets no read-screen hint, because there is no surface to read.
 *
 * @param destination the routed Codex account this seat was spending, so a caught exhaustion is keyed to the
 *   account that actually hit it — undefined for a Claude spawn, which never reaches that branch
 * @param outcome the failed spawn outcome
 * @param home the state home the cache lives under
 * @param harnessDeps the deps the spawn ran on, whose cmux arm alone can close an exhausted workspace
 * @param cwd the worktree the spawn was opening, kept whichever way this failed
 * @returns the process exit code
 */
async function reportSpawnFailure({
  destination,
  outcome,
  home,
  harnessDeps,
  cwd,
}: {
  destination: CodexDestination | undefined;
  outcome: SpawnFailure;
  home: string | undefined;
  harnessDeps: HarnessSpawnDeps;
  cwd: string;
}): Promise<number> {
  if (outcome.quotaKind !== undefined) {
    recordCaughtExhaustion({ destination, home, kind: outcome.quotaKind });
    logger.error({ msg: await closeExhaustedWorkspace({ harnessDeps, outcome }) });
    return EXIT_ERROR;
  }
  const retried = `the worktree at ${cwd} is kept — retry this exact command, it reuses the worktree`;
  if (outcome.workspaceRef.length === 0) {
    logger.error({ msg: `cmux spawn: no workspace was opened — ${outcome.reason}; ${retried}` });
    return EXIT_ERROR;
  }
  logger.error({ msg: `cmux spawn: opened ${outcome.workspaceRef} but ${outcome.reason} — ${retried}` });
  // A workspace found after a timed-out create can fail before its surface is known, so the flag is omitted then.
  const surface = outcome.surfaceRef.length === 0 ? "" : ` --surface ${outcome.surfaceRef}`;
  logger.error({ msg: `slopweaver cmux read-screen --workspace ${outcome.workspaceRef}${surface}` });
  return EXIT_ERROR;
}

/**
 * `cmux spawn` — open a cmux workspace in the doc's worktree, boot Claude with this plugin checkout, verify
 * it actually booted, then send the pickup template (`cmux/pickupCommand.ts`) — never a line read out of
 * the doc.
 *
 * For `--driver codex`, routes the seat onto a registered account and refuses BEFORE any of that when THAT
 * account is already known to be out of usage (see {@link resolveCodexSeat}) — no worktree, no workspace, no
 * wasted boot. `--force` bypasses this check once without clearing the underlying cached record.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxSpawn(argv: readonly string[]): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "cmux", rest: argv.slice(VERB_ARG_OFFSET), verb: "spawn" });
  if (gated !== undefined) {
    return gated;
  }
  return spawnThroughAdmission({ argv, pastBackoff: false });
}

/**
 * `cmux spawn` for `machine watch`'s investigation seat, which opens THROUGH a capacity hold by design: it is
 * the seat that investigates the hold, already rate-limited per signature by `../../../live/machine/backoff.ts`.
 * Refusing it under the fleet's spawn backoff would leave the hold's dispatch row unseated, and
 * `supervisor tick-record` refusing every tick for it — the wedge `backoff.ts`'s header warns against. In-process
 * only, so no session can reach it by typing a flag.
 *
 * @param argv the full process argv, exactly as {@link runCmuxSpawn} takes it
 * @returns the process exit code
 */
export async function runCmuxSpawnPastBackoff(argv: readonly string[]): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "cmux", rest: argv.slice(VERB_ARG_OFFSET), verb: "spawn" });
  if (gated !== undefined) {
    return gated;
  }
  return spawnThroughAdmission({ argv, pastBackoff: true });
}

/**
 * Why a spawn a caller ran exited non-zero, naming a spawn-backoff deferral as NOT YET rather than a failed boot.
 *
 * @param exitCode the spawn's non-zero exit
 * @returns the reason, for the caller's own diagnostic
 */
export function spawnExitWhy({ exitCode }: { exitCode: number }): string {
  if (exitCode === EXIT_DEFERRED) {
    return "the spawn backoff deferred the successor (exit 4) — nothing booted; re-run once it opens";
  }
  return `the successor did not boot cleanly (exit ${String(exitCode)})`;
}

/**
 * The spawn itself: resolve, preflight, ADMIT, open. The base preflight runs before admission so a spawn
 * refused on its plan never takes one of the fleet's spaced admissions after a hold.
 */
async function spawnThroughAdmission({
  argv,
  pastBackoff,
}: {
  argv: readonly string[];
  pastBackoff: boolean;
}): Promise<number> {
  const target = await resolveSpawnTarget({ argv });
  if (typeof target === "number") {
    return target;
  }
  const { doc, plan, home, runEvents } = target;
  const baseRefusal = reportSpawnPreflight({
    doc,
    docText: target.docText,
    plan,
    requireCurrentBase: target.requireCurrentBase,
  });
  if (baseRefusal !== undefined) {
    logger.error({ msg: `cmux spawn: refusing — ${baseRefusal}` });
    return EXIT_ERROR;
  }
  if (!pastBackoff) {
    const held = await waitForSpawnCapacity({ deps: productionSpawnAdmissionDeps({ home }), wait: target.wait });
    if (held !== undefined) {
      return held;
    }
  }
  if (target.full) {
    logger.out({ line: spawnWorktreeLine({ plan }) });
  }
  // Which tree this session follows, and which account it boots on, are decided per plan in `cmux/spawn.ts`. Built for
  // the target's harness alone, so an app spawn opens no cmux connection.
  const harnessDeps = spawnDepsFor({ target });
  try {
    // Through the session harness seam, whose recording launcher writes the session's ledger row.
    const outcome = await launchSpawnThroughSeam({ doc, harnessDeps, home, plan, runEvents });
    if (outcome.isErr() && spawnFailureKeepsWorkspaceOpen({ failure: outcome.error })) {
      return recordSeatLeftOpen({ failure: outcome.error, home, plan });
    }
    if (outcome.isErr()) {
      return await reportSpawnFailure({
        cwd: plan.cwd,
        destination: target.codexSeat?.destination,
        harnessDeps,
        home,
        outcome: outcome.error,
      });
    }
    recordSpawn({ home, plan, spawned: outcome.value });
    for (const line of spawnSuccessLines({ full: target.full, plan, spawned: outcome.value })) {
      logger.out({ line });
    }
    return EXIT_OK;
  } finally {
    closeHarnessSpawnDeps({ harnessDeps });
  }
}

/**
 * The workspace one verb is addressing: the `--workspace` ref or id it named, or the caller's OWN.
 *
 * The caller's own workspace comes from `CMUX_WORKSPACE_ID`, which cmux exports into every surface it opens —
 * NOT from `system.identify`. Measured, and it cost a wrong write to find: `identify` reports
 * cmux's FOCUSED workspace, so a `cmux title` run from this session with no `--workspace` renamed the
 * supervisor's workspace, because the supervisor's tab was the one on screen. A verb that means "me" must read
 * the environment the process was started in, which cannot move while it runs.
 *
 * A named ref is resolved to an id before anything is addressed: a `workspace:N` ref that names nothing live
 * silently addresses the focused surface instead (see `cmux/client.ts`'s `CmuxTarget`), which is the same
 * wrong write by a different route.
 *
 * @param harness the session harness the named ref is resolved through
 * @param env the environment to read the caller's own workspace from
 * @param workspaceRef the ref or id the caller named, or `undefined` to mean its own workspace
 * @returns the resolved workspace id, or the typed failure
 */
export async function targetWorkspaceId({
  harness,
  env,
  workspaceRef,
}: {
  harness: Pick<SessionHarness, "resolve">;
  env: Readonly<Record<string, string | undefined>>;
  workspaceRef: string | undefined;
}): Promise<Result<string, CmuxError | SessionHarnessError>> {
  if (workspaceRef !== undefined) {
    return (await harness.resolve({ handle: workspaceRef })).map((target) => target.session.id);
  }
  const own = env["CMUX_WORKSPACE_ID"];
  if (own === undefined || own.trim().length === 0) {
    return err(
      CmuxErrors.malformedReply({
        detail: "this process is not inside a cmux workspace (no CMUX_WORKSPACE_ID), so name one with --workspace",
        method: "cmux title",
      }),
    );
  }
  return ok(own.trim());
}

/**
 * `cmux title` — set the title a workspace's sidebar row shows.
 *
 * `cmux spawn` already titles the workspace it creates, so this is the verb for the workspace a HUMAN opened
 * by hand (`cmux <path>` titles it after the directory) and for a session retitling itself as the work moves.
 * The owner's ruling: the supervisor sets the title on dispatch, however the workspace was
 * opened — that needs a verb it can call, and this is it.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxTitle(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "title" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const title = parsed.positionals[0];
  if (title === undefined || title.trim().length === 0) {
    logger.error({ msg: "cmux title: a title is required" });
    logger.error({ msg: cmuxUsage({ verb: "title" }) });
    return EXIT_USAGE;
  }
  const renamed = await withCmuxSessionHost({
    body: async ({ harness, host }): Promise<Result<void, CmuxError | SessionHarnessError>> => {
      const target = await targetWorkspaceId({
        env: process.env,
        harness,
        workspaceRef: stringFlag({ name: "workspace", parsed }),
      });
      if (target.isErr()) {
        return err(target.error);
      }
      return host.renameWorkspace({ title, workspaceId: target.value });
    },
  });
  if (renamed.isErr()) {
    logger.error({ msg: `cmux title: ${renamed.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux title: set to ${title}` });
  return EXIT_OK;
}

/**
 * The ledger's own record of the OPEN session that holds this workspace ref, if any.
 *
 * An exact match on the RECORDED ref, so it answers only within one run of cmux: a restart renumbers every ref.
 * A caller holding the live inventory pairs instead (`../../../sessions/closeDone.ts`'s `pairRowsToWorkspaces`),
 * as `cmux takeover`'s gate (c) does. Exported so this lookup is testable against a real temp ledger without a
 * live `cmux` binary.
 *
 * @param home the state home to read the ledger from (defaults to the resolved home)
 * @param workspaceRef the cmux workspace ref to look up
 * @returns the matching open session's item, or `undefined` when none is tracked
 */
export function openSessionItemFor({
  home,
  workspaceRef,
}: {
  home: string | undefined;
  workspaceRef: string;
}): SessionItem | undefined {
  const { events } = parseSessionLog({ text: readSessionLogText(home === undefined ? {} : { home }) });
  return foldSessions({ events }).find((item) => item.status === "open" && item.workspaceRef === workspaceRef);
}

/**
 * The session key of the OPEN, ledger-tracked session that holds this workspace ref, if any.
 *
 * Never blocks the close itself: a workspace opened outside `cmux spawn` — or one the ledger has already
 * lost track of — closes exactly the same way, just without a ledger event to show for it.
 *
 * @param home the state home to read the ledger from (defaults to the resolved home)
 * @param workspaceRef the cmux workspace ref being closed
 * @returns the matching open session's key, or `undefined` when none is tracked
 */
export function openSessionKeyFor({
  home,
  workspaceRef,
}: {
  home: string | undefined;
  workspaceRef: string;
}): string | undefined {
  return openSessionItemFor({ home, workspaceRef })?.sessionKey;
}

export const cmuxSpawnCommand = defineCommand({ run: runCmuxSpawn });

export const cmuxTitleCommand = defineCommand({ run: runCmuxTitle });
