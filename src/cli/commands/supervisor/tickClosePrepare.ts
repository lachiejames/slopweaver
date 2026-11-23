/**
 * The half of `supervisor tick close` that DECIDES: every file read, every validation and the rendered page,
 * before anything outside the tick's own directory is written.
 *
 * The chair's scripts published the page and only then ran `tick-record`, so a malformed action was refused
 * after the briefing had already changed. Here the tick file, the sweep block, the tick row, the record gates,
 * the next prompt and the page are all settled first; `./tickCloseCommit.ts` then writes what was decided.
 * The only writes this half makes land in `tick-<n>/` — the refreshed list, built in a private directory and
 * copied in, the reviewed open-pages copy, and on a refused render the refused page its refusal names — each after
 * checking the directory is still the one the close read, so a refusal leaves the seat's own files exactly as they
 * were.
 */
import { join, resolve } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { archiveBriefingForm } from "../../../briefing/archive.js";
import { briefingErrorLines } from "../../../briefing/errors.js";
import { applySweepBlock } from "../../../briefing/sweepBlock.js";
import { capacityObligation } from "../../../plans/laneShape.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { judgeFleetHealthEscalation } from "../../../supervisor/fleetHealthGate.js";
import { type ArmedSweepPrompt, armSweepPrompt, type OverflowedShift } from "../../../supervisor/sweepPromptArm.js";
import { type CapturedDocument, type DraftedSourceKind } from "../../../supervisor/tickDraftShapes.js";
import type { TickInput } from "../../../supervisor/tickInput.js";
import { ownerTurnSnapshotOf } from "../../../supervisor/tickOwnerTurns.js";
import { type CloseStage, type CloseState, sweepBlockInputOf } from "../../../supervisor/tickPlan.js";
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";
import { judgeVoiceUnread } from "../../../supervisor/voiceUnreadGate.js";
import type { UnreadWord } from "../../../talk/unreadWords.js";
import { supervisorErrorLines } from "./errors.js";
import { fleetHealthRefusalLines } from "./fleetHealthRead.js";
import { steerRiskRefusal } from "./steerRiskRead.js";
import { noWorkClaimRefusal } from "./tickCloseNoWorkClaim.js";
import { renderBoundPage } from "./tickClosePage.js";
import { type CloseRead, readClose } from "./tickCloseRead.js";
import type { ProposedForm } from "./tickCloseRender.js";
import { stoppedRecipesRefusal } from "./tickCloseStoppedRecipes.js";
import type { TickCloseArgs } from "./tickCore.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { assembleSupervisorTickDraft } from "./tickDraftCore.js";
import { homeOutsideSeat, isRegularFile, parseJsonText, readJson, readText } from "./tickFiles.js";
import { finaliseSupervisorTick, parseSupervisorTickDraft, type SupervisorTickDraft } from "./tickRecordCore.js";
import { tickRecordRefusals } from "./tickRecordGates.js";
import { stillSpokenOf } from "./tickRecordVoice.js";

/**
 * How many `earlierToday` notes the pre-sweep archive keeps: the cap less two, so the block this sweep rolls
 * into `earlierToday` never lands the form over it. The chair's own measured value, `--keep-notes 28` on every
 * pass of one chair (`grep -o 'keep-notes [0-9]*' ~/.slopweaver/supervisor-scratch/handoff-<n>/sweep-*.sh | sort | uniq -c`).
 * A COUNT bounds nothing about bytes, so the page is fitted under its byte cap afterwards (`./tickCloseRender.ts`).
 */
const ARCHIVE_KEEP_NOTES = 28;

/** Everything a close validated before its first durable write. */
export interface PreparedClose {
  readonly dir: string;
  readonly tickId: string;
  readonly tickDir: string;
  readonly tickDirIdentity: string;
  readonly input: TickInput;
  readonly inputSha256: string;
  /** The tick file's device and inode when it was validated. */
  readonly inputIdentity: string;
  readonly state: CloseState | undefined;
  readonly owed: readonly CloseStage[];
  readonly formBefore: string;
  readonly formAfter: string;
  readonly archive: Readonly<Record<string, unknown>> | undefined;
  readonly row: SupervisorTickRow;
  /** Every stretch of the owner's the voice gate passed as still being spoken, named once the close has recorded. */
  readonly stillSpoken: readonly UnreadWord[];
  readonly html: string;
  /** The sweep prompt a staying chair re-arms; a chair the cadence sends off prints the hand-off instead. */
  readonly prompt: string;
  /**
   * The whole shift state and the path its pointer names, when it ran over its budget — written by the commit
   * BEFORE the prompt prints, never here, so this half still writes nothing outside `tick-<n>/`.
   */
  readonly overflow: OverflowedShift | undefined;
  /** The seat's `handoff-<n>`, which names the successor's slug. */
  readonly handoff: string;
  readonly nowIso: string;
  readonly home: string;
  /** The `--home` the close was invoked with, which a successor's spawn carries; absent for the ambient home. */
  readonly spawnHome: string | undefined;
  readonly refreshed: boolean;
  /**
   * The sha256 of the staged list's exact bytes when `refreshed`, else `null` — what the close state binds, and what
   * the render and the snapshot promotion are checked against.
   */
  readonly listSha256: string | null;
}

