/**
 * Whether a relay's words land on each OTHER card they also answer (`relay_steer`'s `also_answers`: the Queue cards must refresh). Each card is judged against its own key and, for an `ask:`, its own doc text,
 * exactly as `./relayChannelSteer.ts`'s `relayCardDisposition` judges the open card — never the open card's verdict
 * reused, because an `ask:` card's text is half of that decision. Pure: the shell
 * (`../cli/commands/talk/relayChannelRun.ts`) reads the draft register once and hands each card's text in.
 */
import {
  type RelayCardDisposition,
  type RelayCardText,
  type RelayReferents,
  relayCardDisposition,
} from "./relayChannelSteer.js";

/**
 * The disposition of every also-answered card, keyed by card, in the order named.
 *
 * @param keys the relay's also-answered card keys
 * @param referents the drafts and channels the owner's words name, read once for the whole relay
 * @param readCardText one card's own text, read for an `ask:` card only
 * @returns each card's disposition
 */
export function alsoAnsweredDispositions({
  keys,
  referents,
  readCardText,
}: {
  keys: readonly string[];
  referents: RelayReferents;
  readCardText: (input: { readonly about: string }) => RelayCardText;
}): ReadonlyMap<string, RelayCardDisposition> {
  return new Map(
    keys.map((key) => [key, relayCardDisposition({ about: key, cardText: readCardText({ about: key }), referents })]),
  );
}
