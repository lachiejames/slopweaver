/**
 * `handover start` / `finish` / `resume` / `ask` / `answer` / `abandon` — the run lifecycle.
 *
 * ## Where the teeth are
 *
 * `start` refuses a doc whose probes already pass. That single refusal is what kills the shipped-but-still-
 * `ready` class a hand sweep found across the board: an agent handed such a doc re-plans finished work, and the
 * cost is a whole session. `finish` refuses to record a run as done while any probe still fails, and prints the
 * residue — the mechanism that would have forced a follow-up doc to exist for the one item that did not land.
 *
 * ## Why `ask` is a first-class verb and not an error path
 *
 * A run that needs something only the owner can settle has SUCCEEDED at the only thing it could do. Recording
 * the question is a legitimate ending, and it is the escape hatch from every gate here — which is what keeps
 * the design from becoming a loop that wakes forever to report it still cannot proceed. It is also the artifact
 * the owner actually wanted: the question, written down, rather than an agent guessing.
 *
 * ## One noun, deliberately
 *
 * The brief specified `handover start`/`finish` plus a separate `slopweaver orchestrate <doc>` noun. Both are
 * implemented here under `handover`, because a second noun would duplicate this one's whole surface — the same
 * slug resolution, the same ledger, the same probe evaluation — and this repo's standing rule is one door per
 * capability. `skills/orchestrate/SKILL.md` is what points at these verbs.
 */

import { readFileSync } from "node:fs";

