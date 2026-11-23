/**
 * `handover start`, `handover finish`, `handover resume`, `handover amend` and `handover sign-off` — the
 * verbs that do not fit the ownership-transfer or orphan-abandon shape. Split out of `lifecycleRun.ts`, which
 * re-exports everything here unchanged; see {@link ./lifecycleRunCore} for the shared resolve/flag machinery
 * this depends on.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { realCmuxCli } from "../../../cmux/sidebar.js";
import { behaviouralProbeMode } from "../../../handover/behaviouralProbe.js";
import { ownershipAmbiguousLines, runStateOf } from "../../../handover/ledger.js";
import { boundParkFlags, probedRepoMoved } from "../../../handover/parkedFinish.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { currentSessionId, foreignRunLine, runOwnership } from "../../../handover/runOwner.js";
import { docHash, readRunJournal } from "../../../handover/runStore.js";
import { summaryCapOffence, summaryCapRefusalLines } from "../../../handover/summaryCap.js";
import { publishRunWorkspaceRef } from "../../../handover/workspaceRefPublish.js";
import { logger } from "../../../lib/logger.js";
import { detectSupervisorSession, type SupervisorSession } from "../../../supervisor/session.js";
import { parseStateDoc, stateDocOffences, stateDocRefusalLines } from "../../../supervisor/stateDoc.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, stringFlagOr } from "../../parseFlags.js";
import { rerunAllowedBy } from "./finishedCycleGate.js";
import { ALLOW_UNREVIEWED } from "./finishRefusals.js";
import { finishRun, forcedBy, resumeRun, startRun, structuralAllowedBy } from "./lifecycle.js";
import {
  holderLiveness,
  lifecycleUsage,
  mutationRefusal,
  nowIso,
  phaseRefusalFor,
  resolve,
  routingFlagSuffix,
  stringFlag,
} from "./lifecycleRunCore.js";
import { RELAY_RECEIPT_TO_STDERR, settleRelaysForWork } from "./relaySettleForWork.js";
import { composeRow } from "./rowRun.js";

/**
 * `handover start` — open a run, refusing work that already looks shipped.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverStart(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "start" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const stateRefusal = supervisorStateRefusal({ statePath: resolved.context.doc.supervisorState });
  if (stateRefusal.length > 0) {
    stateRefusal.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const summaryRefusal = summaryCapRefusalLines({
    offence: summaryCapOffence({
      docPath: resolved.context.doc.path,
      summary: resolved.context.doc.summary,
      text: resolved.context.text,
    }),
  });
  if (summaryRefusal.length > 0) {
    summaryRefusal.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const branch = stringFlagOr({ fallback: resolved.context.doc.slug, name: "branch", parsed: resolved.parsed });
  const base = stringFlag({ name: "base", parsed: resolved.parsed });
  const code = startRun({
    all: resolved.all,
    branch,
    context: resolved.context,
    // The board's own reading of each dependency, so `start` and `handover list` cannot disagree about it.
    dependencyDone: ({ slug }) => {
      const row = composeRow({ base, handoverDir: resolved.handoverDir, home: resolved.home, slug });
      return row.kind === "row" && row.model.satisfiesDependency;
    },
    home: resolved.home,
    nowIso: nowIso(),
    rerunAllowed: rerunAllowedBy({ env: process.env }),
    runsDir: resolved.runsDir,
    writer: currentWriter(),
  });
  if (code === EXIT_OK) {
    await afterStarted({ resolved });
  }
  return code;
}

/**
 * What follows a run's `started` landing on disk: the row's ref pill (never a checklist or a status lane), then
 * every relay answered by this ask filed into it (`./relaySettleForWork.ts`). Neither changes `start`'s exit code.
 *
 * @param resolved the run `start` just opened
 */
async function afterStarted({ resolved }: { resolved: Exclude<ReturnType<typeof resolve>, number> }): Promise<void> {
  publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover start" });
  await settleRelaysForWork({
    dir: resolved.handoverDir,
    home: resolved.home,
    out: RELAY_RECEIPT_TO_STDERR,
    verb: "handover start",
    workSlug: resolved.context.doc.slug,
  });
}

/**
 * The state-doc caps, applied to a doc that declares `supervisorState:`.
 *
 * A doc that declares nothing is not a supervisor doc and is not judged, which is why 200-odd live docs are
 * untouched by this. An unreadable path is not a refusal either: the state doc lives outside this repo and may
 * simply not exist on this machine, and blocking a shift over a missing private file would be a gate refusing
 * something it cannot see rather than something it measured.
 *
 * @param statePath the doc's declared state-doc path, or `undefined` when it declared none
 * @returns the refusal lines, empty when there is nothing to refuse
 */
