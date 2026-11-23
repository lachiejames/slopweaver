/**
 * The capacity source of `slopweaver supervisor tick-draft`: the `machine capacity --json` slice and its mapper,
 * and the `fleet ceiling --json` slice folded into the same facts. Split from `./tickDraftShapes.ts` and
 * `./tickDraftSources.ts` when the seat ceiling joined them, along the one seam both already had: everything
 * here reads the capacity document or folds into its facts.
 */
import { z } from "zod";

import { ok, type Result } from "#lib/result.js";
import type { CeilingsReading } from "../capacity/ceilings.js";
import { ceilingsReadingSchema } from "../capacity/ceilingsSchema.js";
import type { SupervisorCoreError } from "./errors.js";
import {
  type CapturedDocument,
  type DraftedSourceKind,
  type DraftFrame,
  datedInstant,
  documentWitness,
  observationOf,
  parseDocument,
  type SourceMapper,
  unavailableObservation,
} from "./tickDraftShapes.js";
import type { CapacityFacts, SourceObservation, TickSeatCeiling } from "./tickTypes.js";

/** The slice of `machine capacity --json` the capacity facts map. `holdSubjects` is its `CapacitySubject`. */
const capacitySlice = z.object({
  /**
   * Every plan and machine ceiling, read in the same pass (`../capacity/ceilings.ts`). Optional and outside the
   * mapper's completeness check: an older capture has none, and the machine's own facts are
   * still the whole of what a hold is judged on.
   */
  ceilings: ceilingsReadingSchema.optional(),
  /**
   * The dispatch block `machine capacity --json` reads off the register. OPTIONAL here, and required by the
   * MAPPER instead: an older capacity document carries no block at all,
   * and the honest report for one is `unavailable` naming the missing reading — not a schema parse failure
   * that reads as a broken capture, and not a zero standing in for "nobody looked".
   */
  dispatch: z
    .object({
      backoffSeconds: z.number().nonnegative(),
      covering: z.number().int().nonnegative(),
      open: z.number().int().nonnegative(),
      subject: z.string(),
    })
    .optional(),
  hold: z.boolean(),
  holdSubjects: z.array(z.enum(["memory", "cpu", "boots", "disk"])),
  load: z.object({ load1: z.number() }).optional(),
  /** The 1-minute load the hold is judged at. Optional and outside the completeness check, like `ceilings`. */
  loadHold: z.number().optional(),
  // The three disk readings are optional and are NOT in the mapper's completeness check: a capture taken
  // before they existed, and an install that declares no main checkout, both legitimately carry none, and
  // failing the whole capacity fold over an absent worktree count would hide the load and the compressor too.
  diskFreeGb: z.number().optional(),
  diskHoldFreeGb: z.number().optional(),
  diskUsedPct: z.number().optional(),
  registeredWorktrees: z.number().int().nonnegative().optional(),
  segmentsPct: z.number().optional(),
  swapfileCount: z.number().int().nonnegative().optional(),
  topForeign: z.object({ footprintGb: z.number(), label: z.string().min(1) }).optional(),
  verdict: z.string().min(1),
});

/**
 * The slice of `fleet ceiling --json` a tick keeps: the instant it measured to, and the ceiling as a number or
 * the reason there is none. The per-plan runway behind it stays in the report (`../capacity/seatCeiling.ts`).
 */
const seatCeilingSlice = z.object({
  ceiling: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("measured"), seats: z.number().int().nonnegative() }),
    z.object({ kind: z.literal("unmeasurable"), reason: z.string().min(1) }),
  ]),
  toIso: z.iso.datetime({ offset: true }),
});

/*
 * The disk half of a capacity reading and its ceilings, as OPTIONAL keys rather than keys holding `undefined`.
 *
 * A report written by an older build carries no disk reading or no ceilings,
 * and so does every tick row already in the ledger. The key is therefore ABSENT rather than
 * present-and-undefined, which is what lets `briefing/narrativeSources.ts` drop its two disk clauses on a plain
 * `=== undefined` test and what keeps a round trip through the `.strict()` tick schema byte-identical to what
 * was journalled.
 */
function optionalFacts({
  report,
}: {
  readonly report: {
    readonly ceilings?: CeilingsReading | undefined;
    readonly diskFreeGb?: number | undefined;
    readonly diskHoldFreeGb?: number | undefined;
    readonly diskUsedPct?: number | undefined;
    readonly loadHold?: number | undefined;
    readonly registeredWorktrees?: number | undefined;
  };
}): Pick<
  CapacityFacts,
  "ceilings" | "diskFreeGb" | "diskHoldFreeGb" | "diskUsedPct" | "loadHold" | "registeredWorktrees"
