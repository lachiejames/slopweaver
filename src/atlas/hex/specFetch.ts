/**
 * Obtaining the pinned Hex OpenAPI document, compiling it, and recording whether the bytes at the pinned
 * address are still the reviewed ones.
 *
 * ## The transport is a SEAM, so the verification is settled by unit tests
 *
 * {@link HexSpecTransport} is the whole contract. `verifyAndCompile` is pure and takes the bytes, so a
 * fixture proves what happens on a moved document, on an unparsable body and on one that arrives exactly as
 * pinned — none of which is provable against the live service. `httpSpecTransport` is the one function here
 * that touches the network, and it does nothing but fetch text.
 *
 * ## The digest is an observation, not a gate
 *
 * `errors.ts` carries the reasoning: Hex publishes this document at an UNVERSIONED CDN path, so a release
 * moves the bytes under the same address, and refusing the sync on a digest mismatch would make the atlas
 * unbuildable the day Hex ships. What the lock still guarantees is the read-only property that actually
 * matters — `pin.url` is the only address ever fetched, and no caller supplies one.
 *
 * ## Reaching the document is not reaching the workspace
 *
 * `static.hex.site/openapi.json` is the same file Hex's own public API reference renders from. It takes no
 * credential, returns nothing about this workspace, and is what any anonymous reader is served. So this
 * surface describes the PRODUCT rather than the workspace, which is exactly what `model.ts`'s
 * `api-anonymous-published` visibility scope says and why a coverage cell filled from it must never be read
 * as a claim about what this workspace holds.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { digestDrift, fetchPinnedText } from "../kit/pinnedSpec.js";

import { type HexSpecDrift, type HexSpecError, HexSpecErrors } from "./errors.js";
import type { HexSpecPin } from "./specPin.js";
import { type HexSpecSurface, readHexSpecSurface } from "./specSurface.js";

/**
 * How one pinned document's bytes are obtained.
 *
 * A plain function passed in, never a mock: a test supplies a deterministic fake and the real
 * implementation is {@link httpSpecTransport}.
 */
export type HexSpecTransport = (input: { pin: HexSpecPin }) => Promise<Result<string, HexSpecError>>;

/**
 * One compiled document, and whether what was served is what was pinned.
 *
 * @internal
 */
export interface CompiledSpec {
  /** What has moved under the pinned tag, or `null` when the bytes match the pin. */
  readonly drift: HexSpecDrift | null;
  readonly surface: HexSpecSurface;
}

/**
 * Compile one fetched document and record whether it still matches its pin.
 *
 * Pure — no network, no clock, no disk.
 *
 * @param pin the pinned document this text is supposed to be
 * @param text the bytes that arrived, as UTF-8
 * @returns the compiled surface plus any drift, or why this document could not be compiled at all
 */
export function verifyAndCompile({ pin, text }: { pin: HexSpecPin; text: string }): Result<CompiledSpec, HexSpecError> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    return err(
      HexSpecErrors.unparsable({
        detail: cause instanceof Error ? cause.message : String(cause),
        specId: pin.id,
      }),
    );
  }
  const surface = readHexSpecSurface({ document, specId: pin.id });
  if (surface.isErr()) {
    return err(HexSpecErrors.unparsable({ detail: surface.error.join("; "), specId: pin.id }));
  }
  return ok({ drift: digestDrift({ pin, text }), surface: surface.value });
}

/**
 * Fetch one pinned document over HTTP. The only function in this atlas that reaches the network.
 *
 * @param pin the pinned document to fetch, whose `url` is used verbatim from the reviewed lock and is never
 *   assembled from a caller's input
 * @returns the response body as UTF-8, or why it could not be fetched
 */
export async function httpSpecTransport({ pin }: { pin: HexSpecPin }): Promise<Result<string, HexSpecError>> {
  const fetched = await fetchPinnedText({ pin });
  if (fetched.isErr()) {
    return err(HexSpecErrors.unreachable({ cause: new Error(fetched.error.join("; ")), specId: pin.id }));
  }
  return ok(fetched.value);
}
