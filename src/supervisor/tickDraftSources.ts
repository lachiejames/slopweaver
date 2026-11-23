/**
 * The pure half of `slopweaver supervisor tick-draft`: each document a sweep tick already redirected, turned
 * into the source observation `supervisor tick-record` stores. The documents' own shapes are
 * `./tickDraftShapes.ts`; this file is what each reading MEANS.
 *
 * ## Why this is a verb and not a scratch script
 *
 * Anything done with Python is done in TypeScript inside Slopweaver, typed,
 * tested and exposed through the CLI. The chair built this draft with a per-seat Python script that
 * regex-parsed the gauge's and the watch's TEXT, and HARDCODED six observations outright — the base branch's
 * sha, the listener's arm and pid, the friction report's date, today's landed count, an empty due list. A
 * constant stated as a fresh read is a check that cannot fail: the draft kept asserting a listener pid for
 * hours after that process had been replaced. Reproduce: `grep -n '"pid"\|mainSha\|docsLandedToday'
 * ~/.slopweaver/supervisor-scratch/handoff-<n>/mkdraft<n>.py`.
 *
 * ## The four rules every mapper keeps (Codex plan passes p1 and p2, review passes r1 and r3, on this branch)
 *
 * - **A fact is never filled.** `partial` is complete facts plus the coverage they leave out; a reading that
 *   cannot supply every fact the tick schema demands is `unavailable`, with the reason. A zero, an empty list
 *   or a stand-in label would be the hardcoded constant again under another name. **An empty LIST is that same
 *   fabrication** when everything that would have filled it was dropped — `plans: []` reads as a fleet with
 *   runway, `rows: []` as a quiet schedule — so both mappers refuse rather than report one.
 * - **A supplied document of the wrong shape REFUSES the draft.** `unavailable` is for a source the tick did
 *   not capture, or one the producer could not read; a document that is not the producer's is contract drift,
 *   and downgrading it would hide that.
 * - **The instant is the document's own** where it carries one (the gauge, the due list, the watch report),
 *   and the caller's `--captured` otherwise — which the witness then says. A document captured before the
 *   tick started is `unavailable`, keeping its instant in the diagnostic, never restamped into this tick.
 * - **The witness names the file read and the verb that printed it**, with a `null` exit code: reading a
 *   redirected file does not show how its producer exited.
 */
import { yyyyMmDdTodayPlus } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { sessionWatchRowParts } from "../sessions/watchReport.js";
import { type SupervisorCoreError, SupervisorCoreErrors, supervisorCoreErrorLines } from "./errors.js";
import { capacityObservation, withSeatCeiling } from "./tickCapacityDraft.js";
import {
  type CapturedDocument,
  closeDoneSlice,
  DRAFTED_SOURCES,
  type DraftedSourceKind,
  type DraftFrame,
  datedInstant,
  documentWitness,
  frictionSlice,
  listenerSlice,
  observationOf,
  parseDocument,
  type SourceMapper,
  TICK_DRAFT_COMMAND,
  unavailableObservation,
  velocitySlice,
} from "./tickDraftShapes.js";
import { sessionWatchRowOf, watchSlice } from "./tickDraftWatchShape.js";
import { gaugeObservation } from "./tickGaugeDraft.js";
import { recipeDueObservation } from "./tickRecipeDueDraft.js";
import { reconcileObservation } from "./tickReconcileObservation.js";
import type {
  CloseDoneFacts,
  FrictionFacts,
  ListenerFacts,
  SourceObservation,
  SupervisorTickSources,
  VelocityFacts,
  WatchFacts,
} from "./tickTypes.js";

export {
  type CapturedDocument,
  DRAFTED_SOURCE_KINDS,
  DRAFTED_SOURCES,
  type DraftedSourceKind,
} from "./tickDraftShapes.js";

/** The listener: its grade and arm, or `unavailable` quoting the grade when there is no arm to name. */
const listenerObservation: SourceMapper<ListenerFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "listener", schema: listenerSlice }).map(
    (report): SourceObservation<ListenerFacts> => {
      const witness = documentWitness({ dated: false, kind: "listener", path: capture.path });
      if (report.armId === undefined || report.socketState === undefined) {
        return unavailableObservation({
          diagnostic: `the report names no ${report.armId === undefined ? "arm" : "socket state"}: it grades ${report.grade} — ${report.why}`,
          observedAtIso: frame.capturedIso,
          witness,
        });
      }
      const problems = (report.problems ?? []).map((problem) => `signal problem: ${problem}`);
      const freshness =
        report.freshness?.grade === "stale" ? ["the loop's checkout grades stale against the base branch"] : [];
      return observationOf({
        facts: {
          armId: report.armId,
          grade: report.grade,
          pid: report.pid ?? null,
          socketState: report.socketState,
          why: report.why,
        },
        notes: [...problems, ...freshness],
        observedAtIso: frame.capturedIso,
        verbatimLine: undefined,
        witness,
      });
    },
  );