/**
 * The form this sweep proposes: archived to the caps, then the sweep block added. A resumed close reads the
 * form as it stood BEFORE its own first commit, so the block is never added twice. Its page is fitted under the
 * byte cap afterwards, by `renderFittedPage`.
 *
 * @returns the form before, and the swept form beside what the count archive moved out
 */
function proposeForm({
  read,
}: {
  read: CloseRead;
}): Result<{ formBefore: string; proposal: ProposedForm }, TickWorkflowError> {
  const edit = sweepBlockInputOf({
    input: read.input,
    reconcile: read.reconcile,
    reconcilePath: read.reconcilePath,
    seat: read.seat,
  });
  if (edit.isErr()) {
    return err(edit.error);
  }
  const beforePath = join(read.tickDir, "form.before.json");
  const formPath = isRegularFile({ path: beforePath }) ? beforePath : join(read.dir, "form.json");
  const formBefore = readText({ path: formPath });
  const form = formBefore.andThen((text) => parseJsonText({ path: formPath, text }));
  if (formBefore.isErr()) {
    return err(TickWorkflowErrors.captureInvalid({ path: formPath, reason: "the seat's form could not be read" }));
  }
  if (form.isErr()) {
    return err(TickWorkflowErrors.captureInvalid({ path: formPath, reason: "the form would not read as JSON" }));
  }
  const archived = archiveBriefingForm({ form: form.value, keepNotes: ARCHIVE_KEEP_NOTES });
  return applySweepBlock({ form: archived.form, input: edit.value })
    .mapErr((error) =>
      TickWorkflowErrors.preflightRefused({ reasons: briefingErrorLines({ error }), stage: "the sweep block" }),
    )
    .map((swept) => ({ formBefore: formBefore.value, proposal: { countArchive: archived, swept: swept.form } }));
}

/** Every drafted source a capture completed, parsed, by source. */
type DraftCaptures = Partial<Record<DraftedSourceKind, CapturedDocument>>;

/**
 * Every drafted source the capture completed, parsed.
 *
 * @returns the captures by source, or the first file that would not parse
 */
function draftCaptures({ read }: { read: CloseRead }): Result<DraftCaptures, TickWorkflowError> {
  const captures: DraftCaptures = {};
  for (const reading of read.capture.readings) {
    if (reading.draftSource === undefined || !reading.completed || reading.bytes === 0) {
      continue;
    }
    const path = join(read.tickDir, reading.file);
    const document = readJson({ path });
    if (document.isErr()) {
      return err(TickWorkflowErrors.captureInvalid({ path, reason: document.error }));
    }
    captures[reading.draftSource] = { document: document.value, path };
  }
  return ok(captures);
}

/**
 * The close-only fleet health gate: a tick that read a tripped verdict and posted nothing is refused. Close-only
 * because `tick close` is the one path a sweep takes; the hatch is read only when the gate would refuse.
 *
 * @returns the refusal block, or nothing when the verdict is clear or its note is up
 */
async function fleetHealthRefusal({
  deps,
  home,
  nowIso,
}: {
  deps: SupervisorTickDeps;
  home: string;
  nowIso: string;
}): Promise<readonly (readonly string[])[]> {
  const verdict = judgeFleetHealthEscalation({ read: await deps.readFleetHealth({ home, nowIso }) });
  if (verdict.kind === "clean" || deps.fleetHatchOpen()) {
    return [];
  }
  return [fleetHealthRefusalLines({ verdict })];
}

/**
 * The tick row this sweep records — drafted from the capture, finalised with the owner's turns, and through every
 * record gate `tick-record` applies, plus the close-only fleet health gate.
 *
 * @returns the row and every stretch the voice gate passed as still being spoken, or the gate or field that refused it
 */
async function proposeRow({
  read,
  home,
  deps,
}: {
  read: CloseRead;
  home: string;
  deps: SupervisorTickDeps;
}): Promise<Result<{ row: SupervisorTickRow; stillSpoken: readonly UnreadWord[] }, TickWorkflowError>> {
  const draft = draftRow({ read });
  if (draft.isErr()) {
    return err(draft.error);
  }
  const voice = judgeVoiceUnread({ nowIso: read.nowIso, read: deps.readVoiceUnread({ home, nowIso: read.nowIso }) });
  const recordRefusals = tickRecordRefusals({
    approvedDrafts: deps.readApprovedDrafts({ home }),
    capacity: capacityObligation({ lanes: await deps.readLanes({ home, nowIso: read.nowIso }) }),
    draft: draft.value,
    open: deps.hatches(),
    reconciliation: read.reconcile,
    steers: await deps.readUnpickedSteers({ home, nowIso: read.nowIso }),
    voice,
  });
  const fleetRefusals = await fleetHealthRefusal({ deps, home, nowIso: read.nowIso });
  const steerRead = await deps.readSteerRisk({ home, nowIso: read.nowIso });
  const blocks = [
    ...recordRefusals,
    ...fleetRefusals,
    ...steerRiskRefusal({ hatchIsOpen: deps.steerRiskHatchOpen, read: steerRead }),
    ...stoppedRecipesRefusal({ draft: draft.value, hatchIsOpen: deps.stoppedRecipesHatchOpen, read }),
    ...noWorkClaimRefusal({ hatchIsOpen: deps.noWorkClaimHatchOpen, read }),
  ];
  if (blocks.length > 0) {
    return err(TickWorkflowErrors.preflightRefused({ reasons: blocks.flat(), stage: "the tick record gates" }));
  }
  return ownerTurnSnapshotOf({ document: read.reconcile })
    .mapErr((error) =>
      TickWorkflowErrors.preflightRefused({ reasons: supervisorCoreErrorLines({ error }), stage: "the owner's turns" }),
    )
    .andThen((ownerTurns) =>
      finaliseSupervisorTick({ draft: draft.value, finalisedIso: read.nowIso, ownerTurns })
        .map((row) => ({ row, stillSpoken: stillSpokenOf({ voice }) }))
        .mapErr((reasons) => TickWorkflowErrors.preflightRefused({ reasons, stage: "the tick row" })),
    );
}

