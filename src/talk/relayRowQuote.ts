/**
 * How much of the owner's transcribed words a relay's board row quotes — pure, and split from `./relayDraft.ts`, which
 * decides whether a relay may stand at all: this module only decides how long a quote the row's summary can hold.
 */
import { MAX_SUMMARY_BYTES, summaryWrittenFit } from "../handover/summaryCap.js";
import { err, ok, type Result } from "../lib/result.js";

import type { RowQuoteCut } from "./relayAskText.js";
import { type AskOverCapError, RelayDraftErrors } from "./relayDraftErrors.js";

/**
 * How much of the owner's transcribed speech the board row QUOTES at most. The turn record keeps every word; the row's
 * quote is the TAIL — the steer is what the owner said last — marked as cut, and it names the turn file holding the
 * rest. The row is one line whose ask is also its title, so a long stretch is quoted rather than pasted whole. The
 * record keeps every word, so a long relay never loses the head of the owner's words. A
 * multibyte tail is cut shorter still, to keep the row's summary within its byte cap ({@link fittedRowQuote}).
 */
export const RELAY_ROW_QUOTE_LIMIT = 1500;

/** What the row quotes of the owner's words, and when it is only the newest of them, how many there were and where. */
export interface RowQuote {
  readonly text: string;
  readonly cut: RowQuoteCut | undefined;
}

/**
 * What the row quotes of the owner's words, and the ask it makes: all of them when they fit, else the longest tail of whole
 * code points that keeps within {@link RELAY_ROW_QUOTE_LIMIT} characters AND keeps the ask's written `summary:`
 * within the byte cap `handover start` holds a row to (`../handover/summaryCap.ts`).
 *
 * The character limit alone was not a byte limit: 1500 characters of a three-byte script beside a 2000-character
 * reading of one is 10,500 bytes before a word of the row's own, so the row registered and no seat could start it.
 * Every part of the ask but the quote is the caller's, so the cut is
 * measured on the whole composed ask rather than budgeted from a guess at the rest; its bytes grow with the tail,
 * so the longest fitting tail is a binary search. A tail never starts inside a surrogate pair.
 *
 * @param heard every word, normalised
 * @param turnId the turn whose record keeps every word
 * @param askOf composes the whole ask around one quote
 * @returns the quote and its ask, or `ASK_OVER_CAP` when even the newest one character of the owner's — or, with none
 *   attached, the ask alone — is over the cap
 */
export function fittedRowQuote({
  heard,
  turnId,
  askOf,
}: {
  heard: string;
  turnId: string;
  askOf: (args: { quote: RowQuote }) => string;
}): Result<{ ask: string; quote: RowQuote }, AskOverCapError> {
  const wholeQuote: RowQuote = { cut: undefined, text: heard };
  const wholeAsk = askOf({ quote: wholeQuote });
  const wholeFit = summaryWrittenFit({ summary: wholeAsk });
  if (heard.length <= RELAY_ROW_QUOTE_LIMIT && wholeFit.fits) {
    return ok({ ask: wholeAsk, quote: wholeQuote });
  }
  if (heard === "") {
    return err(RelayDraftErrors.askOverCap({ bytes: wholeFit.bytes, cap: MAX_SUMMARY_BYTES }));
  }
  // Only the newest RELAY_ROW_QUOTE_LIMIT characters can be quoted, so only they are split into code points — the
  // route carries up to a million. A window opening on the low half of a pair it cut through drops that half.
  const windowed = heard.length > RELAY_ROW_QUOTE_LIMIT;
  const window = heard.slice(-RELAY_ROW_QUOTE_LIMIT);
  const splitPair =
    windowed &&
    isLowSurrogate({ code: window.charCodeAt(0) }) &&
    isHighSurrogate({ code: heard.charCodeAt(heard.length - RELAY_ROW_QUOTE_LIMIT - 1) });
  const points = Array.from(splitPair ? window.slice(1) : window);
  const cut: RowQuoteCut = { total: heard.length, turnFile: `$SLOPWEAVER_HOME/talk/turns/${turnId}.json` };
  const tailOf = ({ count }: { count: number }): RowQuote => ({ cut, text: points.slice(-count).join("") });
  const fitsAt = ({ count }: { count: number }): boolean =>
    summaryWrittenFit({ summary: askOf({ quote: tailOf({ count }) }) }).fits;
  // The largest count that fits, or 0 when not even one does. Unwindowed, a cut quote of every code point is the whole
  // quote with a longer clause beside it, which the check above already found over, so the search stops one short.
  let low = 0;
  let high = windowed ? points.length : points.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsAt({ count: middle })) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low === 0) {
    const shortest = askOf({ quote: tailOf({ count: 1 }) });
    return err(
      RelayDraftErrors.askOverCap({ bytes: summaryWrittenFit({ summary: shortest }).bytes, cap: MAX_SUMMARY_BYTES }),
    );
  }
  const quote = tailOf({ count: low });
  return ok({ ask: askOf({ quote }), quote });
}

/** Whether a UTF-16 code unit is the high (first) half of a surrogate pair. */
function isHighSurrogate({ code }: { code: number }): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Whether a UTF-16 code unit is the low (second) half of a surrogate pair. */
function isLowSurrogate({ code }: { code: number }): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