import { settledAskRefusal } from "../../../handover/askRow.js";
import { ALLOW_STRUCTURAL_PROBE, type BehaviouralProbeMode } from "../../../handover/behaviouralProbe.js";
import { derivedRowState } from "../../../handover/derivedRowState.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { branchCandidates, commitsAhead } from "../../../handover/evaluate.js";
import { runStateOf, type UnknownKindLine } from "../../../handover/ledger.js";
import { pausedRefusal } from "../../../handover/paused.js";
import { computeState, type ProbeResult } from "../../../handover/probe.js";
import {
  closedNextStepLines,
  closedReading,
  keepsOwnershipLine,
  resumePhaseWords,
} from "../../../handover/resumePhase.js";
import { rulingAnchor, rulingWords } from "../../../handover/ruling.js";
import { docHash, readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import { unknownKindNames } from "../../../handover/staleReader.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ChecksReadReader, checksReadGateRefuses } from "./checksReadGate.js";
import { finishedCycleRefuses } from "./finishedCycleGate.js";
import { ALLOW_UNREVIEWED, phaseStopsFinish, residueOf } from "./finishRefusals.js";
import { finishUnderClosingLock } from "./finishUnderLock.js";
import { type LessonsGateVerdict, type LessonsReader, lessonsGateVerdict } from "./lessonsGate.js";
import { askedQuestion, declaredRepo, printParkedResume, printProbes, type RunContext } from "./runContextTypes.js";
import { blockerRefusal, type DependencyDone, landedRefusal } from "./startGates.js";
import { type StartWriter, startUnderClosingLock } from "./startUnderLock.js";
import { type PageReachReaders } from "./uncardedPageGate.js";

/*
 * `SLOPWEAVER_ALLOW_STRUCTURAL_PROBE` (imported above as ALLOW_STRUCTURAL_PROBE) is a SEPARATE variable from
 * ALLOW_UNREVIEWED, deliberately: overriding "a probe still fails" must not silently also override "no probe
 * would ever fail". One variable per risk is this repo's standing shape for a break-glass.
 */

export { type RunContext } from "./runContextTypes.js";

/** How a lifecycle verb failed before it could act. */
export interface RunContextError {
  readonly message: string;
  readonly code: number;
}

/**
 * Find exactly one doc by slug.
 *
 * A slug claimed by two docs is REFUSED rather than resolved. Picking one would make filename order decide
 * which brief a run executed, and that is the class of silent choice this whole feature removes.
 */
function findDoc({ docs, slug }: { docs: readonly HandoverDoc[]; slug: string }): HandoverDoc | RunContextError {
  const matches = docs.filter((doc) => doc.slug === slug);
  if (matches.length === 0) {
    return { code: EXIT_USAGE, message: `no doc on the board claims the slug "${slug}"` };
  }
  if (matches.length > 1) {
    return {
      code: EXIT_ERROR,
      message: `"${slug}" is claimed by ${String(matches.length)} docs: ${matches.map((doc) => doc.path).join(", ")}`,
    };
  }
  return matches[0]!;
}

/**
 * Whether a resolution failed.
 *
 * Discriminated on `code`, which only the error shape carries — a structural test rather than a cast, so adding
 * a field to either shape cannot silently make this answer wrong.
 *
 * @param value the resolution to classify
 * @returns true when it is the failure shape
 */
export function isContextError(value: RunContext | RunContextError): value is RunContextError {
  return "code" in value;
}

/** Narrower twin for the doc lookup, which returns a different success shape. */
function isDocError(value: HandoverDoc | RunContextError): value is RunContextError {
  return "code" in value;
}

/**
 * Resolve a doc, evaluate its probes, and read its journal — everything every verb below needs.
 *
 * @param slug the doc to resolve
 * @param handoverDir where the docs live
 * @param runsDir where run journals live
 * @param base the branch commits are counted against, or `undefined` to resolve the repository's own trunk
 * @param seams the probe evaluator, injected so the verbs stay testable and the command runner stays opt-in
 * @returns the resolved context, or a printable failure
 */
export function runContext({
  slug,
  handoverDir,
  runsDir,
  base,
  seams,
}: {
  slug: string;
  handoverDir: string;
  runsDir: string;
  base: string | undefined;
  seams: (args: { doc: HandoverDoc }) => readonly ProbeResult[];
}): RunContext | RunContextError {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return { code: EXIT_ERROR, message: scan.error.message };
  }
  const found = findDoc({ docs: scan.value.docs, slug });
  if (isDocError(found)) {
    return found;
  }
  const doc = found;
  let text: string;
  try {
    text = readFileSync(doc.path, "utf8");
  } catch {
    return { code: EXIT_ERROR, message: `cannot read ${doc.path}` };
  }
  const journalRead = readRunJournal({ runsDir, slug });
  if (journalRead.isErr()) {
    return { code: EXIT_ERROR, message: journalRead.error.message };
  }
  const run = runStateOf({ events: journalRead.value.events });
  const results = seams({ doc });
  const ahead =
    doc.repo === undefined
      ? 0
      : commitsAhead({
          base,
          candidates: branchCandidates({ declaredBranch: doc.branch, recordedBranch: run.branch, slug }),
          repo: doc.repo,
        });
  return {
    commitsAhead: ahead,
    computed: computeState({ commitsAhead: ahead, results }),
    doc,
    events: journalRead.value.events,
    journal: runJournalPath({ runsDir, slug }),
    results,
    run,
    text,
    unknownKind: journalRead.value.unknownKind,
    unreadable: journalRead.value.unreadable,
  };
}

/**
 * Every reason a run must not open, printed as it is found.
 *
 * `docProblemsRefuse` runs BEFORE `blockerFor`, deliberately. `blockerFor` already refuses a malformed doc,
 * but it reports `blocker.kind` alone — a reader is told "malformed" and never which key was wrong. This
 * prints the parse problems themselves, so the refusal is actionable rather than merely correct.
 *
 * `blockerFor` reads `status:` and probes and knows nothing about `settlement:`, so a settled ask — which
 * keeps `status: ready` by design — walked straight past it and opened a run. See
 * `../../../handover/askRow.ts`'s `settledAskRefusal` for the measured spawn that came of it.
 *
 * @param context the resolved doc and its probe results
 * The blocker itself is `./startGates.ts`'s `blockerRefusal`, which narrows a `waiting` answer to what the board
 * composer does not read as satisfied.
 *
 * @param context the resolved doc and its probe results
 * @param all every doc on the board, for the blocker check
 * @param rerunAllowed whether the caller's environment set the finished-run break-glass
 * @param dependencyDone the board composer's verdict on one dependency
 * @returns true when the run must not open, having already printed why
 */
