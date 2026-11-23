/**
 * One combined verdict for the two standing ignore registries — `./ignore.ts`'s exact-ask registry and
 * `./ignoredConversation.ts`'s channel-keyed sibling — so every entrance that used to ask "is this exact ask
 * ignored" asks one question instead of two, and reports WHICH registry answered.
 *
 * Ask-level takes priority in the verdict when both happen to apply (an exact ask individually ignored
 * inside a conversation that is ALSO ignored) purely for the message a caller shows — either registry alone
 * is sufficient to suppress, so which one is named is cosmetic, not a behavioural choice.
 */
import type { AskIdentity } from "./identity.js";
import { type IgnoredAsk, ignoredAskKey } from "./ignore.js";
import { type IgnoredConversation, isIgnoredConversation } from "./ignoredConversation.js";

/**
 * Which registry suppressed this ask, and the entry that did it.
 *
 * @internal every caller destructures `.kind`/`.entry` off {@link ignoredEntranceVerdict}'s return value
 * inline; nothing outside this file names the union type itself.
 */
export type IgnoredEntranceVerdict =
  | { readonly kind: "ask"; readonly entry: IgnoredAsk }
  | { readonly kind: "conversation"; readonly entry: IgnoredConversation };

/**
 * Whether one ask is suppressed by either registry, and by which. Pure and total.
 *
 * @param askIdentity the identity to check; only `channel`/`messageTs` matter
 * @param ignoredAsks the folded exact-ask registry
 * @param ignoredConversations the folded conversation registry
 * @returns the verdict naming which registry suppressed it, or `undefined` when neither does
 */
export function ignoredEntranceVerdict({
  askIdentity,
  ignoredAsks,
  ignoredConversations,
}: {
  askIdentity: Pick<AskIdentity, "channel" | "messageTs">;
  ignoredAsks: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
}): IgnoredEntranceVerdict | undefined {
  const ask = ignoredAsks.get(ignoredAskKey({ askIdentity }));
  if (ask !== undefined) {
    return { entry: ask, kind: "ask" };
  }
  if (isIgnoredConversation({ channel: askIdentity.channel, ignored: ignoredConversations })) {
    const conversation = ignoredConversations.get(askIdentity.channel);
    // `isIgnoredConversation` above already established this is present and `kind === "ignore"`.
    return conversation === undefined ? undefined : { entry: conversation, kind: "conversation" };
  }
  return undefined;
}
