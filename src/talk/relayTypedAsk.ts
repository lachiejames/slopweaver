/**
 * A typed steer's row ask. The owner's typed words are never cut — the composer they typed them in can simply be shortened —
 * so every bound a typed steer can cross is a refusal here rather than a quote cut to fit (`relayRowQuote.ts`).
 */
import { MAX_SUMMARY_BYTES, summaryWrittenFit } from "../handover/summaryCap.js";
import { err, ok, type Result } from "../lib/result.js";

import { normaliseTyped, typedAskText } from "./relayAskText.js";
import { RelayDraftErrors, type TypedInvalidError } from "./relayDraftErrors.js";
import type { RelayPicture } from "./relayPicture.js";
import { type TriageRuling, withTriageRuling } from "./triageVocabulary.js";

/** The longest typed steer a relay carries: the same bound the console puts on every text slot it sends. */
export const RELAY_TYPED_LIMIT = 2000;

/**
 * A typed steer's row ask, composed whole: words that say nothing, run past the character limit, or make a summary
 * over the byte cap `handover start` holds a row to are refused instead.
 *
 * @param heard the owner's typed words exactly as the composer sent them; only the ask reads a normalised copy
 * @returns the ask, or a `TYPED_INVALID` refusal naming which bound it crossed
 */
export function typedAsk({
  heard,
  about,
  picture,
  triageRuling,
}: {
  heard: string;
  about: string;
  picture: RelayPicture;
  triageRuling: TriageRuling | undefined;
}): Result<string, TypedInvalidError> {
  const typedWords = normaliseTyped({ text: heard });
  if (typedWords === "") {
    return err(
      RelayDraftErrors.typedInvalid({
        why: "--typed needs the owner's words in --heard: a typed steer with none says nothing",
      }),
    );
  }
  if (heard.length > RELAY_TYPED_LIMIT) {
    return err(
      RelayDraftErrors.typedInvalid({
        why: `the owner's typed steer is ${String(heard.length)} characters; a relay carries up to ${String(RELAY_TYPED_LIMIT)}`,
      }),
    );
  }
  const ask = withTriageRuling({ ask: typedAskText({ about, picture, typed: typedWords }), triageRuling });
  const fit = summaryWrittenFit({ summary: ask });
  if (!fit.fits) {
    return err(
      RelayDraftErrors.typedInvalid({
        why:
          `the owner's typed steer makes a ${String(fit.bytes)}-byte board summary, over the ${String(MAX_SUMMARY_BYTES)}-byte ` +
          "cap handover start holds a row to; a typed steer is never cut, so shorten it",
      }),
    );
  }
  return ok(ask);
}
