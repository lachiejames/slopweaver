/**
 * How one JumpCloud answer is admitted: a strict boundary per paged surface, built from the carrier that surface
 * answers with, and refused by name when the answer drifts.
 *
 * ## Four carriers, and the surface says which
 *
 * JumpCloud answers in four carriers — v1's `{ results, totalCount }`, v2's bare array with its count in
 * `X-Total-Count`, v2's `{ results }`, and one object for a by-id read. A reader that guessed among them would read
 * a surface that changed carrier as a different one at exit 0. So each surface DECLARES its carrier here, and an
 * answer in any other is refused as drift rather than re-guessed.
 *
 * The carrier is shared and the item is not. Every constructor below takes the surface's own item schema, so one
 * carrier helper builds many endpoint contracts, each with its own measured keys.
 *
 * ## An empty body is a carrier too
 *
 * `client.ts` reads a whitespace-only 2xx body as `null`. A surface measured to answer that declares
 * {@link defineJumpcloudEmptyBoundary}, so `null` is its whole contract — and a surface that did NOT declare it
 * refuses an empty body as a changed field instead of reading it as zero records. The empty carrier refuses ANY
 * body, the JSON text `null` included, before parsing: that text parses to the very value an absent body is read as.
 *
 * ## What the admitted page keeps
 *
 * The boundary validates and the page carries the admitted value whole. Redaction (`sensitiveFields.ts`,
 * `projection.ts`) runs after admission exactly as before; a boundary is never a projection, so nothing here
 * nulls or drops a field.
 */
import { z } from "zod";

import { type Boundary, type BoundaryDrift, type BoundaryError, defineBoundary } from "#lib/boundary.js";
import { err, type Result } from "#lib/result.js";

import { type JumpcloudReadError, JumpcloudReadErrors } from "./errors.js";
import { headerTotal, type JumpcloudPage, type JumpcloudPageShape } from "./paging.js";

/** The response headers, lowercased, as `client.ts` hands them on. */
type Headers = Readonly<Record<string, string>>;

/**
 * One paged surface's declared read.
 * @internal
 */
export interface JumpcloudPageBoundary {
  /** The registry surface this boundary admits, and the name every refusal leads with. */
  readonly surface: string;
  /** The carrier the surface answers with — the only one {@link JumpcloudPageBoundary.admit} accepts. */
  readonly carrier: JumpcloudPageShape;
  /**
   * Admit one page from the body's text.
   *
   * @param input the body's text and the response headers, lowercased
   * @returns the admitted page, or the refusal naming what drifted
   */
  readonly admit: (input: { text: string; headers: Headers }) => Result<JumpcloudPage, JumpcloudReadError>;
  /**
   * Admit one page from a value a file decoder already produced (`fileResponses.ts`), which never was JSON text.
   *
   * @param input the decoded value and the response headers, lowercased
   * @returns the admitted page, or the refusal naming what drifted
   */
  readonly admitValue: (input: { value: unknown; headers: Headers }) => Result<JumpcloudPage, JumpcloudReadError>;
}

/** A boundary's refusal as this domain's failure. `parse` never answers `BOUNDARY_NOT_JSON`; only text can. */
function admissionError({
  error,
  surface,
  length,
}: {
  error: BoundaryError;
  surface: string;
  length: number;
}): JumpcloudReadError {
  if (error.code === "BOUNDARY_NOT_JSON") {
    return JumpcloudReadErrors.bodyNotJson({ length, surface });
  }
  return JumpcloudReadErrors.bodyShapeChanged({ drift: error.drift, surface });
}

/** The drift an empty-carrier surface reports when it answers any body at all. */
const BODY_WHERE_NONE_DECLARED: BoundaryDrift = {
  detail: 'new field "(body)" where the surface declares no body',
  kind: "new",
  path: "(body)",
};

