/**
 * The half of `supervisor tick close` that WRITES what `./tickClosePrepare.ts` decided, behind the chair gate:
 * each owed stage in order, each recorded in `close-state.json` as it completes, then the next prompt LAST.
 *
 * No primitive commits a form, two snapshots, a published page and a ledger line together, so the promise is
 * resumability instead: a stage that fails leaves the ones before it recorded, and re-running the same close
 * starts at the first stage it has not done. The ledger stage checks the ledger itself before appending, which
 * closes the one window the state file cannot — a crash between the append and the state write. And the tick
 * file is hashed again past the gate and before EVERY stage (`./tickCloseRecheck.ts`), so an edit made while the gate or an earlier stage
 * ran stops the close instead of committing the input it replaced; the state file then records the
 * validated hash, so a resume under the edit refuses as a conflict. The staged list is held the same way: its
 * digest is checked before every stage, recorded in the state, and `snapshots-resolved` promotes only the exact
 * bytes it hashed. What remains is the instant between one check and its own stage, which no file read can close.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic, writeFileAtomicBytes } from "#lib/writeAtomic.js";

import { type ClosePromptCadence, closePromptOf } from "../../../supervisor/chairHandOffPrompt.js";
import { sweepArmDecision } from "../../../supervisor/chairPolicy.js";
import { keepOverflowed } from "../../../supervisor/shiftOverflowStore.js";
import { type CloseStage, type CloseState, withStageDone } from "../../../supervisor/tickPlan.js";
import {
  type TickWorkflowError,
  TickWorkflowErrors,
  tickWorkflowErrorLines,
} from "../../../supervisor/tickWorkflowErrors.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type ChairGateEvidence, evidenceLanes } from "./chairGateRun.js";
import type { PreparedClose } from "./tickClosePrepare.js";
import { preparedUnchanged } from "./tickCloseRecheck.js";
import { boundListBytes } from "./tickCloseRefresh.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { isRegularFile, tickDirIntact, tickPath } from "./tickFiles.js";
import { judgeTickCadence, type TickCadence } from "./tickRecordCadence.js";
import { stillSpokenLines } from "./tickRecordVoice.js";

/**
 * A path inside this close's tick directory, checked intact immediately before its one use — see `tickPath`.
 *
 * @param name the file inside the tick's directory
 * @returns the path
 */
function inTick({ prepared, name }: { prepared: PreparedClose; name: string }): string {
  return tickPath({ identity: prepared.tickDirIdentity, name, tickDir: prepared.tickDir });
}

/**
 * Write the close's state file, so a failure after this point resumes rather than repeats — never through a tick
 * directory replaced since the close read it.
 *
 * @returns the state as written, or the refusal naming the replaced directory
 */
function saveState({
  state,
  prepared,
}: {
  state: CloseState;
  prepared: PreparedClose;
}): Result<CloseState, TickWorkflowError> {
  const intact = tickDirIntact({ identity: prepared.tickDirIdentity, tickDir: prepared.tickDir });
  if (intact.isErr()) {
    return err(intact.error);
  }
  writeFileAtomic({
    contents: `${JSON.stringify(state, null, 2)}\n`,
    path: join(prepared.tickDir, "close-state.json"),
  });
  return ok(state);
}

/**
 * Write the proposed form, keeping the form it replaced — the one a resumed close proposes from again.
 *
 * @returns nothing
 */
function commitForm({ prepared }: { prepared: PreparedClose }): void {
  if (!isRegularFile({ path: inTick({ name: "form.before.json", prepared }) })) {
    writeFileAtomic({ contents: prepared.formBefore, path: inTick({ name: "form.before.json", prepared }) });
  }
  if (prepared.archive !== undefined) {
    const contents = `${JSON.stringify(prepared.archive, null, 2)}\n`;
    writeFileAtomic({ contents, path: inTick({ name: "briefing-archive.json", prepared }) });
  }
  writeFileAtomic({ contents: prepared.formAfter, path: join(prepared.dir, "form.json") });
}

/**
 * Promote the snapshots this page was rendered from into the seat, so the next render reads what this one did.
 * Each is written by rename, so a link standing at the seat's path is replaced rather than written through onto
 * whatever it names. The owner's list is promoted only as the exact bytes the close bound — read once, hashed,
 * and those same bytes written — so a list replaced in the tick since the render never lands on the seat.
 *
 * @returns nothing, or the line naming the replaced list
 */
function commitSnapshots({ prepared }: { prepared: PreparedClose }): Result<void> {
  // A bound digest is exactly a staged render (`RefreshedList`), so it, not `refreshed`, decides the promotion.
  if (prepared.listSha256 !== null) {
    const path = inTick({ name: "run.json", prepared });
    const bytes = boundListBytes({ listSha256: prepared.listSha256, path });
    if (bytes.isErr()) {
      return err([bytes.error]);
    }
    writeFileAtomicBytes({ bytes: bytes.value, path: join(prepared.dir, "run.json") });
  }
  if (prepared.input.openPagesReviewed && existsSync(inTick({ name: "open-pages.json", prepared }))) {
    const bytes = readFileSync(inTick({ name: "open-pages.json", prepared }));
    writeFileAtomicBytes({ bytes, path: join(prepared.dir, "open-pages.json") });
  }
  return ok(undefined);
}