function supervisorStateRefusal({ statePath }: { statePath: string | undefined }): readonly string[] {
  if (statePath === undefined) {
    return [];
  }
  const expanded = statePath.startsWith("~/") ? join(homedir(), statePath.slice(2)) : statePath;
  let text: string;
  try {
    text = readFileSync(expanded, "utf8");
  } catch {
    return [];
  }
  return stateDocRefusalLines({
    offences: stateDocOffences({ docPath: expanded, shape: parseStateDoc({ text }), text }),
  });
}

/**
 * Who is opening a run, read from the process. The one place `startRun` touches the environment.
 *
 * `undefined` when the session cannot be named, which is the normal case for a `handover start` typed at a plain
 * shell. That records the run as having no writer, which is honest: the stop gate then behaves for it exactly as
 * it did before ownership existed, because there is no neighbour it could damage.
 *
 * @returns the writer to record, or `undefined` when this process is not inside an identifiable session
 */
function currentWriter():
  | { sessionId: string; host: SupervisorSession["host"]; pid: number | undefined; worktree: string | undefined }
  | undefined {
  const detection = detectSupervisorSession({ env: process.env });
  return detection.kind === "active"
    ? { host: detection.session.host, pid: process.pid, sessionId: detection.session.id, worktree: process.cwd() }
    : undefined;
}