function startRefused({
  context,
  all,
  rerunAllowed,
  dependencyDone,
}: {
  context: RunContext;
  all: readonly HandoverDoc[];
  rerunAllowed: boolean;
  dependencyDone: DependencyDone;
}): boolean {
  if (docProblemsRefuse({ doc: context.doc, verb: "start" })) {
    return true;
  }
  const settled = settledAskRefusal({ doc: context.doc });
  if (settled !== undefined) {
    logger.error({ msg: `handover start: ${settled}` });
    return true;
  }
  // Ahead of `blockerFor`, which now reports a `paused` blocker too but prints `blocker.kind` alone — the
  // same reason `docProblemsRefuse` runs first. "not startable — paused" tells a reader nothing they can act
  // on; who it waits on, and the verb that changes that, is the whole content of the refusal.
  const paused = pausedRefusal({ doc: context.doc });
  if (paused !== undefined) {
    logger.error({ msg: `handover start: ${paused}` });
    return true;
  }
  if (
    finishedCycleRefuses({
      doc: context.doc,
      events: context.events,
      rerunAllowed,
      unreadableLines: context.unreadable,
      verb: "handover start",
    })
  ) {
    return true;
  }
  const landed = landedRefusal({ context });
  if (landed !== undefined) {
    logger.error({ msg: landed });
    return true;
  }
  const blocked = blockerRefusal({ all, context, dependencyDone });
  if (blocked === undefined) {
    return false;
  }
  logger.error({ msg: blocked });
  return true;
}

/**
 * Open a run.
 *
 * Refuses in three cases, each an exact fact rather than an inference: the doc's probes already pass, a run for
 * this slug is already open, or the board itself blocks the doc. The refusals are asked of the row as it reads
 * under its closing lock, so a settle cannot write the row between them and the `started` append
 * (`./startUnderLock.ts`).
 *
 * @param context the resolved doc
 * @param home the state home the row's closing lock lives under
 * @param runsDir where the journal is written
 * @param branch the branch this run's commits will land on
 * @param nowIso the timestamp to stamp
 * @param all every doc on the board, for the blocker check
 * @param writer who is opening the run, recorded so the stop gate can tell this run from a neighbour's, or
 *   `undefined` when the session cannot be named
 * @param rerunAllowed whether the caller's environment set the finished-run break-glass, deliberately
 *   re-opening a cycle whose journal already reads finished
 * @param dependencyDone the board composer's verdict on one `blockedBy` dependency
 * @returns the process exit code
 */
export function startRun({
  context,
  home,
  runsDir,
  branch,
  nowIso,
  all,
  writer,
  rerunAllowed,
  dependencyDone,
}: {
  context: RunContext;
  home: string;
  runsDir: string;
  branch: string;
  nowIso: string;
  all: readonly HandoverDoc[];
  rerunAllowed: boolean;
  dependencyDone: DependencyDone;
  writer: StartWriter;
}): number {
  return startUnderClosingLock({
    branch,
    context,
    home,
    nowIso,
    refused: (current) => startRefused({ all, context: current, dependencyDone, rerunAllowed }),
    runsDir,
    writer,
  });
}

/**
 * Close a run, or refuse to.
 *
 * @param context the resolved doc
 * @param runsDir where the journal is written
 * @param nowIso the timestamp to stamp
 * @param forced whether the loud override was set
 * @param structuralAllowed whether the behavioural-probe break-glass was set
 * @param mode whether the behavioural-probe rule refuses or only advises
 * @param home the state home whose store selection the lesson gate reads the memories table through
 * @param lessons the `--lessons` flag, whose only accepted value is `none` — an explicit, recorded nothing
 * @param readChecksRead how the checks-read gate reads the raise register; defaults to this install's own,
 *   and is injected by a unit test so the gate is reachable without a state home
 * @param readPageReach how the uncarded-page gate reads the lock-in ledger and hand register; this install's own
 *   when absent
 * @param readLessons how the lesson gate reads what this run recorded; defaults to the memories table, and is
 *   injected by a unit test so the gate's own branches are reachable without a database
 * @param dryRun when true, run every gate above and print the exact `finished` event this would journal,
 *   then exit 0 without writing it — the refusal paths above are unchanged, since a dry run previews a
 *   would-be SUCCESS, not a different set of gates
 * @param park `--park-index` with `--parked-at`: the one park this finish may close, checked on the append's own
 *   read; absent, any park standing
 * @param besideQuestion `--beside-question`, honoured on a dry run only: every gate but the open-question one, so
 *   `handover wake` can ask whether the owner's answer is all a merged park still waits on; only a dry run writes
 *   nothing, so only a dry run may look past the question
 * @returns the process exit code
 */
