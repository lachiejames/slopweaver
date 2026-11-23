/**
 * The Queue as the voice counts it, built only when something asks — never on a poll. The voice's window is always on
 * screen, so a projection held eagerly there rebuilt every row each time any register read again, call or no call
 * (`../../lib/queueProjection.ts` carries the measurement).
 *
 * Asked, it is kept until one of its inputs changes: a call holds every poll (`quietLiveTicks`), and a sentence's count
 * check asks on every line the voice says (`./voiceRecordWiring.ts`), so a call projects once rather than per sentence.
 */
import { answeredHere } from "../../lib/liveState";
import { projectQueue, type QueueProjection, type QueueProjectionReadings } from "../../lib/queueProjection";
import type { QueueRow } from "../../lib/queueRows";
import { queueContextRows } from "../../lib/queueShownCounts";
import type { SteerOverlay } from "../../lib/steeredCards";
import type { WorkContext } from "../../lib/workContext";
import type { WorkspacePlacer } from "../../lib/workspacePlacement";
import type { queueShownOf } from "../console/useQueueRows";
import { allDrawnOf, missingOf, parkedRegistersOf } from "../console/useQueueRowsReading";

/** Everything the voice's Queue projection is built from, as it stood at the moment of asking. */
export interface VoiceQueueInputs {
  readonly readings: QueueProjectionReadings;
  readonly placer: WorkspacePlacer;
  /** The keys a press has just settled (`../console/settling.tsx`). */
  readonly settled: readonly string[];
  readonly steers: Pick<SteerOverlay, "hidden" | "revealed">;
}

/** Every reading the projection reads, by name: what decides whether a kept projection still stands. */
const PROJECTED: readonly (keyof QueueProjectionReadings)[] = [
  "acts",
  "board",
  "currency",
  "deferrals",
  "drafts",
  "hands",
  "imports",
  "landing",
  "posts",
  "reviewers",
  "reviews",
  "spoken",
  "standing",
  "workstreams",
];

/**
 * Whether two sets of inputs are the same inputs: each reading, the placer, the settled keys and the steers the very
 * same objects. A reading that arrived again is a new object even when it says the same, so this errs to projecting
 * again, never to keeping a projection over a newer reading.
 *
 * @returns true when every input is identical
 */
export function sameVoiceQueueInputs({ left, right }: { left: VoiceQueueInputs; right: VoiceQueueInputs }): boolean {
  return (
    left.placer === right.placer &&
    left.settled === right.settled &&
    left.steers === right.steers &&
    PROJECTED.every((name) => left.readings[name] === right.readings[name])
  );
}

/**
 * A projector that keeps its last projection until an input changes.
 *
 * @returns the projector: hand it the inputs as they stand, it answers the Queue's rows in both work contexts
 */
export function voiceQueueProjector(): (asked: { inputs: VoiceQueueInputs }) => QueueProjection {
  let kept: { readonly inputs: VoiceQueueInputs; readonly projection: QueueProjection } | undefined;
  return ({ inputs }) => {
    if (kept !== undefined && sameVoiceQueueInputs({ left: kept.inputs, right: inputs })) {
      return kept.projection;
    }
    const projection = projectQueue({
      placer: inputs.placer,
      readings: inputs.readings,
      settled: inputs.settled,
      steers: inputs.steers,
    });
    kept = { inputs, projection };
    return projection;
  };
}

/**
 * What the app's counts are taken over, for the work context a call is in: the same registers, the same missing and
 * drawn facts, and the same rows the Queue's own reading hands {@link queueShownOf}.
 *
 * @param readings the registers and overlays as they stand
 * @param projection the Queue's rows in both work contexts, projected from those readings
 * @param context the work context the owner's page is in, which `shows` filters to — one `contextNow()` reading
 * @param shows whether a row belongs to the work context the owner's page is in
 * @param steersRead whether the `talk steers` reading behind the steer overlay has this page's own first answer, never a
 *   reading handed over on mount — the other row decider beside workstreams, which the Queue's own `splitRead` also waits for
 * @returns the reading `queueShownOf` counts
 */
export function voiceQueueShownReading({
  readings,
  projection,
  context,
  shows,
  steersRead,
}: {
  readings: QueueProjectionReadings;
  projection: QueueProjection;
  context: WorkContext;
  shows: (row: QueueRow) => boolean;
  steersRead: boolean;
}): Parameters<typeof queueShownOf>[0]["reading"] {
  const { board, currency, drafts, hands, imports, landing, posts, reviews, spoken } = readings;
  const registers = parkedRegistersOf({ readings: { board, drafts, hands, imports, landing, posts, reviews } });
  const { otherRows, rows } = queueContextRows({ placeable: projection.placeable, shows });
  return {
    allDrawn: allDrawnOf({ registers }),
    board,
    context,
    drafts,
    hands,
    imports,
    landing,
    missing: missingOf({ cardKeys: new Set(projection.every.map((row) => row.key)), currency, registers, spoken }),
    otherRows,
    posts,
    reviews,
    rows,
    splitRead: steersRead && answeredHere({ state: readings.workstreams }),
  };
}
