/**
 * The ASSET lane of the Linear write API: reserve an upload slot with `mutation.fileUpload`, then PUT the
 * bytes into the storage bucket Linear hands back.
 *
 * ## Two calls, and only the second one proves anything
 *
 * `fileUpload` does not upload. It reserves — it answers with a presigned `uploadUrl`, the exact headers
 * that URL demands, and the `assetUrl` the file WILL have once the bytes land. Embedding that `assetUrl`
 * before the PUT succeeds publishes a broken image, so the two steps are one operation here and the seam
 * hands back the asset only when both have happened.
 *
 * ## Why the PUT is not a `safeProviderCall`
 *
 * The presigned URL points at Linear's cloud-storage bucket, not at Linear's API — a different host, no API
 * key, and outside the GraphQL rate block the scheduler paces. Wrapping it in the Linear provider call
 * would put bucket latency inside Linear's own rate budget and label a storage 403 as a Linear API fault.
 * It goes through `safeFs`-shaped handling of its own instead: one attempt, never retried, because a
 * presigned URL is single-use and a retry would need a fresh reservation anyway.
 *
 * Split from `./write.ts` and `./writeGraphql.ts` rather than added to either, for the `file-size-ratchet`
 * cap and because this is the one lane here whose second leg is not GraphQL at all.
 */
import { LinearDocument } from "@linear/sdk";