/** Wrap one strict boundary and its page reader as a {@link JumpcloudPageBoundary}. */
function pageBoundary<T>({
  boundary,
  carrier,
  page,
}: {
  boundary: Boundary<T>;
  carrier: JumpcloudPageShape;
  page: (input: { value: T; headers: Headers }) => JumpcloudPage;
}): JumpcloudPageBoundary {
  const surface = boundary.endpoint;
  return {
    admit: ({ text, headers }) => {
      const empty = text.trim().length === 0;
      // JSON text can parse to the `null` an empty body is read as, so the empty carrier refuses any body first.
      if (carrier === "empty" && !empty) {
        return err(JumpcloudReadErrors.bodyShapeChanged({ drift: [BODY_WHERE_NONE_DECLARED], surface }));
      }
      const admitted = empty ? boundary.parse({ value: null }) : boundary.parseJson({ text });
      return admitted
        .map((value) => page({ headers, value }))
        .mapErr((error) => admissionError({ error, length: text.length, surface }));
    },
    // A decoded file is a body, so the empty carrier refuses every one.
    admitValue: ({ value, headers }) =>
      carrier === "empty"
        ? err(JumpcloudReadErrors.bodyShapeChanged({ drift: [BODY_WHERE_NONE_DECLARED], surface }))
        : boundary
            .parse({ value })
            .map((admitted) => page({ headers, value: admitted }))
            .mapErr((error) => admissionError({ error, length: 0, surface })),
    carrier,
    surface,
  };
}

/**
 * A v2 collection answered as a bare array, its count in `X-Total-Count` when the provider sends one.
 *
 * @param surface the registry surface
 * @param item the schema of one record, every object in it a `z.strictObject`
 * @returns the surface's boundary
 *
 * @internal
 */
export function defineJumpcloudArrayBoundary<I extends z.ZodType>({
  surface,
  item,
}: {
  surface: string;
  item: I;
}): JumpcloudPageBoundary {
  return pageBoundary({
    boundary: defineBoundary({ endpoint: surface, schema: z.array(item) }),
    carrier: "bare-array",
    page: ({ value, headers }) => ({ records: value, shape: "bare-array", totalCount: headerTotal({ headers }) }),
  });
}

/**
 * A collection wrapped in `{ results }`: v1's carries its own `totalCount`, some v2 surfaces' carry none and state
 * it in `X-Total-Count`, if at all.
 *
 * @param surface the registry surface
 * @param item the schema of one record, every object in it a `z.strictObject`
 * @param envelope which wrapper the surface answers: `results-total` for v1's, `results-only` for v2's
 * @returns the surface's boundary
 *
 * @internal
 */
export function defineJumpcloudWrappedBoundary<I extends z.ZodType>({
  surface,
  item,
  envelope,
}: {
  surface: string;
  item: I;
  envelope: "results-total" | "results-only";
}): JumpcloudPageBoundary {
  if (envelope === "results-total") {
    return pageBoundary({
      boundary: defineBoundary({
        endpoint: surface,
        schema: z.strictObject({ results: z.array(item), totalCount: z.number() }),
      }),
      carrier: "wrapped-results",
      page: ({ value }) => ({ records: value.results, shape: "wrapped-results", totalCount: value.totalCount }),
    });
  }
  return pageBoundary({
    boundary: defineBoundary({ endpoint: surface, schema: z.strictObject({ results: z.array(item) }) }),
    carrier: "wrapped-results",
    page: ({ value, headers }) => ({
      records: value.results,
      shape: "wrapped-results",
      totalCount: headerTotal({ headers }),
    }),
  });
}

/**
 * A surface answering one object — a by-id read, a settings document — which contributes exactly one record.
 *
 * @param surface the registry surface
 * @param object the schema of the whole answer — an object schema, so no other carrier compiles here — every object
 * in it a `z.strictObject`
 * @returns the surface's boundary
 *
 * @internal
 */
export function defineJumpcloudObjectBoundary<S extends z.ZodObject>({
  surface,
  object,
}: {
  surface: string;
  object: S;
}): JumpcloudPageBoundary {
  return pageBoundary({
    boundary: defineBoundary({ endpoint: surface, schema: object }),
    carrier: "single-object",
    page: ({ value, headers }) => ({ records: [value], shape: "single-object", totalCount: headerTotal({ headers }) }),
  });
}

/**
 * A surface measured to answer a 2xx with no body at all, which holds no records.
 *
 * @param surface the registry surface
 * @returns the surface's boundary, admitting only the empty body
 *
 * @internal
 */
export function defineJumpcloudEmptyBoundary({ surface }: { surface: string }): JumpcloudPageBoundary {
  return pageBoundary({
    boundary: defineBoundary({ endpoint: surface, schema: z.null() }),
    carrier: "empty",
    page: ({ headers }) => ({ records: [], shape: "empty", totalCount: headerTotal({ headers }) }),
  });
}
