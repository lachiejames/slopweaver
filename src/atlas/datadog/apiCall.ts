/**
 * Issuing ONE admitted operation against this organisation, and saying exactly what the answer is bounded
 * by.
 *
 * ## Why this is one request per operation, and why that is stated rather than hidden
 *
 * 232 of the 329 admitted operations do not page at all — 224 whose registry row says `paging: "none"`, and
 * eight whose row says `limit-only`, which `surfaceNaming.ts` already defines as "a CAP rather than a walk
 * … so a reducer never mistakes one page for a census". For those, one request is the whole answer and this
 * pass is COMPLETE.
 *
 * The other 97 walk, under one of eleven different parameter names across Datadog's two API versions. This
 * pass issues their first page and says so — per operation, in {@link DatadogApiObservation.bound}, which
 * `syncApi.ts` turns into a coverage cell that is denied the word `synced` and a gap that names the
 * parameter the follow-on walk will have to send. It does NOT guess a cursor's location in a response body:
 * Datadog puts the next cursor in at least four different places, and a walker that guesses wrong receives
 * page one forever while believing it walked the collection. A first page called a first page is a smaller
 * truth; a guessed walk called complete is a falsehood, and `descriptor.ts`'s header names that exact
 * failure in a sibling atlas.
 *
 * ## The response is stored as an ENVELOPE, never as a concatenation
 *
 * `catalogue.ts` fixes the design: the `api` channel fills the same operation entity's `api` slot "with what
 * this organisation returned". So the detail is {@link DatadogApiObservation}'s `bodies` — each page's body
 * verbatim, after projection — rather than pages spliced together. Concatenating two `{data, meta}` pages
 * produces a document Datadog never sent and no schema describes, and a reader could not tell it from one.
 *
 * ## Every body crosses its operation's own strict boundary
 *
 * Every fixed Datadog route reads through `rawRequest.ts`, whose every call names a strict `defineBoundary`. The
 * 329 heterogeneous operations this pass issues each have a generated one instead (`responseRegistry.ts`, declared
 * from the pinned specification and checked against a census of live answers, `responseCodegen.ts`), and
 * {@link callDatadogApiOperation} admits a 2xx body only through it. A key Datadog adds, drops or retypes refuses
 * as `BODY_SHAPE_CHANGED` naming the field, never a byte of the body; text that is not JSON refuses as an
 * unexpected shape and is never read as empty. An operation the specification declares as answering a file is
 * refused unread, JSON-looking bytes included, since no boundary declares it. Which source a boundary was declared
 * from travels on the observation, so coverage can say an operation admitted against the specification's names
 * alone is still owed its measurement (`apiCoverage.ts`). `projection.ts` stays the storage boundary, after this.
 */
import type { RawFailure, RawMethod, RawTransport } from "../../datadog/rawTransport.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type DatadogAtlasError, DatadogAtlasErrors } from "./errors.js";
import { DATADOG_RESPONSE_FILE_OPERATIONS } from "./generated/responseInventory.js";
import { datadogPagingParametersFor } from "./pagingParameters.js";
import type { DatadogBoundarySource, DatadogResponseBoundary } from "./responseBoundary.js";
import { DATADOG_RESPONSE_BOUNDARIES } from "./responseRegistry.js";
import type { DatadogSurfaceRow } from "./surfaceRow.js";

/**
 * The page size this pass asks for where an operation accepts one.
 *
 * Chosen rather than measured, and small on purpose: this pass sends 329 requests against a metered
 * budget, its unit of value is "does this organisation answer at all and in what shape", and a larger page
 * buys nothing for that question while costing the same budget an investigation later wants.
 * @internal
 */
export const DATADOG_API_PAGE_SIZE = 100;

/**
 * What bounds an operation's answer. Exactly one holds, and every one of them is reported.
 *
 * - `whole` — the operation does not page, so what came back is all there is.
 * - `capped` — the operation takes a size cap and no walk, which is what `limit-only` means. Complete up to
 *   the cap, and the cap is named.
 * - `first-page` — the operation walks, and this pass issued only its first page.
 * @internal
 */
export type DatadogApiBound = "whole" | "capped" | "first-page";