export async function finishRun({
  context,
  runsDir,
  nowIso,
  forced,
  structuralAllowed,
  mode,
  dryRun = false,
  besideQuestion = false,
  home,
  lessons,
  park,
  readLessons,
  readChecksRead,
  readPageReach,
}: {
  context: RunContext;
  runsDir: string;
  nowIso: string;
  forced: boolean;
  structuralAllowed: boolean;
  mode: BehaviouralProbeMode;
  dryRun?: boolean;
  besideQuestion?: boolean;
  home: string;
  lessons: string | undefined;
  park?: Parameters<typeof finishUnderClosingLock>[0]["park"];
  readLessons?: LessonsReader;
  readChecksRead?: ChecksReadReader;
  readPageReach?: PageReachReaders;
}): Promise<number> {
  const lessonsVerdict = await finishOpeningGates({
    besideQuestion: dryRun && besideQuestion,
    context,
    dryRun,
    home,
    lessons,
    nowIso,
    readChecksRead,
    readLessons,
    runsDir,
  });
  if (lessonsVerdict === "refused") {
    return EXIT_ERROR;
  }
  // The page gate, the probe gates and the write, under the row's closing lock (`./finishUnderLock.ts`).
  return finishUnderClosingLock({
    context,
    dryRun,
    forced,
    forcedLessons: lessonsVerdict === "forced",
    home,
    mode,
    nowIso,
    park,
    readPageReach,
    runsDir,
    structuralAllowed,
  });
}

/**
 * The gates `finish` asks before any probe: the run's phase and the doc's own problems, then the lesson question,
 * then the unread checks of a pull request this run raised. The last two are asked BEFORE the probe residue is computed, deliberately: each is about the run rather
 * than its probes, and a session that has to fix a probe first would answer it a lap later with less context than
 * it has now. See `./checksReadGate.ts` for why the second is a gate.
 *
 * A FORCED lessons pass is not journalled here: it is written under the closing lock once every later gate passed
 * (`./finishUnderLock.ts`), since the forced line counts as an answer and, written here on a run a probe then
 * refuses, would spend the question.
 *
 * @returns `refused` when any gate refused (its lines are printed), else the lessons verdict
 */
async function finishOpeningGates({
  besideQuestion,
  context,
  dryRun,
  home,
  lessons,
  nowIso,
  readChecksRead,
  readLessons,
  runsDir,
}: {
  besideQuestion: boolean;
  context: RunContext;
  dryRun: boolean;
  home: string;
  lessons: string | undefined;
  nowIso: string;
  readChecksRead: ChecksReadReader | undefined;
  readLessons: LessonsReader | undefined;
  runsDir: string;
}): Promise<LessonsGateVerdict> {
  // Each refusal prints its own lines; a later gate is never asked once an earlier one has refused.
  if (phaseStopsFinish({ besideQuestion, context }) || docProblemsRefuse({ doc: context.doc, verb: "finish" })) {
    return "refused";
  }
  const slug = context.doc.slug;
  const verdict = await lessonsGateVerdict({
    deferForced: true,
    dryRun,
    home,
    lessons,
    nowIso,
    readLessons,
    runsDir,
    slug,
    verb: "finish",
  });
  if (verdict === "refused") {
    return verdict;
  }
  if (checksReadGateRefuses({ home, readRegister: readChecksRead, runsDir, slug, verb: "finish" })) {
    return "refused";
  }
  return verdict;
}

