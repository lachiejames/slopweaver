/**
 * What a FAILED Linear mutation tells us about whether anything landed, read off the failure itself.
 *
 * Conservative by construction: only an instance of one of the two refusals `sendGraphql` raises before the wire,
 * `./writePrivacy.ts`'s `LinearPrivacyRefusedError` or `../invalidDatadogHost.ts`'s `InvalidDatadogHostRefusedError`,
 * each constructed by its guard alone, proves nothing was sent. A `refusedBeforeWire: true` property on any other
 * value proves nothing, since a transport error could carry the same name after the request left. Everything else —
 * a timeout, a 5xx, a lost response — stays ambiguous, and the verb settles
 * it with a read-back exactly as before, because "nothing was sent" is the verdict that frees an id for another
 * attempt and a wrong one there is a duplicate.
 *
 * The marker is read along a bounded `cause` chain, never off the top value alone: `safeProviderCall`
 * (`../../lib/providerCall.ts`) does not rethrow what `sendGraphql`'s guard threw, it maps it into an `IngestError`
 * whose `cause` is the original (`../../lib/ingestError.ts`), and that `IngestError` is what every verb holds.
 */
import { isRecord } from "../../lib/parsers.js";
import { InvalidDatadogHostRefusedError } from "../invalidDatadogHost.js";
import { LinearPrivacyRefusedError } from "./writePrivacy.js";

/** How many `cause` links are followed before giving up: the real chain is two, an `IngestError` and its cause. */
const MAX_CAUSE_LINKS = 8;

/**
 * Whether a failed mutation was refused before anything left the machine.
 *
 * @param error the failure the mutation returned — an `IngestError`, or a thrown value
 * @returns true only when this value or a link of its `cause` chain is one of the two pre-wire refusals
 */
export function refusedBeforeWire({ error }: { error: unknown }): boolean {
  const seen = new Set<unknown>();
  let link: unknown = error;
  for (let followed = 0; followed < MAX_CAUSE_LINKS && isRecord(link) && !seen.has(link); followed += 1) {
    if (link instanceof LinearPrivacyRefusedError || link instanceof InvalidDatadogHostRefusedError) {
      return true;
    }
    seen.add(link);
    link = link["cause"];
  }
  return false;
}

/**
 * Settle a failed mutation that never reached the wire: release the reservation THIS invocation took for it, when
 * it took one, so the reworded retry the refusal asks for is not refused as a duplicate.
 *
 * @param error the failure the mutation returned
 * @param release frees this invocation's own fresh reservation; undefined when it took none (an update)
 * @returns true when the failure was refused before the wire and is settled; false when it stays ambiguous
 */
export function settledBeforeWire({ error, release }: { error: unknown; release: (() => void) | undefined }): boolean {
  if (!refusedBeforeWire({ error })) {
    return false;
  }
  if (release !== undefined) {
    release();
  }
  return true;
}
