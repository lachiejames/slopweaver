/**
 * Read `talk relay --offered-file`: the copy-tray offer the route staged beside the picture, as one JSON object
 * (`site/app/api/talk/relay/route.ts`). The effectful edge of `../../../talk/relayOffer.ts`, which owns what the
 * offer may be; this owns that the bytes are bounded, whole UTF-8 and one JSON value. Read before the turn is
 * claimed, so a malformed offer refuses the relay with nothing written.
 */
import { readFileSync, statSync } from "node:fs";

import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { type TalkError, TalkErrors } from "../../../talk/errors.js";
import { type RelayOffer, relayOfferOf } from "../../../talk/relayOffer.js";

/**
 * The most bytes a staged offer file may hold: 8,192 code points of message and 80 of label at the worst case of
 * six JSON bytes each (a `\uXXXX` escape), and room for the field names — the route's own bound on the body.
 */
const RELAY_OFFER_FILE_MAX_BYTES = 6 * (8 * 1024 + 80) + 1024;

/**
 * Read and check one staged copy-tray offer.
 *
 * @param path the file the route wrote, `offer.json` in its per-request temp directory
 * @returns the offer exactly as staged, or an `OFFERED_INVALID` refusal naming why it cannot be carried
 */
export function readRelayOfferFile({ path }: { path: string }): Result<RelayOffer, TalkError> {
  let bytes: Buffer;
  try {
    if (!statSync(path).isFile()) {
      return err(TalkErrors.offeredInvalid({ why: `at ${path} is not a regular file` }));
    }
    bytes = readFileSync(path);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(TalkErrors.offeredInvalid({ why: `at ${path} could not be read: ${why}` }));
  }
  if (bytes.length > RELAY_OFFER_FILE_MAX_BYTES) {
    return err(
      TalkErrors.offeredInvalid({
        why: `at ${path} is ${String(bytes.length)} bytes; one offer is at most ${String(RELAY_OFFER_FILE_MAX_BYTES)}`,
      }),
    );
  }
  let value: unknown;
  try {
    // Fatal, so a byte that is not UTF-8 refuses the offer rather than becoming U+FFFD in a message they never saw.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = safeJsonParse({ label: "talk relay --offered-file", text });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(TalkErrors.offeredInvalid({ why: `at ${path} is not one UTF-8 JSON value: ${why}` }));
  }
  return relayOfferOf({ value });
}

/**
 * The copy-tray offer `--offered-file` stages, read and checked before the draft binds it.
 *
 * @param offeredFile the flag's value, or `undefined` when the relay was given no offer
 * @returns the offer, `undefined` when there is no flag, or the `OFFERED_INVALID` refusal reading it produced
 */
export function readOfferedFlag({
  offeredFile,
}: {
  offeredFile: string | undefined;
}): Result<RelayOffer | undefined, TalkError> {
  if (offeredFile === undefined) {
    return ok(undefined);
  }
  return readRelayOfferFile({ path: offeredFile });
}