/** One admitted operation's answer from this organisation, with what bounds it. */
export interface DatadogApiObservation {
  /** Each page's body exactly as Datadog sent it, admitted by its boundary. One entry today; a list for a walk. */
  readonly bodies: readonly unknown[];
  /** Where the boundary that admitted it was declared from: `spec-names-only` left every value unread. */
  readonly boundarySource: DatadogBoundarySource;
  readonly bound: DatadogApiBound;
  /** The query parameter a follow-on walk will have to send, or `null` when the operation does not walk. */
  readonly pagingParameter: string | null;
  /** The HTTP status that produced it, so a 200 with an empty body is distinguishable from nothing. */
  readonly status: number;
}

/**
 * What bounds this row's answer, decided from the registry alone.
 *
 * @param row the admitted operation
 * @returns which of the three bounds applies
 * @internal
 */
export function datadogApiBoundFor({ row }: { row: DatadogSurfaceRow }): DatadogApiBound {
  if (row.paging === "none") {
    return "whole";
  }
  if (row.paging === "limit-only") {
    return "capped";
  }
  return "first-page";
}

/**
 * The path to issue, with a size cap appended where the operation declares one.
 *
 * @param row the admitted operation
 * @returns the path, with a query string only when the row named a size parameter
 * @internal
 */
export function datadogApiRequestPath({ row }: { row: DatadogSurfaceRow }): string {
  const { size } = datadogPagingParametersFor({ surface: row.name });
  if (size === null) {
    return row.path;
  }
  return `${row.path}?${encodeURIComponent(size)}=${String(DATADOG_API_PAGE_SIZE)}`;
}

/**
 * The two sentences Datadog uses to say a required query parameter is missing, and the name it puts in each.
 *
 * MEASURED over the first live pass: kinds returned a 400 of this shape and Datadog
 * spelled it two ways — `missing parameter "page_id" in "query"` (the v2 JSON:API errors envelope) and
 * `missing required query param 'user_handle'`. Both are the PROVIDER's own words about its own request
 * shape, which is the only reason reading them is not guessing.
 * @internal
 */
const MISSING_QUERY_PARAMETER_PATTERNS: readonly RegExp[] = [
  /missing parameter \\?"([^"\\]+)\\?" in \\?"query\\?"/,
  /missing required query param '([^']+)'/,
];

/**
 * The query parameter Datadog says an operation requires, read out of its own 400 body.
 *
 * @param detail the failure's own reasons, joined — which carry the response body the transport trimmed in
 * @returns the parameter's name, `null` when Datadog said one was missing without naming it, and
 * `undefined` when the body is not a missing-parameter 400 at all
 * @internal
 */
export function datadogMissingQueryParameter({ detail }: { detail: string }): string | null | undefined {
  for (const pattern of MISSING_QUERY_PARAMETER_PATTERNS) {
    const named = pattern.exec(detail);
    if (named === null) {
      continue;
    }
    // Every pattern above carries exactly one capture group, so an undefined here would mean one lost it —
    // reported as "Datadog named no parameter" rather than as no match at all, which stays true either way.
    const captured = named[1];
    if (captured === undefined) {
      return null;
    }
    return captured;
  }
  if (detail.includes("Missing Parameter")) {
    return null;
  }
  return undefined;
}

/**
 * Turn a transport failure into this atlas's own typed error, on the HTTP status rather than on prose.
 *
 * The `null` status is the one case that is not a status at all — the request never reached Datadog — and
 * it is why {@link RawFailure} carries `number | null` rather than a zero somebody would read as a code.
 *
 * @param failure what the requester reported
 * @param surface the operation's own name, so every message names what was asked
 * @returns the typed error a coverage cell can branch on
 * @internal
 */
export function datadogApiErrorFor({ failure, surface }: { failure: RawFailure; surface: string }): DatadogAtlasError {
  const detail = failure.reasons.join("; ");
  if (failure.status === 401) {
    return DatadogAtlasErrors.unauthorised({ surface });
  }
  if (failure.status === 403) {
    return DatadogAtlasErrors.forbidden({ surface });
  }
  if (failure.status === 429) {
    // Datadog sends no `retry-after`, so `x-ratelimit-reset` is the only wait signal there is — and a 429
    // that arrives without one is a real case the error's own message distinguishes.
    const snapshot = failure.rateLimit;
    const resetSeconds = snapshot === null ? null : snapshot.resetSeconds;
    return DatadogAtlasErrors.rateLimited({ resetSeconds, surface });
  }
  if (failure.status === 501) {
    return DatadogAtlasErrors.notImplemented({ surface });
  }
  if (failure.status === 400) {
    const parameter = datadogMissingQueryParameter({ detail });
    if (parameter !== undefined) {
      return DatadogAtlasErrors.missingParameter({ parameter, surface });
    }
  }
  return DatadogAtlasErrors.transportFailed({ cause: detail, surface });
}

