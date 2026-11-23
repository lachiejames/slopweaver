/**
 * `handover reconcile`'s outcomes half: the owner's Workstreams register read once, projected into the outcomes the fleet is
 * held to, set against the reconciled board, and emitted with the source it was read from.
 *
 * The owner's outcomes are the register's workstreams and nothing else (`../../../supervisor/outcomes/coverage.ts`), so a
 * fresh install whose register is empty has none, and the `--json` document says WHICH of those two states it read as
 * `outcomeSource` — the field `../../../supervisor/outcomes/reconciledOutcomes.ts` reads back strictly.
 */
import type { BoardRow } from "../../../handover/rank.js";
import type { Reconciliation } from "../../../handover/reconcile.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import {
  type CoverageProjection,
  coverageOutcomes,
  type OutcomeReport,
  outcomeCoverage,
} from "../../../supervisor/outcomes/coverage.js";
import type { EmittedOutcomeFields, OutcomeSource } from "../../../supervisor/outcomes/reconciledOutcomes.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { isEmptyRegister } from "../../../workstreams/store/register.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";

/** The owner's outcomes' coverage, which source it read, and the entries left out for citing nothing checkable. */
export interface ReconciledCoverage {
  readonly outcomes: OutcomeReport;
  readonly outcomeSource: OutcomeSource;
  readonly unanchored: readonly string[];
}

/**
 * The owner's Workstreams register, read ONCE for both things the board takes from it: their priorities
 * (`../../../workstreams/queuePriorities.ts`), so the board leads with what their Queue leads with, and their outcomes,
 * which coverage sets the fleet against. An empty register is a fresh install where the owner has kept nothing yet, so
 * `null`; a store that will not answer refuses the whole reconciliation, because reporting no outcomes for a register
 * that is there but unreadable is a clean bill nobody checked.
 *
 * @param home the state home the register lives in
 * @param store the store-backed register
 * @returns its workstreams, `null` when the register is empty, or the line saying why it will not read
 */
export async function outcomeRegister({
  home,
  store,
}: {
  home: string;
  store: WorkstreamStore;
}): Promise<{ workstreams: readonly WorkstreamAggregate[] | null } | { refused: string }> {
  const read = await store.read({ home });
  if (read.isErr()) {
    return {
      refused: `handover reconcile: the owner's Workstreams register did not read (${read.error.code}: ${read.error.message}), so neither their priorities nor their outcomes can be judged`,
    };
  }
  if (isEmptyRegister({ snapshot: read.value })) {
    return { workstreams: null };
  }
  return { workstreams: read.value.workstreams };
}

/**
 * Set the owner's kept outcomes against the reconciled board: an empty register, no outcomes, and a source saying so.
 *
 * @param home the state home whose profile names the bot's own handles
 * @param workstreams the owner's Workstreams register's workstreams, `null` when it is empty
 * @param result the reconciliation whose placed sessions cover an outcome
 * @returns each outcome's coverage, the source it was read from and the entries citing nothing checkable
 */
export function reconcileOutcomes({
  home,
  ranked,
  result,
  workstreams,
}: {
  home: string;
  ranked: readonly BoardRow[];
  result: Reconciliation;
  workstreams: readonly WorkstreamAggregate[] | null;
}): ReconciledCoverage {
  let projection: CoverageProjection = { outcomes: [], unanchored: [] };
  let outcomeSource: OutcomeSource = { kind: "absent" };
  if (workstreams !== null) {
    projection = coverageOutcomes({ workstreams });
    outcomeSource = { count: projection.outcomes.length, kind: "present" };
  }
  const outcomes = outcomeCoverage({
    botHandles: botSelfHandlesFromProfile({ home, reader: "handover reconcile" }),
    outcomes: projection.outcomes,
    placed: [...result.aligned, ...result.misaligned, ...result.unprioritised],
    ranked,
  });
  return { outcomeSource, outcomes, unanchored: projection.unanchored };
}

/**
 * The outcome fields of the `--json` document, in the one shape the strict reader the sweep gate and the successor
 * summary share reads back.
 *
 * @returns `outcomeSource`, `outcomes`, `uncoveredOutcomes` and `unanchoredOutcomes`
 */
export function outcomeFields({ coverage }: { coverage: ReconciledCoverage }): EmittedOutcomeFields {
  return {
    outcomeSource: coverage.outcomeSource,
    outcomes: coverage.outcomes.outcomes,
    unanchoredOutcomes: coverage.unanchored,
    uncoveredOutcomes: coverage.outcomes.uncovered,
  };
}