/** What one stage did: the page URL when it published one, and whether it appended THIS close's ledger row. */
type StageDone = { readonly pageUrl?: string; readonly appended?: true };

/**
 * Perform one commit stage.
 *
 * @returns what the stage did, or the stage's failure lines
 */
async function performStage({
  stage,
  prepared,
  deps,
}: {
  stage: CloseStage;
  prepared: PreparedClose;
  deps: SupervisorTickDeps;
}): Promise<Result<StageDone>> {
  switch (stage) {
    case "form-committed":
      commitForm({ prepared });
      return ok({});
    case "snapshots-resolved":
      return commitSnapshots({ prepared }).map(() => ({}));
    case "page-published": {
      // A store write that fails fails the stage, so `page-published` stays owed and the next close re-publishes.
      const published = await deps.publish({ fragment: prepared.html, home: prepared.home, nowIso: prepared.nowIso });
      return published.map((page) => ({ pageUrl: page.url }));
    }
    case "tick-recorded":
      if (await deps.hasTick({ home: prepared.home, tickId: prepared.tickId })) {
        return ok({});
      }
      return deps.appendTick({ home: prepared.home, row: prepared.row }).map(() => ({ appended: true as const }));
    default: {
      const unreachable: never = stage;
      return unreachable;
    }
  }
}

/**
 * Perform one stage once the tick file is confirmed unchanged, turning a throw into its failure lines.
 *
 * @returns what the stage returned
 */
async function attemptStage({
  stage,
  prepared,
  deps,
}: {
  stage: CloseStage;
  prepared: PreparedClose;
  deps: SupervisorTickDeps;
}): Promise<Result<StageDone>> {
  const unchanged = preparedUnchanged({ prepared });
  if (unchanged.isErr()) {
    return err(tickWorkflowErrorLines({ error: unchanged.error }));
  }
  try {
    return await performStage({ deps, prepared, stage });
  } catch (cause: unknown) {
    return err([cause instanceof Error ? cause.message : String(cause)]);
  }
}

/**
 * Print a close's refusal on the diagnostic lane.
 *
 * @returns the error exit code
 */
function refuse({ error, deps }: { error: TickWorkflowError; deps: SupervisorTickDeps }): number {
  for (const line of tickWorkflowErrorLines({ error })) {
    deps.scratch.writeDiagnostic(`supervisor tick: ${line}`);
  }
  return EXIT_ERROR;
}

/**
 * The chair's hand-off cadence, judged once every stage is recorded — and only by the close that appended the row,
 * because that row is the measurement it judges. A re-run of a recorded close rebuilds the row at a new instant
 * against fresh chair reads, so judging there could hand off on what the recorded tick never measured;
 * it prints the sweep prompt, and the next tick judges. Advisory to the end: a read that throws is named and judges
 * nothing, because the tick is already recorded and an advisory read must never fail it.
 *
 * @returns the cadence, or `not-judged` naming why
 */
async function cadenceOf({
  appended,
  deps,
  evidence,
  prepared,
}: {
  appended: boolean;
  deps: SupervisorTickDeps;
  evidence: ChairGateEvidence;
  prepared: PreparedClose;
}): Promise<TickCadence> {
  if (!appended) {
    return { kind: "not-judged", lines: ["chair cadence: not judged — an earlier close recorded this tick"] };
  }
  try {
    const { home, row, spawnHome } = prepared;
    return await judgeTickCadence({ evidence, home, reads: deps.cadenceReads, row, spawnHome });
  } catch (cause: unknown) {
    const why = errorMessage({ error: cause });
    return { kind: "not-judged", lines: [`chair cadence: not judged — a chair read threw: ${why}`] };
  }
}

/**
 * Report a recorded close: what it recorded, every stretch still being spoken, the chair's hand-off cadence, then
 * the prompt LAST — the hand-off in place of the sweep prompt when the cadence says go (`chairHandOffPrompt.ts`).
 *
 * @param appended whether this close appended the tick's ledger row, the one measurement the cadence may judge
 * @param pageUrl the published page the close recorded
 * @returns nothing
 */