/**
 * Issue one admitted operation and return what this organisation answered.
 *
 * @param transport the bound raw transport, whose read-only type already refuses anything but GET and an
 * allowlisted POST
 * @param row the admitted operation, which decides the path, the method and the bound
 * @param boundaries each operation's response boundary by registry name, the generated registry unless a test
 * hands it a smaller one
 * @returns the observation, or the typed reason this organisation did not answer it or its answer was refused
 */
export async function callDatadogApiOperation({
  transport,
  row,
  boundaries = DATADOG_RESPONSE_BOUNDARIES,
}: {
  transport: RawTransport;
  row: DatadogSurfaceRow;
  boundaries?: ReadonlyMap<string, DatadogResponseBoundary>;
}): Promise<Result<DatadogApiObservation, DatadogAtlasError>> {
  if (row.method !== "GET" && row.method !== "POST") {
    // Unreachable through `apiAcquisition.ts`, which admits only `entity` rows and the generator gives every
    // non-GET/POST row `disposition: "excluded"`. Stated rather than asserted, so a future registry change
    // that broke that invariant would refuse rather than issue a method this type cannot express.
    return err(
      DatadogAtlasErrors.surfaceRefused({
        excludedBecause: `its method is ${row.method}, and this atlas only ever reads`,
        surface: row.name,
      }),
    );
  }
  const method: RawMethod = row.method;
  const path = datadogApiRequestPath({ row });
  const answered = await transport.requestRawTextWithStatus({ method, path });
  if (answered.isErr()) {
    return err(datadogApiErrorFor({ failure: answered.error, surface: row.name }));
  }
  const { bodyText, status } = answered.value;
  const boundary = ownBoundary({ boundaries, path, row, status });
  if (boundary.isErr()) {
    return err(boundary.error);
  }
  const admitted = boundary.value.admit({ path, status, text: bodyText });
  if (admitted.isErr()) {
    return err(admitted.error);
  }
  return ok({
    bodies: [admitted.value],
    bound: datadogApiBoundFor({ row }),
    boundarySource: boundary.value.source,
    pagingParameter: datadogPagingParametersFor({ surface: row.name }).walk,
    status,
  });
}

/**
 * The boundary this operation's answer crosses, or why it is refused unread: a file the specification declares,
 * which no boundary is allowed to admit, an operation the registry lacks, or a boundary keyed to it that declares
 * another operation. The file check runs first, so no registry handed in can read a file as JSON.
 */
function ownBoundary({
  boundaries,
  row,
  path,
  status,
}: {
  boundaries: ReadonlyMap<string, DatadogResponseBoundary>;
  row: DatadogSurfaceRow;
  path: string;
  status: number;
}): Result<DatadogResponseBoundary, DatadogAtlasError> {
  const file = DATADOG_RESPONSE_FILE_OPERATIONS.find(({ surface }) => surface === row.name);
  const answered = `${path} answered HTTP ${String(status)}`;
  if (file !== undefined) {
    return err(
      DatadogAtlasErrors.unexpectedShape({
        detail: `${answered}, and the specification declares a file (${file.essence}), which this pass does not read`,
        surface: row.name,
      }),
    );
  }
  const boundary = boundaries.get(row.name);
  if (boundary === undefined) {
    // Unreachable while `responseRegistry.test.ts` holds every admitted JSON operation to one boundary.
    return err(
      DatadogAtlasErrors.unexpectedShape({
        detail: `${answered}, and no response boundary is declared for it, so nothing it answers is admitted`,
        surface: row.name,
      }),
    );
  }
  if (boundary.surface !== row.name) {
    return err(
      DatadogAtlasErrors.unexpectedShape({
        detail: `${answered}, and the boundary keyed to it declares \`${boundary.surface}\` instead, so nothing it answers is admitted`,
        surface: row.name,
      }),
    );
  }
  return ok(boundary);
}