/** What a resume says about the lines it could not decode, and which of them this checkout is simply too old for. */
function printUndecodedLines({
  unreadable,
  unknownKind,
}: {
  unreadable: readonly number[];
  unknownKind: readonly UnknownKindLine[];
}): void {
  if (unreadable.length > 0) {
    // Stated, never dropped. A journal line nobody could read is a decision nobody can see.
    logger.out({ line: `  ⚠ ${String(unreadable.length)} journal line(s) unreadable: ${unreadable.join(", ")}` });
  }
  if (unknownKind.length === 0) {
    return;
  }
  // LOUDER than the line above rather than quieter, and that is the design: the ownership guards no longer
  // refuse over these, so this print is the only thing left telling a reader that a decision was recorded
  // here which this checkout cannot interpret. Naming the word is what makes it actionable.
  const words = unknownKindNames({ unknownKind }).join(", ");
  logger.out({
    line:
      `  ⚠ ${String(unknownKind.length)} of those carry kind(s) this checkout's decoder has no case for ` +
      `(${words}) — it predates the build that wrote them. Ownership is still provable, so the lifecycle ` +
      "verbs work; pull the base branch here to read what those lines actually say.",
  });
}

/**
 * Reconstruct a run from the journal alone — the verb a session runs after losing its context.
 *
 * @param context the resolved doc
 * @param events the journal's raw event list, for the tail
 * @param unreadable journal line numbers that could not be decoded
 * @param unknownKind the subset of those this checkout's decoder has no case for, printed with the word
 * @param ownershipLine the foreign-writer warning, when another visible session owns the run
 * @returns the process exit code
 */
export function resumeRun({
  context,
  events,
  unreadable,
  unknownKind,
  ownershipLine,
}: {
  context: RunContext;
  events: readonly { kind: string; atIso: string }[];
  unreadable: readonly number[];
  unknownKind: readonly UnknownKindLine[];
  ownershipLine: string | undefined;
}): number {
  logger.out({ line: `RESUMING ${context.doc.slug}` });
  logger.out({ line: `  doc:     ${context.doc.path}` });
  logger.out({ line: `  repo:    ${declaredRepo({ doc: context.doc })}` });
  // The DERIVED pointer, not the front-matter line: an `artifact` event supersedes it, and a resume that
  // printed the superseded one would send the reader to a page somebody has already repaired.
  const derived = derivedRowState({ doc: context.doc, events: context.events });
  const artifact = derived.artifact;
  logger.out({ line: `  artifact:${artifact === undefined ? " (none)" : ` ${artifact}`}` });
  // Printed HERE rather than left to the eight-event tail below: an old ruling is exactly the
  // thing a fresh session must not have to scroll for, and the tail would have dropped it. The whole point
  // is that every reader of a row reads the owner's word.
  const ruling = derived.ruling;
  if (ruling !== undefined) {
    logger.out({ line: `  ruling:  ${rulingWords({ evidence: ruling })}` });
    logger.out({ line: `           ${rulingAnchor({ evidence: ruling })}` });
  }
  logger.out({ line: `  journal: ${context.journal}` });
  const onBranch = context.run.branch === undefined ? "" : ` on ${context.run.branch}`;
  logger.out({
    line: `  phase:   ${resumePhaseWords({ events: context.events, run: context.run, unreadable: context.unreadable })}${onBranch}`,
  });
  printUndecodedLines({ unknownKind, unreadable });
  printParkedResume({ events: context.events, slug: context.doc.slug });
  logger.out({ line: "" });
  logger.out({ line: "  probes now:" });
  printProbes({ results: context.results });
  logger.out({ line: "" });
  logger.out({ line: "  journal tail:" });
  for (const event of events.slice(-8)) {
    logger.out({ line: `    ${event.atIso}  ${event.kind}` });
  }
  return printResumeEnding({ context, ownershipLine });
}

/**
 * Resume's closing lines: a shipped or UNKNOWN row's own next step, else the ownership line, else the next step.
 *
 * @param context the resolved doc and its journal read
 * @param ownershipLine the foreign-writer warning, when another visible session owns the run
 * @returns the process exit code
 */