> {
  return {
    ...(report.ceilings === undefined ? {} : { ceilings: report.ceilings }),
    ...(report.diskFreeGb === undefined ? {} : { diskFreeGb: report.diskFreeGb }),
    ...(report.diskHoldFreeGb === undefined ? {} : { diskHoldFreeGb: report.diskHoldFreeGb }),
    ...(report.diskUsedPct === undefined ? {} : { diskUsedPct: report.diskUsedPct }),
    ...(report.loadHold === undefined ? {} : { loadHold: report.loadHold }),
    ...(report.registeredWorktrees === undefined ? {} : { registeredWorktrees: report.registeredWorktrees }),
  };
}

/**
 * Capacity: every scalar the facts demand, or `unavailable` naming the readings the machine could not take.
 *
 * @returns the capacity observation, or why the document was refused
 */
export const capacityObservation: SourceMapper<CapacityFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "capacity", schema: capacitySlice }).map((report) => {
    const witness = documentWitness({ dated: false, kind: "capacity", path: capture.path });
    const { load, segmentsPct, swapfileCount, topForeign, dispatch } = report;
    if (
      load === undefined ||
      segmentsPct === undefined ||
      swapfileCount === undefined ||
      topForeign === undefined ||
      dispatch === undefined
    ) {
      const missing = [
        load === undefined ? ["1-minute load"] : [],
        segmentsPct === undefined ? ["compressor segments"] : [],
        swapfileCount === undefined ? ["swapfile count"] : [],
        topForeign === undefined ? ["top foreign process"] : [],
        dispatch === undefined ? ["anomalous-load dispatch register"] : [],
      ].flat();
      return unavailableObservation({
        diagnostic: `the report carries no ${missing.join(", ")} reading, so its facts are incomplete: ${report.verdict}`,
        observedAtIso: frame.capturedIso,
        witness,
      });
    }
    return observationOf({
      facts: {
        ...optionalFacts({ report }),
        dispatchBackoffSeconds: dispatch.backoffSeconds,
        dispatchCovering: dispatch.covering,
        dispatchOpen: dispatch.open,
        dispatchSubject: dispatch.subject,
        hold: report.hold,
        holdSubjects: report.holdSubjects,
        load1: load.load1,
        segmentsPct,
        swapfileCount,
        topForeignGb: topForeign.footprintGb,
        topForeignLabel: topForeign.label,
      },
      notes: [],
      observedAtIso: frame.capturedIso,
      verbatimLine: report.verdict,
      witness,
    });
  });

/** The ceiling a tick keeps: the number alone, or the reason — the stale reading's own when it predates the tick. */
function tickSeatCeilingOf({
  ceiling,
  stale,
}: {
  ceiling: z.output<typeof seatCeilingSlice>["ceiling"];
  stale: SourceObservation<never> | undefined;
}): TickSeatCeiling {
  if (stale?.status === "unavailable") {
    return { kind: "unmeasurable", reason: stale.diagnostic };
  }
  if (ceiling.kind === "measured") {
    return { kind: "measured", seats: ceiling.seats };
  }
  return { kind: "unmeasurable", reason: ceiling.reason };
}

/**
 * The capacity observation with the measured seat ceiling folded into its facts.
 *
 * A supplied ceiling document of the wrong shape refuses the draft like any other. One measured before this
 * tick started is kept as `unmeasurable`, naming why, so the gate runs its legacy arm rather than filling to
 * another tick's number. With no document, or no capacity facts to fold into, the key stays absent.
 *
 * @param capacity the capacity observation as its own document mapped
 * @param captures the documents supplied, by source
 * @param frame the tick's own frame
 * @returns the observation, or why the ceiling document was refused
 */
export function withSeatCeiling({
  capacity,
  captures,
  frame,
}: {
  capacity: SourceObservation<CapacityFacts>;
  captures: Readonly<Partial<Record<DraftedSourceKind, CapturedDocument>>>;
  frame: DraftFrame;
}): Result<SourceObservation<CapacityFacts>, SupervisorCoreError> {
  const capture = captures.seatCeiling;
  if (capture === undefined) {
    return ok(capacity);
  }
  return parseDocument({ capture, kind: "seatCeiling", schema: seatCeilingSlice }).map(
    (report): SourceObservation<CapacityFacts> => {
      if (capacity.status === "unavailable") {
        return capacity;
      }
      const instant = datedInstant({ capture, documentIso: report.toIso, frame, kind: "seatCeiling" });
      const workingSeatCeiling = tickSeatCeilingOf({ ceiling: report.ceiling, stale: instant.stale });
      return { ...capacity, facts: { ...capacity.facts, workingSeatCeiling } };
    },
  );
}
