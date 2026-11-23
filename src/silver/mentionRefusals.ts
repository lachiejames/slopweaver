/**
 * What a member-index refusal SAYS: the lines naming each matched person and the way through, if there is one.
 *
 * Split out of `./mentionResolver.ts` along the seam the two halves already had: that module decides WHO a token
 * names, this one only renders the answer when it names nobody addressable. Pure.
 */
import type { IdentitySource } from "./identity.js";
import { type MentionLookup, type MentionMatch, nativeIdOn } from "./mentionResolver.js";

/**
 * One line naming a matched person, for a refusal that has to make a human choose. Pure.
 *
 * @param match the person and the tier that matched them
 * @param source the surface being addressed, so the line names the id that would reach them there
 * @returns the indented line: display name, email, the address on this source, and whether they are
 *   deactivated — everything a human needs to pick between two people of the same name
 */
function mentionMatchLine({ match, source }: { match: MentionMatch; source: IdentitySource }): string {
  const nativeId = nativeIdOn({ match, source });
  const address = nativeId === undefined ? `no ${source} account` : `${source}:${nativeId}`;
  const email = match.person.email === undefined ? "" : ` <${match.person.email}>`;
  const state = match.person.active ? "" : " [deactivated]";
  return `    ${match.person.displayName}${email} — ${address}${state}`;
}

/**
 * The closing line of a refusal: how to address the match deliberately, or that it cannot be addressed at
 * all on this surface. A refusal that ends "address them by their id" when none of them HAS an id on this
 * surface is advice that cannot be followed.
 *
 * On Slack the id is no way through either: the id IS a token the ladder matches, at its strongest tier, and refuses
 * the same outsider for the same reason (MEASURED, `"U0SYN000026"` refused with advice to use
 * `U0SYN000026`). What does let an outsider through is being in the conversation (`inConversationId` in
 * `./mentionResolver.ts`), or a human confirming them in the identity roster, which the Slack addressing layer consults
 * before this refusal.
 */
function addressableAdvice({ matches, source }: { matches: readonly MentionMatch[]; source: IdentitySource }): string {
  const addressable = matches.filter((match) => nativeIdOn({ match, source }) !== undefined);
  if (addressable.length === 0) {
    return `  none of them has a ${source} account, so nothing here can be addressed at all.`;
  }
  if (source === "slack") {
    return (
      "  a slack account outside your organisation is addressable only in a conversation it is a member of: post " +
      "where they are, or confirm them in the identity roster (slopweaver identity roster replace)."
    );
  }
  return `  if that really is who you meant, address them by their ${source} id.`;
}

/** The closing line of an `unverified` refusal: hydrate emails, or {@link addressableAdvice}'s way through. */
function unverifiedAdvice({ matches, source }: { matches: readonly MentionMatch[]; source: IdentitySource }): string {
  return `  re-run \`slopweaver refresh\` so members hydrate with emails, or ${addressableAdvice({ matches, source }).trim()}`;
}

/**
 * The refusal lines for one key the member index would not resolve, or empty when it did. Pure.
 *
 * @param key the key as the caller wrote it
 * @param lookup what the member index concluded
 * @param source the surface being addressed
 * @returns the lines to print, most specific first; empty for a `resolved` or `unknown` lookup, since
 *   `unknown` means the member index has nothing to say and another layer may still answer
 */
export function mentionLookupRefusals({
  key,
  lookup,
  source,
}: {
  key: string;
  lookup: MentionLookup;
  source: IdentitySource;
}): readonly string[] {
  const quoted = JSON.stringify(key);
  if (lookup.kind === "ambiguous") {
    return [
      `cannot resolve ${quoted}: ${String(lookup.matches.length)} colleagues answer to it at the same strength, and picking one is not this layer's call:`,
      ...lookup.matches.map((match) => mentionMatchLine({ match, source })),
      `  address one of them by their id or handle, or pin the intended person in the identity roster (slopweaver identity roster replace).`,
    ];
  }
  if (lookup.kind === "external") {
    return [
      `refusing ${quoted}: the only match is OUTSIDE your organisation's email domains, so it is a different human at a different company:`,
      ...lookup.matches.map((match) => mentionMatchLine({ match, source })),
      addressableAdvice({ matches: lookup.matches, source }),
    ];
  }
  if (lookup.kind === "unverified") {
    return [
      `refusing ${quoted}: the only match carries no trusted email, so nothing places them inside or outside your organisation:`,
      ...lookup.matches.map((match) => mentionMatchLine({ match, source })),
      unverifiedAdvice({ matches: lookup.matches, source }),
    ];
  }
  if (lookup.kind === "no-account") {
    return [
      `cannot resolve ${quoted}: ${lookup.match.person.displayName} has no ${source} account, so there is nothing to address.`,
    ];
  }
  return [];
}
