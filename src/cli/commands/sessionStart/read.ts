/**
 * The one effectful read `session-start` performs: the handover board, assembled exactly as
 * `slopweaver handover list` assembles it.
 *
 * ## Why it goes through `composeBoardModels` rather than reading journals itself
 *
 * The cheap build reads each journal, finds an unanswered `question`, and calls that the slice. It is
 * wrong, and the way it is wrong is the failure this whole feature exists to remove.
 * {@link ../../../handover/boardEvidence} evaluates `LOOKS SHIPPED` BEFORE `waiting-on-owner` —
 * `probesLanded` at :23, `inFlightEvidence` at :172 — so a doc whose probes all pass is finished work even though its
 * journal still holds an open question. Skipping the probes would put that doc in front of the owner as work.
 *
 * So this reads the register's own placement and filters to one section. That is what "read the register,
 * never author one" means mechanically rather than as a slogan.
 *
 * Command probes stay OFF unless asked (`--probe`). The cheap probes are what carry the LOOKS SHIPPED line;
 * the expensive ones sharpen it, and a morning verb that shelled out per doc would not be run.
 *
 * ## The holder's liveness is measured HERE, once, and handed to the pure leg
 *
 * `WAITING ON OWNER` is a placement the register derives from the journal, and a journal cannot notice that
 * the session which wrote it has since died. So this read pairs each doc with what
 * {@link ../../../handover/writerLiveness} says about its holder, and
 * {@link ../../../sessionStart/boardLeg} decides what that means — which keeps every rule pure and every
 * effect on this side of the line.
 *
 * ## Why the PAUSED rows come back beside the slice, and never inside it
 *
 * A row paused on somebody else is explicitly NOT the owner's move — ranking it would put another person's silence at
 * the top of the owner's morning as though it were work the owner could do. But it is not nothing either: the owner's ruling was
 * that a workstream waiting on a person *"should still be remembered"*, with no deadline and no cadence, and
 * a state nobody ever sees is the same as no state. So the read carries them out as their own list, the verb
 * prints them below the ranking as standing context, and no scorer ever touches them.
 *
 * The live-session roster is read ONCE for the whole slice rather than per doc. `writerLivenessNow` rebuilds
 * it on every call, so a ten-doc slice would scan the registry ten times and could classify two docs against
 * two different populations of the same machine — the exact disagreement `defaultSessionsDir`'s own comment
 * exists to prevent.
 */

import { readFileSync } from "node:fs";

import { archivedDependencies, journalEvidence } from "../../../handover/assemble.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { WriterLiveness } from "../../../handover/runOwner.js";
import { writerOf } from "../../../handover/runOwner.js";
import { scanBoard } from "../../../handover/store.js";
import { classifyWriterLiveness } from "../../../handover/writerLiveness.js";
import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import { codexThreadObserver } from "../../../measurement/codexOpenFiles.js";
import type { CodexThreadObservation } from "../../../measurement/codexSessions.js";
import { isAlive } from "../../../measurement/measure.js";
import type { SessionRoster } from "../../../measurement/sessions.js";
import { defaultSessionsDir, discoverSessions, sessionLiveness } from "../../../measurement/sessions.js";
import type { Measured } from "../../../measurement/status.js";
import type { BoardEntry } from "../../../sessionStart/boardLeg.js";
import type { BoardRunEntry } from "../../../sessionStart/inFlightRuns.js";
import type { PausedRow } from "../../../sessionStart/render.js";
import { stateHomePaths } from "../../../stateHome.js";
import { probeStates } from "../handover/probeSweep.js";

/**
 * What one board read produced, including how much of the board it looked at.
 *
 * @internal the contract between this read and the verb's own shell.
 */
