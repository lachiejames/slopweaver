/**
 * What one live `api` pass reports, and what it needs to run: the vocabulary every stage of the pass speaks.
 *
 * Nothing here calls anything. It is the leaf `./syncApiEntities.ts`, `./syncApiGaps.ts`,
 * `./syncApiPass.ts` and `./syncApi.ts` all stand on, so no stage has to import another one just to name a
 * value it returns. {@link DatadogApiPassDeps} is the seam a test drives the real pass through, a plain
 * object of injected functions rather than a mock.
 */

import type { Result } from "../../lib/result.js";
import type { AtlasProjection } from "../kit/projection.js";
import type { DatadogApiObservation } from "./apiCall.js";
import type { DatadogAtlasError } from "./errors.js";
import type { DatadogKind } from "./model.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";

/**
 * One operation's result, kept together so the cell and the entity are built from the same value.
 *
 * Exported because `apiCoverage.ts` JUDGES these while this module ISSUES them. That is the seam the two
 * files are split along, so the value crossing it is a contract rather than an internal.
 * @internal
 */
export interface DatadogApiOperationOutcome {
  readonly row: DatadogSurfaceRow;
  readonly observation: DatadogApiObservation | null;
  readonly error: DatadogAtlasError | null;
  readonly projection: AtlasProjection | null;
}

/** What one kind's live pass did, which is what the per-kind progress line reports. */
export interface DatadogApiKindOutcome {
  readonly kind: DatadogKind;
  readonly attempted: number;
  readonly answered: number;
  readonly failed: number;
  readonly firstPageOnly: number;
  /** Answers admitted by a boundary declaring the specification's names alone, every value unread. */
  readonly specNamesOnly: number;
  /**
   * How many of THIS ORGANISATION'S OWN records the pass published for this kind, as opposed to operations.
   *
   * Zero for 143 of the 146 kinds, because `estateAcquisition.ts` holds three rows. It is reported per kind
   * rather than only in the total because "the atlas now holds monitors" and "the atlas now holds N
   * things" are the two sentences this finding exists to stop anybody confusing.
   */
  readonly estateRecords: number;
  /** Entries in an estate collection that carried no usable `id`. A zero nobody has to infer. */
  readonly estateUnidentified: number;
}

/** What the whole pass did, which is what `--json` prints. */
export interface DatadogApiSyncOutcome {
  readonly scope: string;
  readonly attempted: number;
  readonly answered: number;
  readonly failed: number;
  readonly firstPageOnly: number;
  /** Answers admitted on the specification's names alone, across every kind: still owed a measurement. */
  readonly specNamesOnly: number;
  readonly fanoutDeferred: number;
  readonly shapeIndexDeferred: number;
  /** This organisation's own records published across every estate-bearing kind. */
  readonly estateRecords: number;
  readonly kinds: readonly DatadogApiKindOutcome[];
  readonly written: readonly string[];
}

/**
 * Where a caller is told what the pass is doing, so 329 requests are not a silent pause.
 *
 * A plain function rather than a logger, because this module is pure over its seams and a test watching the
 * order of kinds must not need a logging framework to do it.
 * @internal
 */
export type DatadogApiProgress = ({ line }: { line: string }) => void;

/** Everything the pass needs that is not the store: the transport, the clock and the progress sink. */
export interface DatadogApiPassDeps {
  /** Issues one admitted operation. Injected, so every branch below is reachable with no network. */
  readonly call: ({ row }: { row: DatadogSurfaceRow }) => Promise<Result<DatadogApiObservation, DatadogAtlasError>>;
  readonly at: string;
  readonly scope: string;
  readonly onProgress?: DatadogApiProgress;
}