/**
 * The tick's draft, assembled from the capture and the chair's filled template and parsed back.
 *
 * @returns the parsed draft, or the draft stage's refusal
 */
function draftRow({ read }: { read: CloseRead }): Result<SupervisorTickDraft, TickWorkflowError> {
  return draftCaptures({ read }).andThen((captures) =>
    assembleSupervisorTickDraft({
      actions: read.input.actions,
      args: {
        actionsPath: read.inputPath,
        capturedIso: read.capture.capturedIso,
        handoff: read.seat.handoff,
        json: false,
        judgementsPath: read.inputPath,
        out: "-",
        sourcePaths: {},
        startedIso: read.capture.startedIso,
        tickId: read.tickId,
        workspace: read.seat.workspace,
      },
      captures,
      judgements: read.input.judgements,
    })
      .andThen((assembled) => parseSupervisorTickDraft({ document: assembled.document }))
      .mapErr((error) =>
        TickWorkflowErrors.preflightRefused({ reasons: supervisorErrorLines({ error }), stage: "the tick draft" }),
      ),
  );
}

/**
 * The prompt the next sweep arms: the standing contract plus the chair's shift words, or the quiet line — its
 * overflow, when the words run over budget, kept under the seat's handoff for the commit to write.
 *
 * @returns the armed prompt, or why it would not render
 */
function nextPrompt({
  read,
  deps,
  home,
}: {
  read: CloseRead;
  deps: SupervisorTickDeps;
  home: string;
}): Result<ArmedSweepPrompt, TickWorkflowError> {
  let shiftState = "";
  if (read.input.shift !== null) {
    shiftState = read.input.shift;
  }
  const stage = "the next sweep prompt";
  return armSweepPrompt({ contractPath: deps.contractPath(), home, scope: read.seat.handoff, shiftState }).mapErr(
    (error) => TickWorkflowErrors.preflightRefused({ reasons: supervisorCoreErrorLines({ error }), stage }),
  );
}

/**
 * Validate the whole close — the only writes are the refreshed list, the reviewed open-pages copy and, on a
 * refused render, the refused page, all inside the tick's own directory. The home is judged FIRST, so a close with a
 * home inside the seat is refused for that whatever else is wrong.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns everything the commit writes, or the first refusal
 */
export async function prepareClose({
  args,
  deps,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
}): Promise<Result<PreparedClose, TickWorkflowError>> {
  const { home = deps.defaultHome() } = args;
  const outside = homeOutsideSeat({ dir: resolve(args.dir), home });
  if (outside.isErr()) {
    return err(outside.error);
  }
  const read = readClose({ args, deps });
  if (read.isErr()) {
    return err(read.error);
  }
  const form = proposeForm({ read: read.value });
  if (form.isErr()) {
    return err(form.error);
  }
  const row = await proposeRow({ deps, home, read: read.value });
  if (row.isErr()) {
    return err(row.error);
  }
  const prompt = nextPrompt({ deps, home, read: read.value });
  if (prompt.isErr()) {
    return err(prompt.error);
  }
  const page = await renderBoundPage({ args, deps, home, proposal: form.value.proposal, read: read.value });
  return page.map(({ archive, formAfter, html, listSha256, refreshed }) => ({
    archive,
    dir: read.value.dir,
    formAfter,
    formBefore: form.value.formBefore,
    handoff: read.value.seat.handoff,
    home,
    html,
    input: read.value.input,
    inputIdentity: read.value.inputIdentity,
    inputSha256: read.value.inputSha256,
    listSha256,
    nowIso: read.value.nowIso,
    overflow: prompt.value.overflow,
    owed: read.value.owed,
    prompt: prompt.value.rendered.prompt,
    refreshed,
    row: row.value.row,
    spawnHome: args.home,
    state: read.value.state,
    stillSpoken: row.value.stillSpoken,
    tickDir: read.value.tickDir,
    tickDirIdentity: read.value.tickDirIdentity,
    tickId: read.value.tickId,
  }));
}
