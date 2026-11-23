/**
 * Obtaining one pinned Twilio definition, compiling it, and recording whether the bytes at the pinned tag
 * are still the reviewed ones.
 *
 * ## The transport is a SEAM, so the verification is settled by unit tests
 *
 * {@link TwilioSpecTransport} is the whole contract. `verifyAndCompile` is pure and takes the bytes, so a
 * fixture proves what happens on a moved document, on an unparsable body and on one that arrives exactly
 * as pinned — none of which is provable against the live service. `httpSpecTransport` is the one function
 * here that touches the network, and it does nothing but fetch text.
 *
 * ## The digest is an observation, not a gate
 *
 * `errors.ts` carries the reasoning: refusing the whole sync on a digest mismatch makes the atlas
 * unbuildable the day the vendor ships. What the lock still guarantees is the read-only property that
 * actually matters — `pin.url` is the only address ever fetched, and no caller supplies one.
 *
 * ## Reaching the definitions is not reaching the account
 *
 * `raw.githubusercontent.com/twilio/twilio-oai/...` is Twilio's own PUBLIC repository of the definitions
 * its SDKs are generated from. It takes no credential, returns nothing about this account, and is the same
 * document any reader of the SDK source is served. So this surface describes the PRODUCT rather than the
 * account, which is exactly what `model.ts`'s `api-published-definitions` visibility scope says and why a
 * coverage cell filled from it must never be read as a claim about what this account holds.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { digestDrift, fetchPinnedText } from "../kit/pinnedSpec.js";

import { type TwilioSpecDrift, type TwilioSpecError, TwilioSpecErrors } from "./errors.js";
import type { TwilioSpecPin } from "./specPin.js";
import { readTwilioSpecSurface, type TwilioSpecSurface } from "./specSurface.js";

/**
 * How one pinned document's bytes are obtained.
 *
 * A plain function passed in, never a mock: a test supplies a deterministic fake and the real
 * implementation is {@link httpSpecTransport}.
 */
export type TwilioSpecTransport = (input: { pin: TwilioSpecPin }) => Promise<Result<string, TwilioSpecError>>;

/**
 * One compiled document, and whether what was served is what was pinned.
 *
 * @internal
 */
export interface CompiledSpec {
  /** What has moved under the pinned tag, or `null` when the bytes match the pin. */
  readonly drift: TwilioSpecDrift | null;
  readonly surface: TwilioSpecSurface;
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
export function verifyAndCompile({
  pin,
  text,
}: {
  pin: TwilioSpecPin;
  text: string;
}): Result<CompiledSpec, TwilioSpecError> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    return err(
      TwilioSpecErrors.unparsable({
        detail: cause instanceof Error ? cause.message : String(cause),
        specId: pin.id,
      }),
    );
  }
  const surface = readTwilioSpecSurface({ document, specId: pin.id });
  if (surface.isErr()) {
    return err(TwilioSpecErrors.unparsable({ detail: surface.error.join("; "), specId: pin.id }));
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
export async function httpSpecTransport({ pin }: { pin: TwilioSpecPin }): Promise<Result<string, TwilioSpecError>> {
  const fetched = await fetchPinnedText({ pin });
  if (fetched.isErr()) {
    return err(TwilioSpecErrors.unreachable({ cause: new Error(fetched.error.join("; ")), specId: pin.id }));
  }
  return ok(fetched.value);
}
