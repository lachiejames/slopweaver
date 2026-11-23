/**
 * Resolve a GROUP token — `@engineering`, `founders-all`, a bare `S…` id — to the Slack usergroup it names.
 *
 * ## Why this is a second resolver rather than a sixth tier of the first
 *
 * `./mentionResolver.ts` answers "which colleague is this", from the member index alone, and every arm of
 * its `MentionLookup` is about a person. A group is not a person: it has no email, no org/external status,
 * no per-surface account, and the refusals that matter for it are different ones. Folding groups into that
 * union would make every existing consumer branch on an arm it has no meaning for, which is how a
 * discriminated union stops being worth having.
 *
 * MEASURED, and this is the gap being closed rather than a hypothetical: 48 usergroups exist on the owner's
 * workspace, all 48 sat in structure bronze, and asking any addressing surface here to resolve one answered
 * that no colleague answers to it — the same answer it gives for a person who does not exist. Nothing was
 * missing from the store; nothing READ it, which is why fetching them a third time would have fixed nothing. A group that exists
 * reading as absence is the failure; a group that resolves to the wrong group would be a worse one, which is
 * why every ambiguity below refuses instead of picking.
 *
 * ## The source is the corpus, by ruling
 *
 * The groups handed in come from `./slackUsergroups.ts`, which reads `corpus/structures/slack.jsonl`. That
 * is the owner's call for Slack specifically — the atlas holds the surface map for Slack because something
 * else better suited is holding all the entities — and it is
 * why this file takes the groups rather than fetching them: the SOURCE is a ruling that can move, and a
 * resolver that reached for one itself would have to be rewritten when it did. Pure: the caller injects.
 */

/** One usergroup, as a resolver needs it. */
export interface MentionGroup {
  /** The provider's own id (`S…`) — what a `<!subteam^…>` mention carries. */
  readonly id: string;
  /** The `@`-less handle, which is what a human types. `undefined` when the capture carried none. */
  readonly handle: string | undefined;
  /** The group's display name. `undefined` when the capture carried none. */
  readonly name: string | undefined;
  /** Whether Slack has disabled the group. A disabled group still resolves, and says that it is disabled. */
  readonly deleted: boolean;
  /** Every member's user id, as the corpus holds them. */
  readonly memberIds: readonly string[];
}

/**
 * What a group token resolved to.
 *
 * `ambiguous` exists because a handle and a NAME can collide across two groups, and picking one is not this
 * layer's call for exactly the reason the person resolver gives: a message that pings the wrong team is
 * worse than one that refuses to send.
 */
export type GroupLookup =
  | { readonly kind: "resolved"; readonly group: MentionGroup; readonly matchedOn: GroupMatchTier }
  | { readonly kind: "ambiguous"; readonly groups: readonly MentionGroup[]; readonly matchedOn: GroupMatchTier }
  | { readonly kind: "unknown" };

/** How strongly a token matched a group, strongest first. */
type GroupMatchTier = "id" | "handle" | "name";

/** The tiers in strength order — the strongest at which anything matches decides the answer. */
const GROUP_TIERS: readonly GroupMatchTier[] = ["id", "handle", "name"];

/**
 * A token reduced to what a comparison should see: no leading `@`, no surrounding space, lowercased.
 *
 * @param token the raw token
 * @returns the normalised form, `""` when the token carries nothing
 */
export function normaliseGroupToken({ token }: { token: string }): string {
  return token.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Whether one group answers to a token, and at which tier.
 *
 * @param group the group
 * @param needle the normalised token
 * @returns the tier it matched at, or `undefined`
 */
function groupTier({ group, needle }: { group: MentionGroup; needle: string }): GroupMatchTier | undefined {
  if (group.id.toLowerCase() === needle) {
    return "id";
  }
  // An ABSENT handle or name matches nothing, rather than matching an empty needle. A capture that did not
  // carry a label supports no claim about what the group is called, and answering a token on the strength
  // of one is the "plausible wrong handle" this whole file refuses.
  if (group.handle?.toLowerCase() === needle) {
    return "handle";
  }
  return group.name?.toLowerCase() === needle ? "name" : undefined;
}

/**
 * Resolve one group token.
 *
 * A DELETED group still resolves, and the caller is told. Slack disables a usergroup rather than removing
 * it, and every message written while it was live still carries its id forever — so refusing to name one
 * would take a reader back to the generic `@group` for exactly the mentions a name most helps explain.
 *
 * @param groups every group the corpus holds
 * @param token the raw token — a handle with or without `@`, a group name, or a bare `S…` id
 * @returns the group it names, or the refusal that says why nothing was handed back
 */
export function lookupGroup({ groups, token }: { groups: readonly MentionGroup[]; token: string }): GroupLookup {
  const needle = normaliseGroupToken({ token });
  if (needle.length === 0) {
    return { kind: "unknown" };
  }
  const matches = groups
    .map((group) => ({ group, tier: groupTier({ group, needle }) }))
    .filter((match): match is { group: MentionGroup; tier: GroupMatchTier } => match.tier !== undefined);
  for (const tier of GROUP_TIERS) {
    const atTier = matches.filter((match) => match.tier === tier).map((match) => match.group);
    if (atTier.length === 1) {
      return { group: atTier[0]!, kind: "resolved", matchedOn: tier };
    }
    if (atTier.length > 1) {
      return { groups: atTier, kind: "ambiguous", matchedOn: tier };
    }
  }
  return { kind: "unknown" };
}

/**
 * The lines describing what a group lookup concluded.
 *
 * A resolved group prints its id, because the id is the thing a caller actually needs — a `<!subteam^S…>`
 * mention carries no handle, so a rendering that stopped at the handle would leave the caller to look the id
 * up again somewhere else.
 *
 * @param lookup what the group lookup concluded
 * @param token the token as the caller wrote it
 * @returns the lines, most specific first; empty for `unknown`, since another layer may still answer
 */
export function groupLookupLines({ lookup, token }: { lookup: GroupLookup; token: string }): readonly string[] {
  const quoted = JSON.stringify(token);
  if (lookup.kind === "resolved") {
    const state = lookup.group.deleted ? " [disabled]" : "";
    return [
      `${groupLabel({ group: lookup.group })}${state}`,
      `  slack usergroup ${lookup.group.id}, ${String(lookup.group.memberIds.length)} member(s), matched on ${lookup.matchedOn}`,
      `  mention it as <!subteam^${lookup.group.id}>`,
    ];
  }
  if (lookup.kind === "ambiguous") {
    return [
      `cannot resolve ${quoted}: ${String(lookup.groups.length)} user groups answer to it at the same strength, and picking one is not this layer's call:`,
      ...lookup.groups.map((group) => `    ${groupLabel({ group })} (${group.id})`),
      "  address one of them by its S… id.",
    ];
  }
  return [];
}

/**
 * How one group is named to a reader.
 *
 * A group whose capture carried no handle is named by its id rather than by a bare `@`, because a bare `@`
 * reads as a resolution that produced nothing — which is the one thing this module must never look like.
 *
 * @param group the group
 * @returns the label
 */
function groupLabel({ group }: { group: MentionGroup }): string {
  const handle = group.handle === undefined ? group.id : `@${group.handle}`;
  return group.name === undefined ? handle : `${handle} — ${group.name}`;
}
