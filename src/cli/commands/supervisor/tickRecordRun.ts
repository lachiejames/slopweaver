/**
 * `slopweaver supervisor tick-record` — append one finalised sweep tick to the ledger the fleet briefing's
 * three narrative sections are derived from.
 *
 * The edge only: it reads two documents, takes one instant off the clock, and appends one line. Every
 * decision is pure — `./tickRecordCore.ts` parses the flags and assembles the row,
 * `../../../supervisor/tickOwnerTurns.ts` takes the owner's words off the reconciliation, and
 * `../../../supervisor/tickSchema.ts` is the one door the row comes through.
 *
 * ## Why the owner's turns come from a SECOND document rather than from the draft
 *
 * Because a sweep that could type them could also summarise them, and MEASURED that is exactly
 * what a sweep does: of the 19 owner turns that tick's own reconciliation had read, zero appeared in the
 * page it authored. So the verb takes the reconciliation the tick already ran and copies the turns out of it
 * itself. This is the same forcing `../briefing/renderCore.ts` puts on `yourList` — there is exactly one way
 * to fill the field, and it is not by writing it.
 *
 * ## The five gates run HERE, at the moment the tick is written down
 *
 * A supervisor deviating from the owner's stated outcomes must be structurally impossible, and so must the same
 * on an anomalous load nobody investigated, a free machine beside ready docs nobody was on, a word the owner
 * spoke on a call the chair never read, and a steer over a Queue card no pass acted on.
 * `./tickRecordGates.ts` runs all six over documents this shell read ONCE, and this verb is where they fire, because
 * `tick-record` is the one call every sweep makes LAST — after the fill and the re-arm, per
 * `skills/supervisor/reference/sweep-contract.md` step 14 — so it is the only place that can see both what
 * the tick read and what it then did. A refusal here costs the tick one `cmux spawn` or one recorded hold
 * rationale; the same gap found a day later costs a shift.
 *
 * ## The one residual, stated rather than discovered
 *
 * Both documents are read WHOLE, through `safeJsonParse`, which REFUSES anything past 100 MiB on the
 * rule that there is never a legitimate case to stringify or parse something over a certain size. So a
 * reconciliation that large would fail this verb and take that tick's turns with it — right on the letter.
 *
 * It is not a defect this verb introduces and it is not one it may fix. The ceiling is repository-wide and
 * every other consumer of `handover reconcile --json` reads that document the same way; working around it
 * here would mean stream-parsing one provider document against a standing ruling. MEASURED for scale: the
 * real reconciliation on this install is **448 KB**, about 270 times under the cap. If a document ever does
 * approach it, the fix is in the reconciliation's own output, not here.
 */
import { readFileSync } from "node:fs";

import { slopweaverHome } from "../../../config.js";
import type { HatchId } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { capacityObligation } from "../../../plans/laneShape.js";
import { planRegisterPort } from "../../../plans/port.js";
import type { ApprovedDraftRead } from "../../../supervisor/approvedDraftGate.js";
import {
  productionClaudeCodeVersionDeps,
  readChairAutoCompactions,
  readChairClaudeCodeVersions,
  readClaudeCodeVersions,
  readLiveChairCanon,
  readLiveChairCanonSince,
} from "../../../supervisor/chairCadenceRead.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { ownerTurnSnapshotOf } from "../../../supervisor/tickOwnerTurns.js";
import { appendSupervisorTick } from "../../../supervisor/tickStore.js";
import type { SupervisorTickRow } from "../../../supervisor/tickTypes.js";
import type { UnpickedSteerRead } from "../../../supervisor/unpickedSteerGate.js";
import {
  judgeVoiceUnread,
  type VoiceUnreadRead,
  type VoiceUnreadVerdict,
} from "../../../supervisor/voiceUnreadGate.js";
import { SUPERVISOR_UNREAD_CURSOR } from "../../../talk/unreadCursorStore.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { selectUnreadWords } from "../../../talk/unreadWords.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { talkHomeOf } from "../talk/args.js";
import { type ChairGateEvidence, evidenceLanes, gateChairThenRun, productionChairGateDeps } from "./chairGateRun.js";
import { liveChairBootPlanRead, liveChairClaudeSideRead, liveChairCodexSeatRead } from "./chairSuccessorReads.js";
import { type SupervisorError, SupervisorErrors, supervisorErrorLines } from "./errors.js";
import { approvedDraftHatchOpenLive, readApprovedDraftsLive } from "./tickRecordApprovedDrafts.js";
import { cadenceLines, type TickCadenceReads } from "./tickRecordCadence.js";
import {
  finaliseSupervisorTick,
  parseSupervisorTickDraft,
  parseSupervisorTickRecordArgs,
  SUPERVISOR_TICK_RECORD_USAGE,
  type SupervisorTickDraft,
  type SupervisorTickRecordArgs,
} from "./tickRecordCore.js";
import { type OpenHatches, tickRecordRefusals } from "./tickRecordGates.js";
import { recordedReport } from "./tickRecordOutput.js";
import { readUnpickedSteersLive, steerHatchOpenLive } from "./tickRecordSteers.js";