/** The fleet: every reported row and the suppressed count, from the one document that carries both. */
const watchObservation: SourceMapper<WatchFacts> = ({ capture, frame }) => {
  if (Array.isArray(capture.document)) {
    return err(SupervisorCoreErrors.watchBareArray({ path: capture.path }));
  }
  return parseDocument({ capture, kind: "watch", schema: watchSlice }).map((report): SourceObservation<WatchFacts> => {
    const instant = datedInstant({ capture, documentIso: report.observedAtIso, frame, kind: "watch" });
    if (instant.stale !== undefined) {
      return instant.stale;
    }
    const rows = report.rows.map((parsed) => {
      const row = sessionWatchRowOf({ row: parsed });
      const { name, detail } = sessionWatchRowParts({ row });
      return { on: detail, session: name, state: row.signal };
    });
    // No rows AND a drain that says what it could not see is not a quiet fleet — the same empty-list
    // fabrication the gauge and the due list refuse. No rows with a CLEAN drain is a real reading: the
    // producer reported none, and nothing was dropped on the way.
    if (rows.length === 0 && report.diagnostics.length > 0) {
      return unavailableObservation({
        diagnostic: `${capture.path} reported no session at all, and the drain says what it missed, so the fleet is unread: ${report.diagnostics.join("; ")}`,
        observedAtIso: instant.observedAtIso,
        witness: documentWitness({ dated: true, kind: "watch", path: capture.path }),
      });
    }
    return observationOf({
      facts: { rows, suppressed: report.suppressed },
      notes: report.diagnostics,
      observedAtIso: instant.observedAtIso,
      verbatimLine: undefined,
      witness: documentWitness({ dated: true, kind: "watch", path: capture.path }),
    });
  });
};

/** The sweep's closes: what it actually closed, never what a dry run says it would. */
const closeDoneObservation: SourceMapper<CloseDoneFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "closeDone", schema: closeDoneSlice }).map(
    (report): SourceObservation<CloseDoneFacts> => {
      const witness = documentWitness({ dated: false, kind: "closeDone", path: capture.path });
      if (report.dryRun) {
        return unavailableObservation({
          diagnostic: `${capture.path} is a dry run: it closed nothing, so its counts are what the sweep WOULD do`,
          observedAtIso: frame.capturedIso,
          witness,
        });
      }
      const { counts } = report;
      return observationOf({
        facts: {
          closedChats: counts.closed,
          closedLedgerRows: counts.driftClosed,
          heldBusy: counts.held,
          keptOpen: counts.kept,
        },
        notes: counts.failed > 0 ? [`${String(counts.failed)} close(s) FAILED`] : [],
        observedAtIso: frame.capturedIso,
        verbatimLine: undefined,
        witness,
      });
    },
  );

/** The pace: today's landed count from the producer's own UTC day bucket, or `unavailable` when it has none. */
const velocityObservation: SourceMapper<VelocityFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "velocity", schema: velocitySlice }).map(
    (report): SourceObservation<VelocityFacts> => {
      const witness = documentWitness({ dated: false, kind: "velocity", path: capture.path });
      const today = yyyyMmDdTodayPlus({ days: 0, now: new Date(frame.capturedIso) });
      const bucket = report.docsLandedByDay.find((day) => day.dayKey === today);
      if (bucket === undefined) {
        return unavailableObservation({
          diagnostic: `the report has no ${today} bucket (its days are UTC), so today's landed count is unknown`,
          observedAtIso: frame.capturedIso,
          witness,
        });
      }
      return observationOf({
        facts: { caution: report.caution, docsLandedToday: bucket.landed },
        notes: [],
        observedAtIso: frame.capturedIso,
        verbatimLine: undefined,
        witness,
      });
    },
  );

/**
 * The friction review's standing: whether a report waits, whether anything is still writing them, and the
 * newest report's date. `isStale` is carried rather than derived here because the producer's cadence lives
 * with the gauge (`reflect/frictionReviewGap.ts`), not with the tick that reads it.
 */
const frictionObservation: SourceMapper<FrictionFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "friction", schema: frictionSlice }).map((report) =>
    observationOf({
      facts: { hasGap: report.hasGap, isStale: report.isStale, newestReport: report.latestReportDate },
      notes: [],
      observedAtIso: frame.capturedIso,
      verbatimLine: undefined,
      witness: documentWitness({ dated: false, kind: "friction", path: capture.path }),
    }),
  );

/**
 * A source whose document the caller did not supply.
 *
 * @param kind which source
 * @param frame the tick's own frame
 * @returns the unavailable observation, naming the flag and the verb that would have filled it
 */
