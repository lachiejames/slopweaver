/**
 * What a FAILED Notion write tells us about whether anything landed, read off the failure itself.
 *
 * Conservative by construction: only an instance of one of the two refusals the write transport raises before the
 * wire, `./writePrivacy.ts`'s `NotionPrivacyRefusedError` or `../invalidDatadogHost.ts`'s
 * `InvalidDatadogHostRefusedError`, each constructed by its guard alone, proves nothing was sent. A property or a
 * message saying so on any other value proves nothing, since a transport error could carry the same words after the
 * request left. Everything else — a timeout, a 5xx, a lost response, a response that did not confirm the page —
 * stays ambiguous, because "nothing was sent" is the verdict that frees a create's reservation for another attempt
 * and a wrong one there publishes a second page Notion cannot tell apart from the first.
 *
 * The refusal is found along a bounded, cycle-safe `cause` chain, never off the top value alone: the SDK re-throws
 * what its `fetch` threw, and `safeProviderCall` (`../../lib/providerCall.ts`) maps that into an `IngestError` whose
 * `cause` is the original (`../../lib/ingestError.ts`), which is what every caller holds.
 */
import { isRecord } from "../../lib/parsers.js";
import { InvalidDatadogHostRefusedError } from "../invalidDatadogHost.js";
import { NotionPrivacyRefusedError } from "./writePrivacy.js";

/** How many `cause` links are followed before giving up: the real chain is two, an `IngestError` and its cause. */
const MAX_CAUSE_LINKS = 8;

/**
 * Whether a failed Notion write was refused before anything left the machine.
 *
 * @param error the failure the write returned — an `IngestError`, or a thrown value
 * @returns true only when this value or a link of its `cause` chain is one of the two pre-wire refusals
 */
export function refusedBeforeNotionWire({ error }: { error: unknown }): boolean {
  const seen = new Set<unknown>();
  let link: unknown = error;
  for (let followed = 0; followed < MAX_CAUSE_LINKS && isRecord(link) && !seen.has(link); followed += 1) {
    if (link instanceof NotionPrivacyRefusedError || link instanceof InvalidDatadogHostRefusedError) {
      return true;
    }
    seen.add(link);
    link = link["cause"];
  }
  return false;
}
