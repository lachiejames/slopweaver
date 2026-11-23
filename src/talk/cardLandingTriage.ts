/**
 * The owner's triage ruling, carried onto the landing their words made — pure. A relay carrying `triage` lands its card off the owner's
 * Queue like any steer about the open card (`./cardLanding.ts`), so the Queue could not tell "park it for a working
 * session" from "send it": both read as a card gone. `talk cards --json` names the ruling beside each landing whose
 * work row is a relay that carried one, so the Queue draws a parked card parked, below the rest, with the owner's inbox-zero
 * label, instead of the chair having to `queue defer` it back.
 *
 * Joined on the relay's own anchor among the landing's, then on its `workSlug`. A `talk:<turnId>` landing carries the
 * relay's anchor whatever its work is — an ask card's work is the ask, never the relay row — and a
 * transcript landing the same relay settled points its work at the relay row, so both carry the same ruling. Output
 * only: the ledger row's schema is untouched, since the ruling is the relay ledger's fact, read fresh each time.
 */
import { type CardLandedRow, landedAnchors } from "./cardLanding.js";
import { relayCutHold } from "./relayCutHold.js";
import type { TurnRecord } from "./relayStore.js";
import type { TriageLabel, TriageVerdict } from "./triageVocabulary.js";

/** A landing as `talk cards --json` prints it: the ledger's row, and the owner's triage ruling when a relay carried one. */
export type PublishedCardLanding = CardLandedRow & {
  readonly triage?: { readonly verdict: TriageVerdict; readonly label?: TriageLabel };
};

/**
 * Each landing with the owner's triage ruling beside it, when the relay its work row names carried one.
 *
 * @param landings the landings holding a card off the owner's Queue, in their order
 * @param relays the relay ledger's rows
 * @returns the same landings, in the same order, each ruled one carrying `triage`
 */
export function landingsWithTriage({
  landings,
  relays,
}: {
  landings: readonly CardLandedRow[];
  relays: readonly TurnRecord[];
}): readonly PublishedCardLanding[] {
  // Every relay, ruled or not: a landing under a relay's own anchor takes that relay's ruling or none, never an older
  // ruling the work row's relay carried.
  const bySlug = new Map<string, TurnRecord["triageRuling"]>();
  const byAnchor = new Map<string, TurnRecord["triageRuling"]>();
  for (const relay of relays) {
    // A verdict the voice read off words that may stop short is no ruling, even on a landing a later stretch made: only
    // a typed steer or a voice relay that SAYS its words were whole stands (`./relayCutHold.ts`). A record written now
    // with an unstated end omits the field exactly as one written before the mark does, so the two cannot be told
    // apart, and an older voice park is undrawn rather than a new unstated one drawn. Measured with
    // `slopweaver talk cards --json | grep -o '"triage":{[^}]*}'`: one live landing carried a ruling, a `rewrite`.
    const whole = relay.typed || relayCutHold({ heardTailCut: relay.heardTailCut }) === undefined;
    const ruling = whole ? relay.triageRuling : null;
    bySlug.set(relay.slug, ruling);
    byAnchor.set(relay.anchor, ruling);
  }
  return landings.map((landing) => {
    const anchored = landedAnchors({ row: landing }).find((anchor) => byAnchor.has(anchor));
    const ruling = anchored === undefined ? bySlug.get(landing.workSlug) : byAnchor.get(anchored);
    if (ruling === undefined || ruling === null) {
      return landing;
    }
    const triage =
      ruling.label === undefined ? { verdict: ruling.verdict } : { label: ruling.label, verdict: ruling.verdict };
    return { ...landing, triage };
  });
}