import { type IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { type RateScheduler } from "../../lib/resilience.js";
import { err, ok, type Result, type ResultAsync } from "../../lib/result.js";
import type { LinearWritePrivacy } from "../../outbound/linear/writePrivacy.js";
import { type LinearPayloadError, LinearPayloadErrors } from "./errors.js";
import { ORGANIZATION_QUERY } from "./organization.js";
import { type LinearRequest } from "./transport.js";
import { makeLinearSendContext } from "./write.js";
import { parsedMutateVia, readAllVia, type SendContext, str } from "./writeGraphql.js";

/** The upload slot Linear reserved: where to PUT, what headers that PUT demands, and the resulting asset. */
export interface ReservedUpload {
  readonly uploadUrl: string;
  readonly assetUrl: string;
  readonly contentType: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/** An asset whose bytes are IN Linear's storage — the only shape a caller may embed. */
export interface StoredAsset {
  readonly assetUrl: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly fileName: string;
}

/**
 * The reservation, as `@linear/sdk` generates it.
 *
 * A straight swap rather than a narrowing: the `UploadFile` fragment selects `assetUrl`, `uploadUrl`,
 * `contentType`, `filename`, `size` and `headers { key value }` — every field {@link reservationFrom} reads,
 * plus `metaData`. The document also declares `$makePublic` and `$metaData`, which this lane leaves unset;
 * an attachment on an issue is reached through Linear's own auth, and making one world-readable is not a
 * decision an upload seam should be able to take by accident.
 */
export const FILE_UPLOAD_MUTATION = String(LinearDocument.FileUploadDocument);

/**
 * The workspace's own answer to "which content types may be uploaded at all", read rather than assumed.
 *
 * Shared with the structure lane, and hand-written for the one reason `./organization.ts` records: the SDK's
 * `Organization` fragment selects `authSettings`.
 */
export const ALLOWED_UPLOAD_TYPES_QUERY = ORGANIZATION_QUERY;

/**
 * The reserved slot inside a `fileUpload` payload, or a named reason it is not there.
 *
 * Same false-success posture as every other parser in this lane: `UploadPayload.uploadFile` is nullable, so
 * a 200 with `success: true` and no `uploadFile` is a shape this has to name rather than crash on.
 *
 * @param data the mutation response body
 * @param field the payload field, always `fileUpload` — taken as an argument to satisfy `mutateVia`'s parser shape
 * @returns the reservation, or the reason the payload could not yield one
 */
export function reservationFrom({
  data,
  field,
}: {
  data: unknown;
  field: string;
}): Result<ReservedUpload, LinearPayloadError> {
  const payload = isRecord(data) ? data[field] : undefined;
  if (!isRecord(payload)) {
    return err(LinearPayloadErrors.uploadNoPayload({ field }));
  }
  const node = payload["uploadFile"];
  if (!isRecord(node)) {
    return err(LinearPayloadErrors.uploadNotReserved({ field }));
  }
  const uploadUrl = str({ key: "uploadUrl", node });
  const assetUrl = str({ key: "assetUrl", node });
  const contentType = str({ key: "contentType", node });
  if (uploadUrl === undefined || assetUrl === undefined || contentType === undefined) {
    return err(LinearPayloadErrors.uploadSlotIncomplete({ field }));
  }
  return ok({ assetUrl, contentType, headers: headersFrom({ node }), uploadUrl });
}

/**
 * The presigned PUT's required headers, in the order Linear listed them.
 *
 * A header whose key or value is missing is DROPPED rather than defaulted: sending `undefined` as a value
 * would make the bucket reject the whole PUT with a signature mismatch, which reads as an auth problem.
 *
 * @param node the `uploadFile` node
 * @returns the headers to send, possibly empty
 */
function headersFrom({ node }: { node: Record<string, unknown> }): readonly { key: string; value: string }[] {
  const raw = node["headers"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const headers: { key: string; value: string }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const key = str({ key: "key", node: entry });
    const value = str({ key: "value", node: entry });
    if (key !== undefined && value !== undefined) {
      headers.push({ key, value });
    }
  }
  return headers;
}

/**
 * The content types the live workspace RESTRICTS uploads to, or `undefined` when it restricts none.
 *
 * The two are kept apart deliberately, and MEASURED rather than assumed: this workspace answers
 * `allowedFileUploadContentTypes: null`, which means "no restriction configured" and not "nothing is
 * allowed". Collapsing null into an empty array — the shape this function first had — makes an unrestricted
 * workspace read as one that forbids every type, which is the exact inversion a caller would act on.
 * Reproduce with `slopweaver atlas linear read --id type:Organization --json`, whose field list carries it.
 *
 * @param data the raw GraphQL data
 * @returns the permitted types, or `undefined` when the workspace declares no restriction at all
 */
export function allowedUploadTypesFrom({ data }: { data: unknown }): readonly string[] | undefined {
  const org = isRecord(data) ? data["organization"] : undefined;
  const types = isRecord(org) ? org["allowedFileUploadContentTypes"] : undefined;
  return Array.isArray(types) ? types.filter((t): t is string => typeof t === "string") : undefined;
}

/** The asset methods, mixed into the write API by `./write.ts`. */
export interface LinearAssetWriteApi {
  /**
   * Reserve one upload slot. Never retried: a reservation costs a real slot in Linear's storage, and the
   * presigned URL it hands back is single-use, so a retry would have to reserve again anyway.
   */
  reserveUpload(args: {
    contentType: string;
    fileName: string;
    byteLength: number;
  }): ResultAsync<ReservedUpload, IngestError>;
  /**
   * Read the content types the workspace RESTRICTS uploads to — `undefined` when it restricts none.
   *
   * A plain read, so it retries transiently. Its consumer is
   * `src/__tests__/integration/linearAttach.test.ts`, which is the point rather than a gap: the door's own
   * table in `../../outbound/linear/attachment.ts` is narrower than the provider's on purpose, and this is
   * the call that fails a test rather than a real send when the two diverge.
   */
  readAllowedUploadTypes(): ResultAsync<readonly string[] | undefined, IngestError>;
}

/**
 * The asset slice, bound to a send context.
 *
 * @param ctx the shared send context
 * @returns the asset methods
 */
function assetApi({ ctx }: { ctx: SendContext }): LinearAssetWriteApi {
  return {
    readAllowedUploadTypes: () =>
      readAllVia({
        ctx,
        operation: "linear.organization.allowedFileUploadContentTypes",
        query: ALLOWED_UPLOAD_TYPES_QUERY,
        shape: allowedUploadTypesFrom,
      }),
    reserveUpload: ({ contentType, fileName, byteLength }) =>
      parsedMutateVia({
        ctx,
        field: "fileUpload",
        operation: "linear.fileUpload",
        parse: reservationFrom,
        query: FILE_UPLOAD_MUTATION,
        variables: { contentType, filename: fileName, size: byteLength },
      }),
  };
}

/**
 * The Linear ASSET write API, bound to a token.
 *
 * Its own factory rather than a slice of `makeLinearWriteApi`, for the reason `./write.ts` records at
 * `LinearWriteApi`: this lane's operation ends at a storage bucket, not at Linear's GraphQL endpoint.
 *
 * The client, pacer and quota scope come from `./write.ts`'s `makeLinearSendContext` rather than being built
 * here: Linear's quota is per-USER, so a second client would be a second pacer over one budget.
 *
 * @param token the token the reservations are made as
 * @param request the GraphQL transport seam; omit for the production `rawRequest`
 * @param scheduler the shared rate scheduler; omit for the production one
 * @param privacy the outbound privacy policy every mutation is judged under, from the verb's own home
 * @returns the asset write API
 */
export function makeLinearAssetWriteApi({
  token,
  request,
  scheduler,
  privacy,
}: {
  token: string;
  request?: LinearRequest;
  scheduler?: RateScheduler;
  privacy: LinearWritePrivacy;
}): LinearAssetWriteApi {
  return assetApi({ ctx: makeLinearSendContext({ privacy, request, scheduler, token }) });
}
