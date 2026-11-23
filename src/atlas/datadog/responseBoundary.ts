/**
 * How one admitted Datadog operation's answer is read: a strict boundary per operation, and a refusal naming the
 * field when Datadog's answer drifts from the one that was measured.
 *
 * ## The whole body is the contract
 *
 * The API pass stores each operation's body whole, as an envelope (`apiCall.ts`), so there is no carrier to pick
 * between as JumpCloud has: v1's bare objects and arrays and v2's `{ data, meta, included, links }` documents are
 * each one operation's own schema. A boundary validates and hands the value back untouched; `projection.ts` stays
 * the storage boundary and runs after admission, so a field projection would deny is still refused here first.
 *
 * ## Where a boundary came from is part of it
 *
 * `measured` was declared from the pinned specification checked against live answers (`responseCodegen.ts`).
 * `spec-names-only` belongs to an operation that has never answered this organisation with a body: it holds the
 * specification's kinds and field NAMES with every value unread, so a key outside them is still refused, and
 * coverage says the operation is still owed its measurement rather than calling it read (`apiCoverage.ts` bounds
 * the kind's cell and `syncApiGaps.ts` opens `api-response-boundary-unmeasured`).
 */
import type { z } from "zod";

import { type BoundaryError, defineBoundary } from "#lib/boundary.js";
import type { Result } from "#lib/result.js";

import { type DatadogAtlasError, DatadogAtlasErrors } from "./errors.js";

/**
 * Where one operation's boundary was declared from.
 * @internal
 */
export type DatadogBoundarySource = "measured" | "spec-names-only";

/**
 * One admitted operation's declared read.
 * @internal
 */
export interface DatadogResponseBoundary {
  /** The registry operation this boundary admits, and the name every refusal leads with. */
  readonly surface: string;
  readonly source: DatadogBoundarySource;
  /**
   * Admit one 2xx answer from its body's text.
   *
   * @param input the body's text, with the path and status that produced it, which a non-JSON refusal names
   * @returns the admitted body, or the refusal naming what drifted
   */
  readonly admit: (input: { text: string; path: string; status: number }) => Result<unknown, DatadogAtlasError>;
}

/** A boundary's refusal as this atlas's failure, worded without a byte of the body. */
function admissionError({
  error,
  surface,
  path,
  status,
}: {
  error: BoundaryError;
  surface: string;
  path: string;
  status: number;
}): DatadogAtlasError {
  if (error.code === "BOUNDARY_NOT_JSON") {
    // A 2xx whose body is not JSON is a shape problem, not a transport one, and never an empty answer.
    return DatadogAtlasErrors.unexpectedShape({
      detail: `${path} answered HTTP ${String(status)} with a body that is not JSON`,
      surface,
    });
  }
  return DatadogAtlasErrors.bodyShapeChanged({ drift: error.drift, surface });
}

/**
 * Declare one operation's read from its strict schema.
 *
 * @param surface the registry operation's name
 * @param source whether the schema was measured from live answers or declares only the specification's names
 * @param schema the operation's whole answer, every object a `z.strictObject` — `defineBoundary` throws otherwise
 * @returns the operation's boundary, with its output type erased so a registry of hundreds stays one type
 * @internal
 */
export function defineDatadogResponseBoundary<S extends z.ZodType>({
  surface,
  source,
  schema,
}: {
  surface: string;
  source: DatadogBoundarySource;
  schema: S;
}): DatadogResponseBoundary {
  const boundary = defineBoundary({ endpoint: surface, schema });
  return {
    admit: ({ text, path, status }) =>
      boundary
        .parseJson({ text })
        .map((value): unknown => value)
        .mapErr((error) => admissionError({ error, path, status, surface })),
    source,
    surface,
  };
}
