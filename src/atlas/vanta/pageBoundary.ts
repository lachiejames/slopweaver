/**
 * One Vanta Manage API collection endpoint's declared read: a strict boundary over the envelope it answers in,
 * and the step that turns a validated answer into the page `pagination.ts` walks.
 *
 * Every collection this atlas reads goes through one of these, so a field Vanta adds, drops or renames on any
 * of them is refused by name at the read (`#lib/boundary.ts`) rather than passed through or guessed at.
 *
 * Four of the surfaces carry no cursor at all in Vanta's own document:
 * `/customer-trust/tag-categories` answers `{ results: [...] }`,
 * `/customer-trust/questionnaires/assignable-users` answers `{ results: { data: [...] } }`, and
 * `/groups/{groupId}/people` and `/integrations/{integrationId}/resource-kinds` answer a BARE ARRAY with no
 * envelope at all. MEASURED, reading those two through the paged envelope produced a schema
 * refusal on every parent, and the store's own never-acquired guard is what caught it before anything was
 * published. Each unpaged shape gets its own boundary over exactly the shape the document declares, and the
 * page it yields carries a TERMINATOR `pageInfo`.
 *
 * That `pageInfo` is never provider data: it is not stored on any entity, it is read once by
 * `readVantaPagesSequentially` to stop after the first page, and `hasNextPage: false` is exactly true — the
 * document declares no way to ask for a second one. It is attached AFTER validation, in plain code, because a
 * boundary validates what the provider sent and a schema transform is the one thing a boundary refuses.
 */

import { z } from "zod";
import { type BoundaryError, defineBoundary } from "#lib/boundary.js";
import type { Result } from "#lib/result.js";
import type { VantaPageInfo } from "./apiSchemas.js";
import type { VantaPage } from "./pagination.js";

/** The paged envelope every cursor-walked collection answers in. */
export interface VantaPagedAnswer<TItem> {
  results: { data: TItem[]; pageInfo: VantaPageInfo; totalCount?: number | undefined };
}

/** Which unpaged shape a surface answers in — a bare array, or one of two `results` wrappers. */
export type VantaUnpagedShape = "bare-array" | "results-array" | "results-data";

/** One collection endpoint's read: the endpoint it names, and the page a body's text validates into. */
export interface VantaPageBoundary<TItem> {
  /** The endpoint as a reader names it — the method and the document's own path template. */
  readonly endpoint: string;
  readonly readPage: (input: { text: string }) => Result<VantaPage<TItem>, BoundaryError>;
}

const TERMINATOR: VantaPageInfo = { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null };

/**
 * Declare a cursor-walked collection's read from its paged envelope schema.
 *
 * @param endpoint the method and the document's path template, e.g. `GET /v1/controls/{controlId}/tests`
 * @param pageSchema the endpoint's paged envelope — `vantaPageEnvelopeSchema` over the endpoint's DTO
 * @returns the boundary; throws at definition when any object in the schema is not strict
 */
export function vantaPagedBoundary<TItem>({
  endpoint,
  pageSchema,
}: {
  endpoint: string;
  pageSchema: z.ZodType<VantaPagedAnswer<TItem>>;
}): VantaPageBoundary<TItem> {
  const boundary = defineBoundary({ endpoint, schema: pageSchema });
  return {
    endpoint,
    readPage: ({ text }) =>
      boundary.parseJson({ text }).map((answer) => ({ items: answer.results.data, pageInfo: answer.results.pageInfo })),
  };
}

/**
 * Declare an UNPAGED collection's read over exactly the shape the document declares for it.
 *
 * @param endpoint the method and the document's path template
 * @param dataSchema the per-row DTO schema
 * @param shape which unpaged shape this endpoint answers in
 * @returns the boundary, whose one page always carries the terminator `pageInfo`
 */
export function vantaUnpagedBoundary<S extends z.ZodType>({
  endpoint,
  dataSchema,
  shape,
}: {
  endpoint: string;
  dataSchema: S;
  shape: VantaUnpagedShape;
}): VantaPageBoundary<z.output<S>> {
  if (shape === "bare-array") {
    const boundary = defineBoundary({ endpoint, schema: z.array(dataSchema) });
    return {
      endpoint,
      readPage: ({ text }) => boundary.parseJson({ text }).map((rows) => ({ items: rows, pageInfo: TERMINATOR })),
    };
  }
  if (shape === "results-array") {
    const boundary = defineBoundary({ endpoint, schema: z.strictObject({ results: z.array(dataSchema) }) });
    return {
      endpoint,
      readPage: ({ text }) =>
        boundary.parseJson({ text }).map((answer) => ({ items: answer.results, pageInfo: TERMINATOR })),
    };
  }
  const boundary = defineBoundary({
    endpoint,
    schema: z.strictObject({ results: z.strictObject({ data: z.array(dataSchema) }) }),
  });
  return {
    endpoint,
    readPage: ({ text }) =>
      boundary.parseJson({ text }).map((answer) => ({ items: answer.results.data, pageInfo: TERMINATOR })),
  };
}