async function reportClose({
  appended,
  deps,
  evidence,
  pageUrl,
  prepared,
}: {
  appended: boolean;
  deps: SupervisorTickDeps;
  evidence: ChairGateEvidence;
  pageUrl: string | undefined;
  prepared: PreparedClose;
}): Promise<void> {
  deps.scratch.writeDiagnostic(
    `supervisor tick close: ${prepared.tickId} recorded; page ${String(pageUrl)}; ` +
      `the owner's list ${prepared.refreshed ? "refreshed" : "NOT refreshed"}`,
  );
  for (const line of stillSpokenLines({ stillSpoken: prepared.stillSpoken })) {
    deps.scratch.writeDiagnostic(`supervisor tick close: ${line}`);
  }
  const cadence = await cadenceOf({ appended, deps, evidence, prepared });
  for (const line of cadence.lines) {
    deps.scratch.writeDiagnostic(`supervisor tick close: ${line}`);
  }
  let close: ClosePromptCadence = { kind: "stay" };
  if (cadence.kind === "judged") {
    close = cadence.close;
  }
  const arm = sweepArmDecision({ lanes: evidenceLanes({ evidence }) });
  let sweepPrompt: string | undefined = prepared.prompt;
  if (arm.kind === "event-woken") {
    sweepPrompt = undefined;
  }
  const last = closePromptOf({ cadence: close, handoff: prepared.handoff, sweepPrompt });
  if (arm.kind === "event-woken" && !last.handOff) {
    deps.scratch.writeDiagnostic(`supervisor tick close: no sweep prompt printed — ${arm.why}`);
  }
  if (last.prompt !== undefined) {
    deps.scratch.writeOut(last.prompt);
  }
}

/**
 * The state this commit starts from: a fresh one binding the list it rendered, or the recorded one — rebound to this
 * attempt's list when it bound none (`null`), because a seat-list close binds nothing and its resume stages a fresh
 * list (`./tickCloseListPolicy.ts`) — but only while its page is still owed. Once `page-published` is done the page
 * on record was rendered from the seat's list, and this attempt's page is never published, so the record stays
 * `null` rather than naming a list no published page showed. A recorded digest is kept as it is: the
 * refresh already refused any list but it.
 *
 * The residue, stated: a publish and its record are two acts, never one, so a process killed after the page went out
 * and before `page-published` was saved leaves a seat-list page live under a record that still owes it. The retry
 * rebinds to its own list, and until that retry publishes, the record names a list the live page did not show. Every
 * stage with an outside effect shares that window; the next successful publish replaces the page and closes it.
 *
 * @returns the state to save before the first stage
 */
function stateToRecord({ prepared }: { prepared: PreparedClose }): CloseState {
  if (prepared.state === undefined) {
    return {
      done: [],
      inputSha256: prepared.inputSha256,
      listSha256: prepared.listSha256,
      schemaVersion: 2,
      tickId: prepared.tickId,
    };
  }
  if (prepared.state.listSha256 === null && !prepared.state.done.includes("page-published")) {
    return { ...prepared.state, listSha256: prepared.listSha256 };
  }
  return prepared.state;
}

/**
 * The commit: every owed stage in order, each recorded as it completes, then the report — the chair's hand-off
 * cadence and the prompt LAST (`reportClose`).
 *
 * @param prepared everything the prepare half decided
 * @param deps the injected seams
 * @param evidence what the chair gate read on its way past, which the cadence judges
 * @returns the exit code
 */
export async function commitClose({
  prepared,
  deps,
  evidence,
}: {
  prepared: PreparedClose;
  deps: SupervisorTickDeps;
  evidence: ChairGateEvidence;
}): Promise<number> {
  const unchanged = preparedUnchanged({ prepared });
  if (unchanged.isErr()) {
    return refuse({ deps, error: unchanged.error });
  }
  const first = saveState({ prepared, state: stateToRecord({ prepared }) });
  if (first.isErr()) {
    return refuse({ deps, error: first.error });
  }
  let state = first.value;
  let appended = false;
  for (const stage of prepared.owed) {
    const done = await attemptStage({ deps, prepared, stage });
    if (done.isErr()) {
      return refuse({ deps, error: TickWorkflowErrors.stageFailed({ reasons: done.error, stage }) });
    }
    const { appended: appendedHere, pageUrl } = done.value;
    if (appendedHere === true) {
      appended = true;
    }
    const published = pageUrl === undefined ? {} : { pageUrl };
    const saved = saveState({ prepared, state: withStageDone({ stage, state, ...published }) });
    if (saved.isErr()) {
      return refuse({ deps, error: saved.error });
    }
    state = saved.value;
    deps.scratch.writeDiagnostic(`supervisor tick close: ${stage}`);
  }
  const overflowKept = keepOverflow({ deps, prepared });
  if (overflowKept.isErr()) {
    return refuse({ deps, error: overflowKept.error });
  }
  await reportClose({ appended, deps, evidence, pageUrl: state.pageUrl, prepared });
  return EXIT_OK;
}

/**
 * Keep an over-budget shift state in the file its prompt's pointer names, BEFORE the prompt prints.
 * Content-addressed, so a rerun of a close whose stages are all done writes the same bytes again: no stage.
 */
function keepOverflow({
  prepared,
  deps,
}: {
  prepared: PreparedClose;
  deps: SupervisorTickDeps;
}): Result<void, TickWorkflowError> {
  return keepOverflowed({ overflow: prepared.overflow })
    .map((lines) => {
      lines.forEach((line) => {
        deps.scratch.writeDiagnostic(`supervisor tick close: ${line}`);
      });
      return undefined;
    })
    .mapErr((reasons) => TickWorkflowErrors.stageFailed({ reasons, stage: "shift-overflow" }));
}
