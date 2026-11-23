/**
 * WHICH user groups may be ADDRESSED by an outbound message, and which may not. Pure.
 *
 * The sibling of `./mentionIndex.ts`, and it exists for the reason `../../silver/groupMention.ts` already
 * gives for being a second resolver rather than a sixth tier of the first: a group is not a person, and the
 * refusals that matter for one are different refusals.
 *
 * ## What this adds on top of the resolver, and why it is a separate layer
 *
 * `../../silver/groupMention.ts` answers "which group is this token", and it deliberately RESOLVES a
 * disabled group and a name-only match. Both are right for its own caller: `identity resolve` is READING,
 * and a message written while a group was live carries `<!subteam^S…>` forever, so naming a disabled group
 * is exactly the help a reader wants.
 *
 * Sending is the opposite question. Three of that resolver's answers reach nobody, and each would render as
 * a perfect-looking mention while doing so — which is the whole failure class the outbound side exists to
 * prevent:
 *
 *  - **disabled** — Slack disables a group rather than deleting it; mentioning one notifies no one.
 *  - **empty** — a live group with no members. Five of this install's 48 were empty when this was written,
 *    so the arm is measured rather than hypothetical (`slopweaver identity groups`).
 *  - **name-only** — the token matched the group's display NAME. The group called `Engineering` is addressed
 *    as `@engineers`, and Slack has no markup for a name at all. Refusing while NAMING the handle turns a
 *    dead end into a one-word fix, and it is the same rule `./mentionIndex.ts` states for a person: a
 *    display name is never an addressing key.
 *
 * So the resolver decides WHO, and this decides whether addressing them would actually reach anyone.
 */
import { type GroupLookup, lookupGroup, type MentionGroup } from "../../silver/groupMention.js";

/**
 * Whether one token may address a group, and if not, why.
 *
 * `unreachable` folds disabled and empty deliberately: they are one situation to an author — the mention
 * would notify nobody — and the `why` carries which it was, so a refusal still says the specific thing
 * without a caller having to branch on two arms that share a remedy.
 */
export type GroupAddress =
  | { readonly kind: "addressable"; readonly group: MentionGroup; readonly handle: string }
  | { readonly kind: "unreachable"; readonly group: MentionGroup; readonly why: "disabled" | "empty" }
  | { readonly kind: "name-only"; readonly group: MentionGroup }
  | { readonly kind: "ambiguous"; readonly groups: readonly MentionGroup[] }
  | { readonly kind: "unknown" };

/**
 * Judge one resolver verdict as an addressing decision.
 *
 * @param lookup what `../../silver/groupMention.lookupGroup` concluded for this token
 * @returns whether the token may address a group, or the reason it may not
 */
export function addressableGroup({ lookup }: { lookup: GroupLookup }): GroupAddress {
  if (lookup.kind === "unknown") {
    return { kind: "unknown" };
  }
  if (lookup.kind === "ambiguous") {
    return { groups: lookup.groups, kind: "ambiguous" };
  }
  const group = lookup.group;
  if (lookup.matchedOn === "name") {
    return { group, kind: "name-only" };
  }
  if (group.deleted) {
    return { group, kind: "unreachable", why: "disabled" };
  }
  if (group.memberIds.length === 0) {
    return { group, kind: "unreachable", why: "empty" };
  }
  // The handle is what the `|@handle` fallback in a rendered mention shows a non-member and a notification
  // preview, so a group matched by its `S…` id still needs one. Absent, the id stands in — which renders as
  // the id rather than as a bare `@`, the one thing `groupLabel` also refuses to emit.
  return { group, handle: group.handle ?? group.id, kind: "addressable" };
}

/** One line naming a group, for a refusal that has to make a human choose or correct a token. */
function groupLine({ group }: { group: MentionGroup }): string {
  const handle = group.handle === undefined ? group.id : `@${group.handle}`;
  const name = group.name === undefined ? "" : ` — ${group.name}`;
  return `    ${handle}${name}, ${String(group.memberIds.length)} member(s), ${group.id}`;
}

/**
 * The refusal lines for one token that may not address a group, or empty when it may.
 *
 * @param key the token as the author wrote it
 * @param address what {@link addressableGroup} decided
 * @returns the lines to print, most specific first; empty for an `addressable` verdict
 */
export function groupAddressRefusals({ key, address }: { key: string; address: GroupAddress }): readonly string[] {
  const quoted = JSON.stringify(key);
  if (address.kind === "addressable") {
    return [];
  }
  if (address.kind === "unreachable") {
    const state = address.why === "disabled" ? "Slack has DISABLED that group" : "that group has no members";
    return [
      `cannot address the user group ${quoted}: ${state}, so mentioning it renders correctly and notifies ` +
        "NOBODY. Address the people you meant, or fix the group in Slack first.",
      groupLine({ group: address.group }),
    ];
  }
  if (address.kind === "name-only") {
    return [
      `cannot address the user group ${quoted}: that is a group's display NAME, not its handle, and Slack ` +
        "has no markup for a name. A name is never an addressing key — use the handle:",
      groupLine({ group: address.group }),
    ];
  }
  if (address.kind === "ambiguous") {
    return [
      `cannot address the user group ${quoted}: ${String(address.groups.length)} user groups answer to it ` +
        "at the same strength, and picking one is not this layer's call:",
      ...address.groups.map((group) => groupLine({ group })),
      "  address the one you meant by its `S…` id.",
    ];
  }
  return [
    `cannot address the user group ${quoted}: no Slack user group has that handle, name or id. Groups come ` +
      "from `slopweaver refresh`, which hydrates `usergroups.list` into the structure index — refresh if the " +
      "group is new, and check the handle with `slopweaver identity resolve`.",
  ];
}

/**
 * Judge every requested token in one pass.
 *
 * A token that normalises to nothing is kept and answers `unknown` rather than being filtered out: a
 * silently dropped key is a mention an author asked for and never got, with nothing said about it.
 *
 * @param groups every group the corpus holds, from `../../silver/slackUsergroups.readSlackUsergroups`
 * @param keys the tokens an artifact addresses, in any order
 * @returns one verdict per DISTINCT token
 */
export function addressableGroups({
  groups,
  keys,
}: {
  groups: readonly MentionGroup[];
  keys: readonly string[];
}): ReadonlyMap<string, GroupAddress> {
  return new Map(
    [...new Set(keys)].map((key) => [key, addressableGroup({ lookup: lookupGroup({ groups, token: key }) })]),
  );
}
