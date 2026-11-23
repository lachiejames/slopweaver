/**
 * The read-back half of a `cmux reseat` relaunch: type ONE launch line into a tab, then read whether it came up.
 *
 * It baselines the missing-conversation lines already on screen, sends exactly one line, answers Claude's resume menu
 * once, and confirms the launch only on a LIVE session whose own process runs in THIS tab, under a new pid, at a
 * Claude composer (`../../../sessions/reseatConfirmation.ts`). After a resume that printed `No conversation found`, it
 * waits for the tab to be back at its bare prompt before anything else is typed.
 *
 * Routing the credential, stopping the prior session, composing the line, the resume-to-fresh retry policy and the
 * outcome a pass reports all stay in `./reseatRelaunch.ts`; this module only observes.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  EXIT_SIGHTINGS_TO_FAIL,
  type ExitLine,
  type MissingConversationReading,
  NO_EXIT_SIGHTINGS,
  newExitLine,
  nextExitSightings,
  readMissingConversation,
} from "../../../cmux/bootSignal.js";
import { type ComposerProbe, gridReadWithoutComposer, probeComposer } from "../../../cmux/composerProbe.js";
import type { ReseatLaunch } from "../../../cmux/reseatLine.js";
import { liveSessionsInTab } from "../../../sessions/liveInTab.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import { type ReseatPlan, screenShowsResumeMenu } from "../../../sessions/reseat.js";
import { judgeReseatConfirmation, type ReseatConfirmation } from "../../../sessions/reseatConfirmation.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import { judgeWorkspaceAtPrompt } from "./reseatCold.js";
import { stillLive } from "./reseatLiveSession.js";
import type { ReseatDeps } from "./reseatPass.js";

/** How long the relaunched session gets to register its id again. */
export const RESEAT_CONFIRM_SECONDS = 60;

/**
 * The missing-conversation lines a tab's screen carries now, or `undefined` when it would not read. An unreadable
 * baseline is UNKNOWN, never empty: read as zero lines, an old exit still in scrollback would count as this launch's
 * own failure the moment a later read succeeded, and relaunch the seat fresh over a resume that may be coming up.
 */
async function missingConversationsOnScreen({
  deps,
  workspaceId,
}: {
  deps: ReseatDeps;
  workspaceId: string;
}): Promise<MissingConversationReading | undefined> {
  const screen = await deps.client.readScreen({ target: { workspaceId } });
  if (screen.isErr()) {
    return undefined;
  }
  return readMissingConversation({ screen: screen.value });
}

/**
 * The live sessions whose own process runs in this tab, read the way the chair's hosting check reads it
 * (`../../../sessions/liveInTab.ts`): cmux's own attribution first, the process table grafting it under cmux 0.65.2,
 * which attributes nothing.
 */
async function liveInThisTab({
  deps,
  workspaceId,
}: {
  deps: ReseatDeps;
  workspaceId: string;
}): Promise<Result<readonly SessionRecord[], string>> {
  const top = await deps.client.workspaceTop({ workspaceId });
  const live = deps.readLiveRecords();
  if (top.isErr() || live.isErr()) {
    return err("the tab's processes or the live sessions did not read");
  }
  // A session cmux attributed itself needs no table; cmux 0.65.2 attributes nothing, so the table grafts it.
  const reported = liveSessionsInTab({ liveRecords: live.value, report: top.value, rows: [] });
  if (reported.length > 0) {
    return ok(reported);
  }
  const rows = deps.readProcessRows();
  if (rows.isErr()) {
    return err(`the process table did not read: ${rows.error}`);
  }
  // Validated again after the table, so a pid reused on the tab's tty never confirms a relaunch (`stillLive`).
  return stillLive({
    deps,
    sessions: liveSessionsInTab({ liveRecords: live.value, report: top.value, rows: rows.value }),
  });
}

/**
 * The missing-conversation line this launch printed, judged only on a grid that READ with no composer and against a
 * baseline that read: an unread screen or an unknown baseline is never an exit.
 */
function exitOnScreen({
  screen,
  baselineMissing,
  composer,
}: {
  screen: string | undefined;
  baselineMissing: MissingConversationReading | undefined;
  composer: ComposerProbe;
}): ExitLine | undefined {
  if (screen === undefined || baselineMissing === undefined || !gridReadWithoutComposer({ probe: composer })) {
    return undefined;
  }
  return newExitLine({ after: readMissingConversation({ screen }), before: baselineMissing });
}

/**
 * Poll until the launch is proven up — a LIVE record inside this tab under a new pid, carrying the intended id, at a
 * Claude composer (`../../../sessions/reseatConfirmation.ts`) — or a NEW missing-conversation line says it failed,
 * answering the resume menu with 2 once on the way.
 *
 * @param baselineMissing the missing-conversation lines on screen before the line was typed: an old failure left on
 *   screen is not this launch's. `undefined` when that read failed, and then no screen is judged a missing
 *   conversation — a resume that really failed runs out as `UNCONFIRMED`, which names the tab, instead of an old
 *   line relaunching the seat fresh
 * @returns the verdict that ended the poll, or the last `not-confirmed` once the polls ran out
 */
