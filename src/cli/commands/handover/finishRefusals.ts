/**
 * What stops a run being CLOSED, and what stops one being OPENED — the residue a doc's own probes leave, the
 * blocker kinds that are not really blockers, and the four predicates `finishRun` consults before it
 * journals anything.
 *
 * Split out of {@link ./lifecycle.js} (the file-size ratchet, step 4), which now holds the verbs themselves.
 * It is a LEAF: every predicate here takes a `RunContext` and returns a verdict, so `lifecycle.ts` imports
 * it and it imports `lifecycle.ts` back for nothing.
 */
import {
  ALLOW_STRUCTURAL_PROBE,
  type BehaviouralProbeMode,
  behaviouralProbeBlocks,
  behaviouralProbeGap,
  describeBehaviouralProbeGap,
} from "../../../handover/behaviouralProbe.js";
import type { Blocker, HandoverDoc } from "../../../handover/doc.js";
import type { ProbeResult } from "../../../handover/probe.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { logger } from "../../../lib/logger.js";
import { printProbes, type RunContext } from "./runContextTypes.js";

/** The env var that forces `finish` through a failing probe set, printed loudly whenever it is used. */
export const ALLOW_UNREVIEWED = "SLOPWEAVER_ALLOW_UNREVIEWED";

/**
 * The residue: what a doc still promises that the repository cannot show.
 *
 * A `not-evaluated` probe counts as residue, deliberately. "Nothing looked" is not evidence of doneness, and
 * treating it as one would let a doc close on the strength of a check that never ran.
 *
 * @param results the evaluated probes
 * @returns one note per probe that did not pass
 */
export function residueOf({ results }: { results: readonly ProbeResult[] }): readonly string[] {
  return results.filter((result) => result.outcome !== "pass").map((result) => result.note);
}

/**
 * Whether a blocker should stop a run opening. `in-flight` and `partial` do not — that IS resuming work.
 * Neither does `unevaluated`: nothing has actually failed, only gone unchecked, so there is nothing to stop.
 *
 * @param blocker the doc's current blocker, absent when nothing blocks it
 * @returns true when the blocker must stop the run opening
 */
export function blockingKind({ blocker }: { blocker: Blocker | undefined }): boolean {
  if (blocker === undefined) {
    return false;
  }
  return (
    blocker.kind !== "in-flight" &&
    blocker.kind !== "partial" &&
    blocker.kind !== "unevaluated" &&
    blocker.kind !== "declared-in-progress"
  );
}

/**
 * Whether the behavioural-probe gate stops this close, printing either the refusal or the loud override.
 *
 * This REFUSES rather than advises. `finish` is the transition into `done` that
 * the session doing the work actually types, so it is where the probe still costs nothing to write — see
 * {@link ../../../handover/behaviouralProbe} for the rule and the audit behind it.
 *
 * @param doc the doc being closed
 * @param structuralAllowed the resolved break-glass
 * @param mode whether the rule refuses or only advises — the owner's switch, not this verb's
 * @returns true when the close must not proceed
 */
export function behaviouralProbeRefuses({
  doc,
  structuralAllowed,
  mode,
}: {
  doc: HandoverDoc;
  structuralAllowed: boolean;
  mode: BehaviouralProbeMode;
}): boolean {
  const gap = behaviouralProbeGap({
    doneWhen: doc.doneWhen,
    kind: doc.kind,
    probeWaiver: doc.probeWaiver,
    summary: doc.summary,
  });
  if (gap === undefined) {
    return false;
  }
  if (structuralAllowed && gap.waiver === undefined) {
    logger.error({
      msg: `handover finish: OVERRIDDEN by ${ALLOW_STRUCTURAL_PROBE}=1 — ${doc.slug} closes with no behavioural probe and no \`probeWaiver:\`, so nothing on the board records why. Write one, and say so in the PR.`,
    });
    return false;
  }
  describeBehaviouralProbeGap({ gap, mode, slug: doc.slug, verb: "handover finish" }).forEach((line) => {
    logger.error({ msg: line });
  });
  return behaviouralProbeBlocks({ gap, mode });
}

