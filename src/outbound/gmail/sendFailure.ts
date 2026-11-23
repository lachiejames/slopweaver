/**
 * What a FAILED Gmail write tells us about whether anything left the machine, read off the failure itself.
 *
 * Conservative by construction: only an instance of one of the two refusals the guarded transport raises before the
 * wire, `./writePrivacy.ts`'s `GmailWriteRefusedError` or `../invalidDatadogHost.ts`'s
 * `InvalidDatadogHostRefusedError`, each constructed by its guard alone, proves nothing was sent. A property or a
 * message saying so on any other value proves nothing, since a transport error could carry the same words after the
 * request left. Everything else — a timeout, a 5xx, a lost response — stays ambiguous, because "nothing was sent" is
 * the verdict that frees a board draft's claim for another press, and a wrong one there stores a second draft.
 *
 * The refusal is found along a bounded, cycle-safe `cause` chain, never off the top value alone: gaxios wraps what
 * its `fetch` threw in a `GaxiosError`, `safeProviderCall` (`../../lib/providerCall.ts`) maps that into an
 * `IngestError`, and the Gmail seam wraps that in its own `GmailError`, each carrying the one before as `cause`.
 */
import { isRecord } from "../../lib/parsers.js";
import { InvalidDatadogHostRefusedError } from "../invalidDatadogHost.js";
import { GmailWriteRefusedError } from "./writePrivacy.js";

/** How many `cause` links are followed before giving up: the real chain is four, from a `GmailError` down. */
const MAX_CAUSE_LINKS = 8;

/**
 * Whether a failed Gmail write was refused before anything left the machine.
 *
 * @param error the failure the write returned — a `GmailError`, an `IngestError`, or a thrown value
 * @returns true only when this value or a link of its `cause` chain is one of the two pre-wire refusals
 */
export function refusedBeforeGmailWire({ error }: { error: unknown }): boolean {
  const seen = new Set<unknown>();
  let link: unknown = error;
  for (let followed = 0; followed < MAX_CAUSE_LINKS && isRecord(link) && !seen.has(link); followed += 1) {
    if (link instanceof GmailWriteRefusedError || link instanceof InvalidDatadogHostRefusedError) {
      return true;
    }
    seen.add(link);
    link = link["cause"];
  }
  return false;
}