async function confirmRelaunch({
  deps,
  plan,
  launch,
  priorPids,
  baselineMissing,
}: {
  deps: ReseatDeps;
  plan: ReseatPlan;
  launch: ReseatLaunch;
  priorPids: ReadonlySet<number>;
  baselineMissing: MissingConversationReading | undefined;
}): Promise<ReseatConfirmation> {
  const workspaceId = plan.workspace.workspaceId;
  let answeredMenu = false;
  let verdict: ReseatConfirmation = { kind: "not-confirmed", reason: "nothing was read yet" };
  let sightings = NO_EXIT_SIGHTINGS;
  for (let poll = 0; poll < deps.confirmPolls; poll += 1) {
    await deps.pause();
    const screen = await deps.client.readScreen({ target: { workspaceId } });
    if (!answeredMenu && screen.isOk() && screenShowsResumeMenu({ screen: screen.value })) {
      // The owner's standing answer (`skills/supervisor/reference/reboot.md`): resume the full session as-is.
      await deps.client.sendLine({ target: { workspaceId }, text: "2" });
      answeredMenu = true;
    }
    const composer = await probeComposer({ client: deps.client, target: { workspaceId } });
    const exit = exitOnScreen({ baselineMissing, composer, screen: screen.isOk() ? screen.value : undefined });
    // Claude exits on the missing-conversation line, so that verdict needs no process evidence: a tab whose processes
    // will not read still gets its one fresh retry rather than running out as UNCONFIRMED. It does need a grid that
    // READ with no composer, never one that would not read, and ONE exit standing unchanged on consecutive
    // reads, so a quote drawn before Claude's chrome is never one, nor are two different ones.
    sightings = nextExitSightings({ exit, sightings });
    if (sightings.count >= EXIT_SIGHTINGS_TO_FAIL) {
      return { kind: "missing-conversation" };
    }
    const inTab = await liveInThisTab({ deps, workspaceId });
    if (inTab.isErr()) {
      verdict = { kind: "not-confirmed", reason: inTab.error };
      continue;
    }
    verdict = judgeReseatConfirmation({
      composer,
      inTab: inTab.value,
      intended: launch,
      missingConversationSeen: false,
      priorPids,
    });
    if (verdict.kind !== "not-confirmed") {
      return verdict;
    }
  }
  return verdict;
}

/**
 * Wait for a tab whose resume just failed to be back at its bare prompt, so a fresh line can be typed into the shell
 * and never into a program. Claude exits on the missing-conversation line, so this is usually the first read.
 *
 * @param deps the pass's effects, whose pacing spaces the reads
 * @param plan the seat's relaunch, naming the tab to read
 * @returns at the prompt, or the refusal naming why not
 */
export async function awaitPromptAfterFailedResume({
  deps,
  plan,
}: {
  deps: ReseatDeps;
  plan: ReseatPlan;
}): Promise<Result<void, ReseatError>> {
  let why = "it was not read";
  for (let poll = 0; poll < deps.coldShellPolls; poll += 1) {
    const prompt = await judgeWorkspaceAtPrompt({ deps, workspace: plan.workspace });
    if (prompt.isErr()) {
      why = prompt.error.message;
    } else if (prompt.value.kind === "at-prompt") {
      return ok(undefined);
    } else {
      why = prompt.value.why;
    }
    await deps.pause();
  }
  return err(
    ReseatErrors.relaunchFailed({
      afterStop: true,
      cause: `its resume printed No conversation found, and the tab never came back to a bare prompt (${why})`,
      step: "relaunching fresh once",
      workspaceRef: plan.workspace.workspaceRef,
    }),
  );
}

/**
 * Type one launch line and read it back.
 *
 * @param deps the pass's effects
 * @param plan the seat's relaunch, naming the tab
 * @param launch whether the line resumes a session id or boots a fresh one, which the read-back must find
 * @param line the composed launch line
 * @param priorPids the pids already carrying the session id, which the read-back must not mistake for the relaunch
 * @param afterStop whether a live claude was already stopped, for the refusal's way back
 * @returns the verdict that ended the read-back — never `not-confirmed`, which is the `UNCONFIRMED` refusal
 */
export async function typeAndConfirm({
  deps,
  plan,
  launch,
  line,
  priorPids,
  afterStop,
}: {
  deps: ReseatDeps;
  plan: ReseatPlan;
  launch: ReseatLaunch;
  line: string;
  priorPids: ReadonlySet<number>;
  afterStop: boolean;
}): Promise<Result<Exclude<ReseatConfirmation, { readonly kind: "not-confirmed" }>, ReseatError>> {
  const workspaceRef = plan.workspace.workspaceRef;
  const workspaceId = plan.workspace.workspaceId;
  const baselineMissing = await missingConversationsOnScreen({ deps, workspaceId });
  const sent = await deps.client.sendLine({ target: { workspaceId }, text: line });
  if (sent.isErr()) {
    return err(
      ReseatErrors.relaunchFailed({
        afterStop,
        cause: sent.error.message,
        step: "typing the relaunch line",
        workspaceRef,
      }),
    );
  }
  const verdict = await confirmRelaunch({ baselineMissing, deps, launch, plan, priorPids });
  if (verdict.kind === "not-confirmed") {
    const awaited = launch.kind === "resume" ? launch.sessionId : "a fresh session";
    return err(ReseatErrors.unconfirmed({ seconds: RESEAT_CONFIRM_SECONDS, sessionId: awaited, workspaceRef }));
  }
  return ok(verdict);
}