/**
 * `handover finish` — close a run, refusing a partial one.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverFinish(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "finish" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const refusal = mutationRefusal({ resolved, verb: "finish" });
  if (refusal !== undefined) {
    return refusal;
  }
  const dryRun = resolved.parsed.values["dry-run"] === true;
  const besideQuestion = resolved.parsed.values["beside-question"] === true;
  if (besideQuestion && !dryRun) {
    logger.error({ msg: "handover finish: --beside-question sets the open question aside on a --dry-run only" });
    return EXIT_USAGE;
  }
  const bound = boundParkFlags({
    parkIndex: stringFlag({ name: "park-index", parsed: resolved.parsed }),
    parkedAt: stringFlag({ name: "parked-at", parsed: resolved.parsed }),
  });
  if (bound.kind === "invalid") {
    logger.error({ msg: `handover finish: ${bound.why}` });
    return EXIT_USAGE;
  }
  const park = bound.kind === "bound" ? bound.park : undefined;
  const moved = probedRepoMoved({
    docRepo: resolved.context.doc.repo,
    probedRepo: stringFlag({ name: "probed-repo", parsed: resolved.parsed }),
  });
  if (moved !== undefined) {
    logger.error({ msg: `handover finish: ${moved}` });
    return EXIT_ERROR;
  }
  const code = await finishRun({
    besideQuestion,
    context: resolved.context,
    dryRun,
    forced: forcedBy({ env: process.env }),
    home: resolved.home,
    lessons: stringFlag({ name: "lessons", parsed: resolved.parsed }),
    mode: behaviouralProbeMode({ env: process.env }),
    nowIso: nowIso(),
    park,
    runsDir: resolved.runsDir,
    structuralAllowed: structuralAllowedBy({ env: process.env }),
  });
  if (code === EXIT_OK && !dryRun) {
    publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover finish" });
  }
  return code;
}

/**
 * `handover resume` — reconstruct a run from the journal after a compaction.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverResume(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "resume" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const read = readRunJournal({ runsDir: resolved.runsDir, slug: resolved.context.doc.slug });
  if (read.isErr()) {
    logger.error({ msg: `handover resume: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const readerSession = currentSessionId({ env: process.env });
  const ownership = runOwnership({
    events: read.value.events,
    sessionId: readerSession,
  });
  // An ambiguous journal derives NO liveness verdict: ownership read off the lines that did parse is a guess,
  // and every transfer verb refuses such a journal, so a verdict could only feed a recommendation that fails.
  // The set is the OWNERSHIP one, not every unreadable line, and it has to be: the transfer verbs stopped
  // refusing over a word this checkout has never heard, so counting one here would print a stand-off line
  // claiming a refusal that no longer happens — recommending against a command that would in fact work.
  const ambiguous = ownershipAmbiguousLines({ journal: read.value }).length > 0;
  // The phase comes from the SAME read the ownership comes from — mixing resolve's earlier read with this
  // one was a TOCTOU an r3 pass caught. The renderer itself suppresses takeover guidance for a closed cycle.
  const freshRun = runStateOf({ events: read.value.events });
  const freshPhase = freshRun.phase;
  const ownershipLine = foreignRunLine({
    docClaim: "one",
    flagSuffix: routingFlagSuffix({ parsed: resolved.parsed }),
    journalAmbiguous: ambiguous,
    liveness: ambiguous || freshPhase === "closed" ? undefined : holderLiveness({ ownership }),
    ownership,
    phase: freshPhase,
    readerIdentified: readerSession !== undefined,
    slug: resolved.context.doc.slug,
  });
  // The renderer gets that same read too, so its phase line and next step can never describe an older journal
  // than the tail printed beside them ("never started" over a tail holding `started`).
  return resumeRun({
    context: {
      ...resolved.context,
      events: read.value.events,
      run: freshRun,
      unknownKind: read.value.unknownKind,
      unreadable: read.value.unreadable,
    },
    events: read.value.events,
    ownershipLine,
    unknownKind: read.value.unknownKind,
    unreadable: read.value.unreadable,
  });
}

/**
 * `handover amend` — record that the doc changed mid-run, and why.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverAmend(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "amend" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const ownership = mutationRefusal({ resolved, verb: "amend" });
  if (ownership !== undefined) {
    return ownership;
  }
  const why = stringFlag({ name: "why", parsed: resolved.parsed });
  if (why === undefined) {
    logger.error({ msg: "handover amend: --why is required — an amendment with no reason is a silent edit" });
    return EXIT_USAGE;
  }
  const refusal = phaseRefusalFor({ resolved, verb: "amend" });
  if (refusal !== undefined) {
    logger.error({ msg: `handover amend: ${refusal}` });
    return EXIT_ERROR;
  }
  const appended = applyRowEvent({
    event: { atIso: nowIso(), docHash: docHash({ text: resolved.context.text }), kind: "amended", why },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover amend: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover amend" });
  logger.out({ line: `handover amend: recorded the amendment for ${resolved.context.doc.slug}` });
  return EXIT_OK;
}

/**
 * `handover sign-off` — record that a SECOND party vouched for this run.
 *
 * ## Why this verb skips both gates every other mutation here uses
 *
 * Deliberate, and the reason is the whole point of the verb rather than a shortcut:
 *
 * - **No `mutationRefusal`.** That gate refuses a write from a session that does not OWN the run, which is
 *   right for every verb that changes the run's own state. A sign-off is by definition from someone other than
 *   the session doing the work, so requiring ownership would make it impossible in exactly the case it exists
 *   for — a supervisor vouching for a run it is not driving.
 * - **No `phaseRefusal`.** That refuses a `closed` phase with "no run is open". The principal case for a
 *   sign-off is a run that has just finished, so refusing closed runs would forbid the main use.
 *
 * ## And it is attributable, never authenticated
 *
 * `--by` defaults to the detected session id, and either way the value is a claim the writer makes about itself.
 * This CLI authenticates no human and no session, so a sign-off is a signature on a note rather than a
 * credential. Its value is that an UNSIGNED closure becomes visible as unsigned — measured, a run
 * closed itself with `doneWhen: []` and rendered as a plain `DONE` no reader could distinguish from a real
 * completion. This does not make that impossible; it makes it VISIBLE, which is the honest claim.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverSignOff(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "sign-off" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const note = stringFlag({ name: "note", parsed: resolved.parsed });
  if (note === undefined || note.trim().length === 0) {
    logger.error({ msg: "handover sign-off: --note is required — a signature with no statement vouches for nothing" });
    logger.error({ msg: lifecycleUsage({ verb: "sign-off" }) });
    return EXIT_USAGE;
  }
  const by = signerOf({ parsed: resolved.parsed });
  if (by === undefined) {
    logger.error({
      msg: "handover sign-off: this process is not inside an identifiable session, so pass --by to name who is signing",
    });
    return EXIT_USAGE;
  }
  const appended = applyRowEvent({
    event: { atIso: nowIso(), by, kind: "signed-off", note: note.trim() },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover sign-off: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover sign-off: recorded ${by}'s sign-off for ${resolved.context.doc.slug}` });
  logger.out({ line: `  journal: ${appended.value.path}` });
  logger.out({
    line: "  attributable, not authenticated — this records who CLAIMS to have signed, which is what makes an unsigned closure visible",
  });
  return EXIT_OK;
}

/**
 * Who a sign-off names: `--by` when given, else the session this process runs in — `undefined` when neither
 * names anyone, which the verb refuses rather than signing anonymously.
 */
function signerOf({ parsed }: { parsed: ParsedFlags }): string | undefined {
  const named = stringFlag({ name: "by", parsed });
  if (named === undefined) {
    return currentSessionId({ env: process.env });
  }
  return named;
}

/** Named so the override is discoverable from the code that honours it. */
export const FINISH_OVERRIDE = ALLOW_UNREVIEWED;
