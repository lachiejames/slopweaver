/**
 * The vocabulary the generated Prisma Data Platform registry is written in: how an operation pages, what
 * stability the platform gives it, whether its own documentation publishes a page for it, and which HTTP
 * methods the document uses.
 *
 * Kept beside the generator's output rather than inside it, for the reason `atlas/datadog/surfaceRow.ts`
 * gives: a generated file nobody reads is a poor place to discover that a field changed meaning.
 *
 * ## This platform pages exactly one way, which is worth recording because it is unusual
 *
 * MEASURED on the pinned document: 23 operations declare a `cursor`, and 21 of them declare a `limit`
 * beside it and answer `pagination.nextCursor` plus `pagination.hasMore`. There is no page-number family,
 * no `offset`, and no time-window walk anywhere on the surface. The two that take a `cursor` and no `limit`
 * are exactly the two log streams, and they are the only two responses on the whole document typed
 * `application/x-ndjson` — they cursor over an append-only stream rather than over a collection, which is
 * why {@link PRISMA_PAGING_SHAPES} names `log-cursor` separately. A reader who assumed one shape from
 * another platform would get the collections right and the streams wrong.
 *
 * One operation declares a `limit` and no cursor: `GET /v1/databases/{databaseId}/backups` returns a
 * bounded most-recent slice with no continuation at all, so it is `none` rather than a paging family with a
 * missing half. That is the honest reading, and it is also the reason a backup listing can be exhausted in
 * one call — see `dispositions.ts` on why it is an entity rather than a voluminous family.
 *
 * ## `stability` is Prisma's own extension, and it is the sharpest field on the row
 *
 * The document carries `x-prisma-stability: "experimental"` on 70 of its 115 operations, and on none of the
 * other 45. Recording it per operation is what lets the atlas answer "which of this API is safe to build
 * on" without a reader diffing tag lists — and it is also the field that makes the documentation gap
 * arithmetic rather than a claim, because those 70 are exactly the operations `www.prisma.io/docs` publishes
 * no page for (`generated/specLock.ts`).
 *
 * ## `documented` is measured against the docs site, not inferred from the stability flag
 *
 * The two agree perfectly today and they are still two fields, because they answer different questions and
 * could come apart in either direction: Prisma could stabilise an operation before writing its page, or
 * document an experimental one to invite feedback. Deriving one from the other would make the partition
 * unfalsifiable — and the partition holding EXACTLY is the finding.
 */

/**
 * How one operation walks a result set larger than one response.
 *
 * - `cursor` — an opaque `cursor` plus `limit`, answering `pagination.nextCursor` / `pagination.hasMore`.
 *   The only collection-paging shape on this platform.
 * - `log-cursor` — a cursor over an append-only log stream rather than over a collection, answered as
 *   newline-delimited JSON and optionally followed. Not interchangeable with `cursor`: there is no
 *   `pagination` object, the cursor rides on each record, and the stream has no end until the build or
 *   deployment does.
 * - `none` — one bounded response.
 * @internal
 */
export const PRISMA_PAGING_SHAPES = ["cursor", "log-cursor", "none"] as const;

/** How one operation walks a result set larger than one response. */
export type PrismaPaging = (typeof PRISMA_PAGING_SHAPES)[number];

/**
 * What Prisma says about an operation's own stability, from its `x-prisma-stability` extension.
 *
 * `stable` is this atlas's name for the ABSENCE of the extension, and naming the absence is deliberate: a
 * row whose stability field were nullable would make "Prisma has not said" and "Prisma said stable"
 * indistinguishable at a glance, on the one field a reader planning an integration cares most about.
 * @internal
 */
export const PRISMA_STABILITIES = ["stable", "experimental"] as const;

/** What Prisma says about one operation's stability. */
export type PrismaStability = (typeof PRISMA_STABILITIES)[number];

/**
 * What may present itself to an operation, read from the document's own `security`.
 *
 * Both schemes are declared once at the document root and every operation inherits them, so unlike Figma's
 * four-way split this carries no per-operation information — with exactly one exception, which is why it is
 * on the row at all: `GET /v1/projects/{projectId}/branches/{branchId}/alchemy-state/version` overrides
 * `security` to `[]`, so it accepts NOTHING and is callable by anybody. `unauthenticated` is that row's
 * value, and an unauthenticated probe confirms the document is telling the truth about it.
 * @internal
 */
export const PRISMA_AUTH_METHODS = ["OAuth2", "Bearer", "unauthenticated"] as const;

/** What may present itself to one operation. */
export type PrismaAuthMethod = (typeof PRISMA_AUTH_METHODS)[number];

/**
 * Every HTTP method the pinned document uses.
 * @internal
 */
export const PRISMA_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One HTTP method. */
export type PrismaHttpMethod = (typeof PRISMA_HTTP_METHODS)[number];

/**
 * Which paging shape an operation's own query parameters and response media type describe.
 *
 * Derived from what the operation DECLARES rather than from its path, because the two log streams sit one
 * segment away from ordinary collections and take a `cursor` of a different kind. The media type is what
 * separates them: `application/x-ndjson` is a stream, `application/json` a page.
 *
 * @param mediaTypes every response media type the operation declares
 * @param queryParams every query parameter name the operation declares, its path item's shared ones included
 * @returns the shape a caller must implement to walk it
 */
export function prismaPagingOf({
  mediaTypes,
  queryParams,
}: {
  mediaTypes: readonly string[];
  queryParams: readonly string[];
}): PrismaPaging {
  const names = new Set(queryParams);
  if (mediaTypes.includes("application/x-ndjson")) {
    return "log-cursor";
  }
  if (names.has("cursor")) {
    return "cursor";
  }
  return "none";
}