/**
 * Everything the verb touches outside itself, injected so a test drives the whole thing — the chair cadence's own
 * reads ({@link TickCadenceReads}) among them, declared once there rather than restated here.
 */
export interface SupervisorTickRecordDeps extends TickCadenceReads {
  /** Whether the `uncovered-outcome` hatch is open for this invocation — read by the shell, never here. */
  readonly hatchOpen: () => boolean;
  /**
   * Whether the `undispatched-load` hatch is open. A SECOND seam rather than one combined flag, because the
   * two gates catch different things and opening one must never quietly open the other.
   */
  readonly loadHatchOpen: () => boolean;
  /** Whether the `idle-capacity` hatch is open — a THIRD seam, for the same reason as the second. */
  readonly idleHatchOpen: () => boolean;
  /** Whether the `unseated-recipe-failure` hatch is open — a seventh seam, for the same reason as the second. */
  readonly recipeFailureHatchOpen: () => boolean;
  /** Whether the `unread-voice-words` hatch is open — a FOURTH seam, for the same reason. */
  readonly voiceHatchOpen: () => boolean;
  /**
   * Read the supervisor cursor's unread words off the call files — once, after the row's instant is fixed, so the
   * gate ages each word against the tick itself rather than a second clock read.
   */
  readonly readVoiceUnread: (args: { home: string | undefined; nowIso: string }) => VoiceUnreadRead;
  /** Whether the `unpicked-steers` hatch is open — a FIFTH seam, for the same reason. */
  readonly steerHatchOpen: () => boolean;
  /** Read every steer the owner spoke over a Queue card in the last week, with the Queue's own verdict on each — once. */
  readonly readUnpickedSteers: (args: { home: string | undefined; nowIso: string }) => Promise<UnpickedSteerRead>;
  /** Whether the `approved-draft-held` hatch is open — a SIXTH seam, for the same reason. */
  readonly approvedDraftHatchOpen: () => boolean;
  /** Read the Slack draft register once, folded, for the drafts the owner already approved. */
  readonly readApprovedDrafts: (args: { home: string | undefined }) => ApprovedDraftRead;
  /** Reads one file, or throws. */
  readonly readFile: (args: { path: string }) => string;
  /** Reads the whole of stdin. */
  readonly readStdin: () => string;
  /** The instant the row is finalised at, when `--now` did not supply one. */
  readonly now: () => string;
  /** Appends the validated row. */
  readonly append: (args: { row: SupervisorTickRow; home: string | undefined }) => Result<string>;
  /** The state home a tick names no `--home` for. */
  readonly defaultHome: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read one of the verb's two documents, from a path or from stdin.
 *
 * @param source the path, or `-`
 * @param label what the document is, for the refusal a reader sees
 * @param deps the injected seams
 * @returns the parsed JSON, or the reason it could not be read
 */
function readDocument({
  source,
  label,
  deps,
}: {
  source: string;
  label: string;
  deps: SupervisorTickRecordDeps;
}): Result<unknown, SupervisorError> {
  let raw: string;
  try {
    raw = source === "-" ? deps.readStdin() : deps.readFile({ path: source });
  } catch (error: unknown) {
    return err(SupervisorErrors.documentUnreadable({ cause: error, label }));
  }
  try {
    return ok(safeJsonParse({ label, text: raw }));
  } catch (error: unknown) {
    return err(SupervisorErrors.documentUnreadable({ cause: error, label }));
  }
}

/**
 * Print one refusal's lines, prefixed the way every other line of this verb is.
 *
 * @param lines the refusal
 * @param deps the injected seams
 */
function refuse({ lines, deps }: { lines: readonly string[]; deps: SupervisorTickRecordDeps }): void {
  for (const line of lines) {
    deps.writeDiagnostic(`supervisor tick-record: ${line}`);
  }
}

/** Everything one run reads, each document read ONCE: the row to append and the two documents the gates judge. */
interface TickRecordInputs {
  readonly row: SupervisorTickRow;
  readonly draft: SupervisorTickDraft;
  readonly reconciliation: unknown;
  readonly voice: VoiceUnreadVerdict;
}

/**
 * The home the cadence reads the plan register under: the one `--home` named, else the resolved one. An early
 * return rather than `??`, which `no-silent-fallback` refuses; the absent case is real — no `--home` means the
 * resolved home.
 *
 * @param flag the `--home` value, when one was typed
 * @returns the home to read
 */
function cadenceHome({ deps, flag }: { deps: SupervisorTickRecordDeps; flag: string | undefined }): string {
  if (flag === undefined) {
    return deps.defaultHome();
  }
  return flag;
}

/**
 * The instant the row is finalised at: `--now` when a caller pinned one, else the injected clock.
 *
 * @param args the parsed invocation
 * @param deps the injected seams, for the clock
 * @returns an ISO instant
 */
function finalisedAt({ args, deps }: { args: SupervisorTickRecordArgs; deps: SupervisorTickRecordDeps }): string {
  const pinned = args.now;
  if (pinned === undefined) {
    return deps.now();
  }
  return pinned;
}

/**
 * Read both documents once, parse the draft, take the owner's turns off the reconciliation, and validate the row.
 *
 * ONCE is the point. The gates used to read each document a second time, and a second read of a consumed
 * stdin yields nothing — so `--reconcile -` made every gate take its cannot-read guard and pass the tick.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns the validated row and the documents it was built from, or every reason it was refused
 */
function readInputs({
  args,
  deps,
}: {
  args: SupervisorTickRecordArgs;
  deps: SupervisorTickRecordDeps;
}): Result<TickRecordInputs> {
  const draftDocument = readDocument({ deps, label: "the draft", source: args.draftSource });
  if (draftDocument.isErr()) {
    return err(supervisorErrorLines({ error: draftDocument.error }));
  }
  const reconcileDocument = readDocument({ deps, label: "the reconciliation", source: args.reconcileSource });
  if (reconcileDocument.isErr()) {
    return err(supervisorErrorLines({ error: reconcileDocument.error }));
  }
  const draft = parseSupervisorTickDraft({ document: draftDocument.value });
  if (draft.isErr()) {
    return err(supervisorErrorLines({ error: draft.error }));
  }
  const ownerTurns = ownerTurnSnapshotOf({ document: reconcileDocument.value });
  if (ownerTurns.isErr()) {
    return err(supervisorCoreErrorLines({ error: ownerTurns.error }));
  }
  const row = finaliseSupervisorTick({
    draft: draft.value,
    finalisedIso: finalisedAt({ args, deps }),
    ownerTurns: ownerTurns.value,
  });
  if (row.isErr()) {
    return err(row.error);
  }
  const nowIso = row.value.finalisedIso;
  const voice = judgeVoiceUnread({ nowIso, read: deps.readVoiceUnread({ home: args.home, nowIso }) });
  return ok({ draft: draft.value, reconciliation: reconcileDocument.value, row: row.value, voice });
}

/**
 * Every gate hatch, each read once through its own seam.
 *
 * @param deps the seams carrying one hatch read each
 * @returns one flag per gate
 */
export function openHatches({ deps }: { deps: SupervisorTickRecordDeps }): OpenHatches {
  return {
    approvedDrafts: deps.approvedDraftHatchOpen(),
    idle: deps.idleHatchOpen(),
    load: deps.loadHatchOpen(),
    recipeFailures: deps.recipeFailureHatchOpen(),
    steers: deps.steerHatchOpen(),
    sweep: deps.hatchOpen(),
    voice: deps.voiceHatchOpen(),
  };
}

/**
 * Run `supervisor tick-record` against injected seams.
 *
 * @param rest the argv tail after `supervisor tick-record`
 * @param evidence what the chair gate read on its way past, which the hand-off cadence judges
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runSupervisorTickRecord({
  rest,
  evidence,
  deps,
}: {
  rest: readonly string[];
  evidence: ChairGateEvidence;
  deps: SupervisorTickRecordDeps;
}): Promise<number> {
  const args = parseSupervisorTickRecordArgs({ rest });
  if (args.isErr()) {
    refuse({ deps, lines: args.error });
    deps.writeDiagnostic(SUPERVISOR_TICK_RECORD_USAGE);
    return EXIT_USAGE;
  }
  const inputs = readInputs({ args: args.value, deps });
  if (inputs.isErr()) {
    refuse({ deps, lines: inputs.error });
    return EXIT_ERROR;
  }
  // Before the gates rather than after: a tick they refuse is still a chair that should hand off, and the
  // block must not be lost behind a refusal the chair will fix and re-run past.
  const spawnHome = args.value.home;
  const home = cadenceHome({ deps, flag: spawnHome });
  for (const line of await cadenceLines({ evidence, home, reads: deps, row: inputs.value.row, spawnHome })) {
    deps.writeDiagnostic(line);
  }
  const blocks = tickRecordRefusals({
    approvedDrafts: deps.readApprovedDrafts({ home: args.value.home }),
    capacity: capacityObligation({ lanes: evidenceLanes({ evidence }) }),
    draft: inputs.value.draft,
    open: openHatches({ deps }),
    reconciliation: inputs.value.reconciliation,
    // The machine clock, never `--now`: the Queue judges at the real clock, and a later `--now` would slide the
    // read's window past a steer the Queue still owes.
    steers: await deps.readUnpickedSteers({ home: args.value.home, nowIso: deps.now() }),
    voice: inputs.value.voice,
  });
  for (const line of blocks.flat()) {
    deps.writeDiagnostic(line);
  }
  if (blocks.length > 0) {
    return EXIT_ERROR;
  }
  const written = deps.append({ home: args.value.home, row: inputs.value.row });
  if (written.isErr()) {
    refuse({ deps, lines: written.error });
    return EXIT_ERROR;
  }
  const report = recordedReport({ ...inputs.value, json: args.value.json, ledger: written.value });
  for (const line of report.diagnostics) {
    deps.writeDiagnostic(line);
  }
  deps.writeOut(report.out);
  return EXIT_OK;
}

/**
 * The supervisor cursor's unread words, read off the call files.
 *
 * @param home the Slopweaver home the call files live under, or the ambient one
 * @param nowIso the tick's own instant, which each word is aged against
 * @returns the words, or why the call files could not be read
 */
function readSupervisorVoiceUnread({ home, nowIso }: { home: string | undefined; nowIso: string }): VoiceUnreadRead {
  const read = readUnread({ home: talkHomeOf({ home }), name: SUPERVISOR_UNREAD_CURSOR, nowIso });
  if (read.isErr()) {
    return { kind: "unreadable", why: read.error.message };
  }
  const { unparseable, words } = selectUnreadWords({ read: read.value });
  return { kind: "read", neverMarked: read.value.cursor === undefined, unparseable, words };
}

/** One ambient hatch's live read: the variable its register row declares. */
function liveHatch({ id }: { id: HatchId }): () => boolean {
  return () => hatchOpen({ env: process.env, id, nowIso: new Date().toISOString() });
}

/**
 * The real seams: the filesystem, stdin, the clock and the ledger.
 *
 * @returns the production dependencies for {@link runSupervisorTickRecord}
 */
export function productionSupervisorTickRecordDeps(): SupervisorTickRecordDeps {
  const port = planRegisterPort();
  return {
    append: ({ row, home }) =>
      appendSupervisorTick(home === undefined ? { row } : { home, row }).mapErr((error) =>
        supervisorCoreErrorLines({ error }),
      ),
    hatchOpen: liveHatch({ id: "uncovered-outcome" }),
    approvedDraftHatchOpen: approvedDraftHatchOpenLive,
    idleHatchOpen: liveHatch({ id: "idle-capacity" }),
    loadHatchOpen: liveHatch({ id: "undispatched-load" }),
    now: () => new Date().toISOString(),
    recipeFailureHatchOpen: liveHatch({ id: "unseated-recipe-failure" }),
    readClaudeCode: ({ chair }) => ({
      ...readClaudeCodeVersions({ deps: productionClaudeCodeVersionDeps() }),
      perSession: readChairClaudeCodeVersions({ claudeHome: claudeHomeDir(), read: chair }),
    }),
    readChairCanon: readLiveChairCanon,
    readChairAutoCompactions: ({ chair }) => readChairAutoCompactions({ claudeHome: claudeHomeDir(), read: chair }),
    readCodexChairCanon: ({ bootedIso }) => readLiveChairCanonSince({ bootedIso, cwd: process.cwd() }),
    readChairPlans: liveChairBootPlanRead({ port }),
    readPlanRegister: ({ home }) => port.read({ home }),
    readClaudeSide: liveChairClaudeSideRead({ port }),
    readCodexSeat: liveChairCodexSeatRead({ port }),
    defaultHome: slopweaverHome,
    readFile: ({ path }) => readFileSync(path, "utf8"),
    readStdin: () => readFileSync(0, "utf8"),
    readApprovedDrafts: readApprovedDraftsLive,
    readUnpickedSteers: readUnpickedSteersLive,
    readVoiceUnread: readSupervisorVoiceUnread,
    steerHatchOpen: steerHatchOpenLive,
    voiceHatchOpen: liveHatch({ id: "unread-voice-words" }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver supervisor tick-record`, behind the chair gate — a seat off Fable records no tick. */
export const supervisorTickRecordCommand = defineCommand({
  run: (argv) =>
    gateChairThenRun({
      argv,
      deps: productionChairGateDeps({ argv }),
      run: ({ argv: gated, evidence }) =>
        runSupervisorTickRecord({
          deps: productionSupervisorTickRecordDeps(),
          evidence,
          rest: verbTail({ argv: gated, verbs: ["tick-record"] }),
        }),
      verb: "tick-record",
    }),
});