function omittedObservation({ kind, frame }: { kind: DraftedSourceKind; frame: DraftFrame }): SourceObservation<never> {
  const { flag, producer } = DRAFTED_SOURCES[kind];
  return unavailableObservation({
    diagnostic: `not supplied: no --${flag} was given, so \`${producer}\` was not recorded this tick`,
    observedAtIso: frame.capturedIso,
    witness: { command: TICK_DRAFT_COMMAND, exitCode: null },
  });
}

/**
 * The three sources no producer can fill today, each carrying the reason rather than a stand-in.
 *
 * @param frame the tick's own frame
 * @returns the depth, github and landings observations
 */
function undraftedSources({
  frame,
}: {
  frame: DraftFrame;
}): Pick<SupervisorTickSources, "depth" | "github" | "landings"> {
  const undrafted = ({ diagnostic }: { diagnostic: string }): SourceObservation<never> =>
    unavailableObservation({
      diagnostic: `not drafted: ${diagnostic}`,
      observedAtIso: frame.capturedIso,
      witness: { command: TICK_DRAFT_COMMAND, exitCode: null },
    });
  return {
    depth: undrafted({
      diagnostic:
        "`session depth` grades a session `review`, which is not a respawn decision, and nothing produces the tick's `respawnCandidate`",
    }),
    github: undrafted({
      diagnostic:
        "no pull-request source reaches this verb, and `github hold --status` carries no pull-request or base-branch facts",
    }),
    landings: undrafted({
      diagnostic:
        "no verb names what landed — `github landing` reports next acts and `velocity` counts landings without identities",
    }),
  };
}

/**
 * One source's observation: its mapper's reading, or the omitted one when no document was supplied for it.
 *
 * @param kind which source
 * @param map that source's mapper
 * @param captures the documents supplied, by source
 * @param frame the tick's own frame
 * @returns the observation, or why the supplied document was refused
 */
function observationFor<TFacts>({
  kind,
  map,
  captures,
  frame,
}: {
  kind: DraftedSourceKind;
  map: SourceMapper<TFacts>;
  captures: Readonly<Partial<Record<DraftedSourceKind, CapturedDocument>>>;
  frame: DraftFrame;
}): Result<SourceObservation<TFacts>, SupervisorCoreError> {
  const capture = captures[kind];
  if (capture === undefined) {
    return ok(omittedObservation({ frame, kind }));
  }
  return map({ capture, frame });
}

/**
 * Every one of the twelve source observations for one tick, from the documents it captured.
 *
 * Nine sources map a producer's document and three never can today ({@link undraftedSources}). Every refusal
 * across all nine documents is reported together, so one run names everything wrong.
 *
 * @param captures the documents supplied, by source
 * @param startedIso when the tick started
 * @param capturedIso the instant the caller asserts its undated documents were captured at
 * @returns the twelve observations, or every refusal
 */
export function draftTickSources({
  captures,
  startedIso,
  capturedIso,
}: {
  captures: Readonly<Partial<Record<DraftedSourceKind, CapturedDocument>>>;
  startedIso: string;
  capturedIso: string;
}): Result<SupervisorTickSources> {
  const frame: DraftFrame = { capturedIso, startedIso };
  const each = <TFacts>(options: {
    kind: DraftedSourceKind;
    map: SourceMapper<TFacts>;
  }): Result<SourceObservation<TFacts>, SupervisorCoreError> => observationFor({ ...options, captures, frame });
  const capacity = each({ kind: "capacity", map: capacityObservation }).andThen((observation) =>
    withSeatCeiling({ capacity: observation, captures, frame }),
  );
  const gauge = each({ kind: "gauge", map: gaugeObservation });
  const listener = each({ kind: "listener", map: listenerObservation });
  const reconcile = each({ kind: "reconcile", map: reconcileObservation });
  const watch = each({ kind: "watch", map: watchObservation });
  const closeDone = each({ kind: "closeDone", map: closeDoneObservation });
  const recipeDue = each({ kind: "recipeDue", map: recipeDueObservation });
  const velocity = each({ kind: "velocity", map: velocityObservation });
  const friction = each({ kind: "friction", map: frictionObservation });
  const all = [capacity, gauge, listener, reconcile, watch, closeDone, recipeDue, velocity, friction];
  const refusals = all.flatMap((result) => (result.isErr() ? supervisorCoreErrorLines({ error: result.error }) : []));
  if (
    refusals.length > 0 ||
    capacity.isErr() ||
    gauge.isErr() ||
    listener.isErr() ||
    reconcile.isErr() ||
    watch.isErr() ||
    closeDone.isErr() ||
    recipeDue.isErr() ||
    velocity.isErr() ||
    friction.isErr()
  ) {
    return err(refusals);
  }
  return ok({
    capacity: capacity.value,
    closeDone: closeDone.value,
    friction: friction.value,
    gauge: gauge.value,
    listener: listener.value,
    recipeDue: recipeDue.value,
    reconcile: reconcile.value,
    velocity: velocity.value,
    watch: watch.value,
    ...undraftedSources({ frame }),
  });
}