export interface BoardRead {
  /** The `WAITING ON OWNER` slice, ready for the board leg. */
  readonly entries: readonly BoardEntry[];
  /**
   * EVERY doc, with its text, journal and holder — the input {@link ../../../sessionStart/inFlightRuns}
   * reads to say which runs a session is inside. Read here rather than in a second scan so the slice and
   * the in-flight set are judged against the same journals at the same instant.
   */
  readonly runs: readonly BoardRunEntry[];
  /** Every doc the board holds, so the verb can say what fraction it is showing. */
  readonly docsRead: number;
  /**
   * Every row parked on a person, in board order — context beside the list, never a row inside it.
   *
   * Read here rather than in a second scan for the reason the runs are: the same models, at the same instant.
   */
  readonly paused: readonly PausedRow[];
}

/**
 * Whether the session holding one run is still alive, judged against a roster read once for the whole slice.
 *
 * @param events the doc's journal, in order
 * @param roster the live-session registry, already read
 * @param codexThread what Codex's open files say about a thread, scanned at most once for the whole slice
 * @returns the verdict, or undefined when the journal names no writer to ask about
 */
export function holderLivenessOf({
  events,
  roster,
  codexThread,
}: {
  events: readonly RunEvent[];
  roster: Measured<SessionRoster>;
  codexThread: (args: { threadId: string }) => CodexThreadObservation;
}): WriterLiveness | undefined {
  const writer = writerOf({ events });
  if (writer === undefined) {
    return undefined;
  }
  return classifyWriterLiveness({
    codexThread,
    processAlive: isAlive,
    sessionLive: ({ sessionId }) => sessionLiveness({ roster, sessionId }),
    writer,
  });
}

/**
 * Read the board and return the slice waiting on the owner.
 *
 * @param handoverDir where the docs live
 * @param home the Slopweaver home, for the runs directory
 * @param base the ref probes count commits against, or undefined to resolve each repository's trunk
 * @param runCommands whether `command:` probes may run
 * @returns the slice and how many docs were read, or the reason the board could not be scanned
 */
export function readWaitingOnOwner({
  handoverDir,
  home,
  base,
  runCommands,
}: {
  handoverDir: string;
  home: string;
  base: string | undefined;
  runCommands: boolean;
}): Result<BoardRead> {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return err([scan.error.message]);
  }
  const docs = scan.value.docs;
  // Read once and pass the same map to both the placement engine and the slice below: two reads would be
  // two different instants, and a journal appended between them would place a doc against events the slice
  // then disagrees with.
  const journals = journalEvidence({ docs, runsDir: stateHomePaths({ home }).runs });
  const models: readonly BoardModel[] = composeBoardModels({
    journals,
    probeStates: probeStates({ base, docs, runCommands }).states,
    resolutionDocs: [...docs, ...archivedDependencies({ docs, handoverDir })],
    roots: docs,
  });
  const roster = discoverSessions({ sessionsDir: defaultSessionsDir() });
  const codexThread = codexThreadObserver();
  const entries: BoardEntry[] = [];
  const runs: BoardRunEntry[] = [];
  const paused: PausedRow[] = [];
  for (const model of models) {
    const events = journals.get(model.doc.slug)!.events;
    const holder = holderLivenessOf({ codexThread, events, roster });
    runs.push({ doc: model.doc, events, holder, text: docText({ path: model.doc.path }) });
    if (model.section === "PAUSED") {
      paused.push({ reason: model.reason, slug: model.doc.slug });
    }
    if (model.section !== "WAITING ON OWNER") {
      continue;
    }
    entries.push({
      events,
      holder,
      repo: model.doc.repo,
      slug: model.doc.slug,
      summary: model.doc.summary,
    });
  }
  return ok({ docsRead: docs.length, entries, paused, runs });
}

/**
 * A doc's whole text, or the empty string when it can no longer be read.
 *
 * The scan already read this file once and parsed it; a doc that vanished between that read and this one
 * simply names no anchors, which can only make a row rank as untouched — never hide one.
 *
 * @param path the doc's path, as the scan recorded it
 * @returns the text, or the empty string
 */
function docText({ path }: { path: string }): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