function printResumeEnding({
  context,
  ownershipLine,
}: {
  context: RunContext;
  ownershipLine: string | undefined;
}): number {
  const reading = closedReading({ events: context.events, run: context.run, unreadable: context.unreadable });
  // The exit code stays this path's when the reading's own lines replace the ownership line.
  if (ownershipLine !== undefined && !keepsOwnershipLine({ reading })) {
    logger.out({ line: "" });
    closedNextStepLines({ ...context, slug: context.doc.slug }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  }
  if (ownershipLine !== undefined) {
    logger.out({ line: "" });
    // The ownership line itself carries the transfer instruction, and WHICH instruction depends on the
    // holder's liveness — a fixed "release it in the owning session" line here contradicted the dead-holder
    // guidance the renderer now gives, telling a reader to ask a dead session for a release.
    logger.out({ line: `  ${ownershipLine}` });
    return EXIT_OK;
  }
  return printNextStep({ context });
}

/**
 * Whether the doc's own front-matter or `doneWhen:`/`outputs:` failed to parse — refuses unconditionally, with
 * no override, because a probe result computed off a doc nothing could read cannot be trusted in either
 * direction. An unparseable `doneWhen:` entry parses to zero probes and zero failures, so a caller that reads
 * only {@link RunContext.results} sees an EMPTY set and reports it as satisfied — the same overclaim {@link
 * residueOf} exists to remove, reintroduced by never looking at {@link HandoverDoc.problems} at all. Measured:
 * four entries each carrying `name:` alongside `command:` were all dropped this way, and `resume`
 * reported "every probe passes" on a doc none of whose probes had ever been read.
 *
 * @param doc the doc under consideration
 * @param verb the verb refusing, so the printed line matches the command that ran
 * @returns true when it refused, having already printed every reason
 */
function docProblemsRefuse({ doc, verb }: { doc: HandoverDoc; verb: string }): boolean {
  if (doc.problems.length === 0) {
    return false;
  }
  logger.error({
    msg: `handover ${verb}: ${doc.slug}'s front-matter did not parse cleanly, so its probes cannot be trusted:`,
  });
  doc.problems.forEach((problem) => {
    logger.error({ msg: `  - ${problem}` });
  });
  return true;
}

/** The one thing to do next, stated rather than left to be inferred. */
function printNextStep({ context }: { context: RunContext }): number {
  logger.out({ line: "" });
  if (context.run.phase === "closed") {
    // There is no run to close. Journalling `finished` here would write a decision that `runStateOf` then
    // discards, because derivation reads only from the last `started` — the same silent-failure shape `ask` had.
    // A row with no cycle at all is UNSTARTED, and the close advice told a chair a ready row might have landed.
    const lines = closedNextStepLines({
      events: context.events,
      journal: context.journal,
      run: context.run,
      slug: context.doc.slug,
      unreadable: context.unreadable,
    });
    lines.forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_ERROR;
  }
  if (context.run.phase === "waiting-on-owner") {
    logger.out({ line: "  NEXT: this run is waiting on the owner. Do not proceed — the question is:" });
    logger.out({ line: `    ${askedQuestion({ run: context.run })}` });
    return EXIT_OK;
  }
  if (docProblemsRefuse({ doc: context.doc, verb: "resume" })) {
    return EXIT_ERROR;
  }
  const changed = context.run.docHash !== undefined && context.run.docHash !== docHash({ text: context.text });
  if (changed) {
    // The amendment case. An evolved plan that nobody recorded makes its own probes lie, which is the very
    // defect this feature removes — so this is stated as a required action, not a note.
    logger.out({ line: "  NEXT: the DOC HAS CHANGED since this run opened. Record why before continuing:" });
    logger.out({ line: `    slopweaver handover amend ${context.doc.slug} --why "<what changed and why>"` });
    return EXIT_OK;
  }
  const residue = residueOf({ results: context.results });
  logger.out({
    line:
      residue.length === 0
        ? `  NEXT: every probe passes — close it with \`slopweaver handover finish ${context.doc.slug}\``
        : `  NEXT: ${String(residue.length)} probe(s) still unmet — that is the remaining work`,
  });
  return EXIT_OK;
}

/**
 * Whether the loud override is set in an environment.
 *
 * @param env the environment to read
 * @returns true when the override is set to exactly `1`
 */
export function forcedBy({ env }: { env: NodeJS.ProcessEnv }): boolean {
  return env[ALLOW_UNREVIEWED] === "1";
}

/**
 * Whether the behavioural-probe break-glass is set in an environment.
 *
 * @param env the environment to read
 * @returns true when {@link ALLOW_STRUCTURAL_PROBE} is set to exactly `1`
 */
export function structuralAllowedBy({ env }: { env: NodeJS.ProcessEnv }): boolean {
  return env[ALLOW_STRUCTURAL_PROBE] === "1";
}
