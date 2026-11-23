/**
 * The bytes half of `linear attach upload`: PUT a classified file into the storage bucket a `fileUpload`
 * reservation named, and hand back the asset only once the bucket accepted it.
 *
 * The transport is INJECTED rather than reached for, exactly as `../github/attachClient.ts` injects its
 * own: a fake here is a plain function, which is what lets the pure sequence be tested without a mock and
 * lets the integration cassette record a real bucket round trip through Polly.
 *
 * ## The one rule this module exists to enforce
 *
 * A reservation's `assetUrl` is a PROMISE, not a fact. It is a live, addressable URL the moment Linear
 * mints it and it 404s until the bytes land. So nothing here returns a {@link StoredAsset} on any path
 * where the PUT did not answer 2xx — the whole point of the module is that a caller cannot hold an asset
 * URL it has not proven.
 */
import type { ReservedUpload, StoredAsset } from "../../corpus/linear/writeAssets.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type LinearAttachError, LinearAttachErrors } from "./attach.errors.js";
import type { ClassifiedLinearAttachment } from "./attachment.js";
import { type LinearWritePrivacy, linearUploadPrivacyRefusal } from "./writePrivacy.js";

/**
 * The minimal response shape this client reads — narrower than `Response`, so a fake stays small.
 *
 * @internal the shape {@link AssetPutFetch} resolves to; a caller supplies one, never names the type.
 */
export interface AssetPutResponse {
  readonly status: number;
}

/**
 * The injected transport: everything this module does to the network goes through it.
 *
 * It carries no `method`, and that absence is deliberate: this seam only ever PUTs, so a field nothing
 * varies is an option a reader has to check. The proof that it really is a PUT is the `PUT` request line in
 * `src/__tests__/integration/linearAttach.test.ts`'s cassette, recorded against the real bucket.
 */
export type AssetPutFetch = (args: {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}) => Promise<AssetPutResponse>;

/** Whether a storage bucket's answer means the bytes are stored. */
function accepted({ status }: { status: number }): boolean {
  return status >= 200 && status < 300;
}

/**
 * The headers the presigned PUT demands, as one object.
 *
 * Linear's own list wins over anything computed here — the signature covers those headers exactly, so
 * adding or altering one turns a valid PUT into a signature mismatch. `Content-Type` is added only when
 * Linear did not already name it, because a bucket that signed a content type and then receives a
 * different one refuses.
 *
 * @param reservation the slot Linear reserved, carrying its required headers
 * @returns the header bag to send with the PUT
 */
export function putHeadersFor({ reservation }: { reservation: ReservedUpload }): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const header of reservation.headers) {
    headers[header.key] = header.value;
  }
  const named = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (!named) {
    headers["Content-Type"] = reservation.contentType;
  }
  return headers;
}

/**
 * PUT the bytes into the reserved slot.
 *
 * One attempt, never retried: a presigned URL is single-use, so a second PUT to the same address is not a
 * retry of the same operation — it is a request that will be refused for a reason unrelated to why the
 * first one failed. A caller that wants another go reserves again.
 *
 * @param fetchImpl the injected transport
 * @param reservation the slot Linear reserved
 * @param classified the file, already checked against the door's content-type table
 * @param bytes the file's contents
 * @param privacy the outbound privacy policy, read afresh here immediately before the PUT: a terms file deleted or
 *   broken while the slot was being reserved refuses the bytes, leaving the reserved slot unused
 * @returns the stored asset, or why the bytes did not land
 */
export async function putReservedAsset({
  fetchImpl,
  reservation,
  classified,
  bytes,
  privacy,
}: {
  fetchImpl: AssetPutFetch;
  reservation: ReservedUpload;
  classified: ClassifiedLinearAttachment;
  bytes: Uint8Array;
  privacy: LinearWritePrivacy;
}): Promise<Result<StoredAsset, LinearAttachError>> {
  const refusal = await linearUploadPrivacyRefusal({ bytes, fileName: classified.fileName, privacy });
  if (refusal !== undefined) {
    return err(LinearAttachErrors.privacyRefused({ refusal }));
  }
  let response: AssetPutResponse;
  try {
    response = await fetchImpl({
      body: bytes,
      headers: putHeadersFor({ reservation }),
      url: reservation.uploadUrl,
    });
  } catch {
    return err(
      LinearAttachErrors.assetPutFailed({
        assetUrl: reservation.assetUrl,
        // A thrown transport failure carries no HTTP status at all, and 0 is the one value no bucket can
        // answer — so the report says "the PUT never completed" rather than inventing a plausible code.
        status: 0,
      }),
    );
  }
  if (!accepted({ status: response.status })) {
    return err(LinearAttachErrors.assetPutFailed({ assetUrl: reservation.assetUrl, status: response.status }));
  }
  return ok({
    assetUrl: reservation.assetUrl,
    byteLength: classified.byteLength,
    contentType: reservation.contentType,
    fileName: classified.fileName,
  });
}

/**
 * The production transport — a thin adapter over global `fetch` that carries nothing the caller did not name.
 *
 * @returns a transport backed by the runtime's own `fetch`
 */
export function productionAssetPutFetch(): AssetPutFetch {
  return async ({ url, headers, body }) => {
    // `Blob` rather than the raw `Uint8Array`: the DOM `BodyInit` union does not admit a
    // `Uint8Array<ArrayBufferLike>`, and wrapping is honest where a type assertion would only silence it.
    const response = await fetch(url, {
      body: new Blob([new Uint8Array(body)]),
      headers,
      method: "PUT",
      redirect: "follow",
    });
    return { status: response.status };
  };
}