/**
 * Whether an unmet probe stops this close, printing either the residue or the loud override.
 *
 * @param context the resolved doc and its probe results
 * @param forced whether {@link ALLOW_UNREVIEWED} was set
 * @param residue the unmet probes, as `residueOf` phrased them
 * @param runsDir where the probe snapshot is journalled
 * @param nowIso the timestamp to stamp that snapshot with
 * @returns true when the close must not proceed
 */
export function residueRefuses({
  context,
  forced,
  residue,
  runsDir,
  nowIso,
}: {
  context: RunContext;
  forced: boolean;
  residue: readonly string[];
  runsDir: string;
  nowIso: string;
}): boolean {
  if (residue.length === 0) {
    return false;
  }
  if (forced) {
    logger.error({
      msg: `handover finish: forced through with ${String(residue.length)} probe(s) unmet (${ALLOW_UNREVIEWED})`,
    });
    return false;
  }
  logger.error({ msg: `handover finish: ${context.doc.slug} is PARTIAL — ${String(residue.length)} probe(s) unmet:` });
  printProbes({ results: context.results });
  logger.error({ msg: "Finish them, or split the residue into a follow-up doc. To force it anyway:" });
  logger.error({ msg: `  ${ALLOW_UNREVIEWED}=1 slopweaver handover finish ${context.doc.slug}` });
  recordProbeSnapshot({ context, nowIso, runsDir });
  return true;
}

/**
 * Whether the run's own phase alone stops this close — no run open, or a question still awaits an answer.
 *
 * @param context the resolved doc and its run state
 * @param besideQuestion a dry run's `--beside-question`: the open question is set aside, so the rest of the gates
 *   say whether the owner's answer is all the run still waits on; a closed run still refuses
 * @returns true when the close must not proceed, having printed why and what to run instead
 */
export function phaseStopsFinish({
  besideQuestion = false,
  context,
}: {
  besideQuestion?: boolean;
  context: RunContext;
}): boolean {
  if (context.run.phase === "closed") {
    // There is no run to close. Journalling `finished` here would write a decision that `runStateOf` then
    // discards, because derivation reads only from the last `started` — the same silent-failure shape `ask` had.
    logger.error({ msg: `handover finish: no run is open for ${context.doc.slug}, so there is nothing to close.` });
    logger.error({
      msg: `  if the work has landed: slopweaver handover close ${context.doc.slug} --summary "<what shipped>"`,
    });
    logger.error({ msg: `  if you meant to work on it, \`slopweaver handover start ${context.doc.slug}\` first` });
    return true;
  }
  if (context.run.phase === "waiting-on-owner" && !besideQuestion) {
    logger.error({ msg: `handover finish: ${context.doc.slug} is waiting on an answer, so it is not finished:` });
    const { openQuestion } = context.run;
    // A `waiting-on-owner` run always journalled a question; an absent one means the event is on disk but
    // could not be decoded, and saying that is more use than printing an empty line.
    let question = "(recorded, but unreadable)";
    if (openQuestion !== undefined) {
      question = openQuestion;
    }
    logger.error({ msg: `  question: ${question}` });
    logger.error({ msg: `  answer it: slopweaver handover answer ${context.doc.slug} --answer "<answer>"` });
    return true;
  }
  return false;
}

/** Record what the probes said at this moment, so a later reader sees the state a decision was taken against. */
function recordProbeSnapshot({
  context,
  runsDir,
  nowIso,
}: {
  context: RunContext;
  runsDir: string;
  nowIso: string;
}): void {
  const passed = context.results.filter((result) => result.outcome === "pass").length;
  // Only a probe that LOOKED and failed is a failure. A timed-out or declined one observed nothing, and every
  // other tally in the tree already counts it as unexamined rather than failing.
  const failed = context.results.filter((result) => result.outcome === "fail").length;
  void applyRowEvent({
    event: { atIso: nowIso, failed, kind: "probed", passed },
    runsDir,
    slug: context.doc.slug,
  });
}
