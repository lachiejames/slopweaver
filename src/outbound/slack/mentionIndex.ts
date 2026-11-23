/**
 * WHICH keys may address a mention, and which may not. Pure — the whole decision is decidable from here.
 *
 * The design decision this file implements, and it is load-bearing:
 *
 * > **Derive may PROPOSE a link fuzzily. Only a CONFIRMED link may address a mention.**
 * > A wrong guess in the graph is cheap; a wrong guess that pings a colleague is not.
 *
 * Both halves of that are real at different layers. `derive` links people across sources by inference and
 * that is fine — a wrong edge in the world model costs a slightly wrong answer. Turning an inference into an
 * `<@U…>` costs a real person a notification that was meant for someone else, which is why the addressing
 * layer is stricter than the graph layer rather than reusing it wholesale.
 *
 * Three rules follow, each with teeth in the code below:
 *
 * 1. **Every key is OWNED by a Slack identity**, or it is the canonical person id. A person's GitHub login,
 *    Linear id or display NAME is never a key: those are the keys most likely to have been joined to the
 *    wrong Slack account, and a display name is ambiguous even when the join is right. So the addressable
 *    set is: canonical person id, Slack native id, Slack handle, `@handle`, and the email ON the Slack
 *    identity.
 * 2. **A key claimed by two different people is DROPPED and reported**, never resolved first-wins. Two
 *    people sharing a handle is exactly when a first-wins index pings the wrong one.
 * 3. **Held candidates are not addressable.** `derive` holds name-only links instead of applying them; this
 *    index reads only APPLIED people, and the held ids exist here solely so a refusal can name the reason.
 *
 * The human roster (the store's identity roster) is layered ON TOP: it is a human's confirmation, so it
 * wins over anything derived and can resolve a key the derived layer had to drop for ambiguity.
 */
import {
  type DeriveFreshness,
  freshnessAction,
  freshnessReason,
  SILVER_ROSTER_ARTEFACT,
} from "../../silver/derive/freshness.js";
import type { DerivedPerson, DerivedRoster } from "../../silver/derivedRoster.js";
import { isUnpinnedMiss, markClaims, type RoutedMentionLookup, routedLookupRefusals } from "../../silver/heardAs.js";
import type { IdentityRecord, PersonIdentity } from "../../silver/identity.js";
import { type GroupAddress, groupAddressRefusals } from "./groupIndex.js";
import type { ResolvedMentions } from "./render.js";

/**
 * Which layer supplied a resolution: the human roster, the MEMBER index each provider's own member list
 * writes, `derive`'s cross-source resolution, or the bot's own declared identity.
 *
 * `member` sits above `derived` because it is not an inference at all. A member row is Slack's own answer to
 * "who is user `U…`", captured by hydration; a derived person is this repository's guess at which accounts
 * are the same human. The stricter layer wins, which is the same rule `override` already followed.
 *
 * `heard-as` is the member index answering for the key a heard-as pin in the identity roster sent a token to
 * (`../../silver/heardAs.ts`): Slack still named the person, a human declared the route to them.
 */
export type MentionOrigin = "override" | "derived" | "member" | "heard-as" | "self";

/** One candidate (key → Slack user id) pair a roster entry offers. */
interface KeyPair {
  readonly key: string;
  readonly slackId: string;
}

/** The addressable state of a roster, for a refusal message and for `--json`. */
export interface RosterReport {
  readonly freshness: DeriveFreshness;
  /** How many people the derived roster carries at all. */
  readonly derivedPeople: number;
  /** How many distinct keys can address a mention (both layers, after collision drops). */
  readonly addressableKeys: number;
  /** How many people are implicated in a low-confidence link `derive` is HOLDING rather than applying. */
  readonly heldPeople: number;
  /** Keys dropped because two different people claimed them, sorted for a stable report. */
  readonly collisions: readonly string[];
}

/** One resolved mention: the Slack user id to ping, and which layer vouched for it. */
export interface MentionTarget {
  readonly slackId: string;
  readonly origin: MentionOrigin;
}

/**
 * The resolution for one send: what resolved, from where, and the roster state behind it.
 *
 * ONE map, not a map of ids plus a parallel map of origins — two maps kept in lockstep by convention is a
 * desync waiting to happen, and it would show up as a mention attributed to the wrong layer in the audit.
 */
export interface MentionResolution {
  readonly resolved: ReadonlyMap<string, MentionTarget>;
  readonly roster: RosterReport;
  /** The requested people that name a HELD candidate — unresolvable BY DESIGN, and worth saying so. */
  readonly heldRequested: readonly string[];
  /**
   * What the member index concluded about each requested key. A REFUSAL here is terminal for that key: the
   * derived layer is not consulted after it, because the whole reason the member index exists is that it
   * can see people derive cannot, and letting an inference overrule it would restore the failure this
   * layer removes.
   */
  readonly memberLookups: ReadonlyMap<string, RoutedMentionLookup>;
  /**
   * Whether each requested user-group token may ADDRESS anyone, per `./groupIndex.ts`. Groups resolve
   * against a different index for different reasons — a group is not a person, and `derive` has never
   * carried one — so they ride here rather than being folded into {@link resolved}, whose keys are people.
   */
  readonly groupAddresses: ReadonlyMap<string, GroupAddress>;
}

/** The keys a Slack identity itself owns: its native id, its handle (bare and `@`-prefixed), its email. */
function slackIdentityKeys({ identity }: { identity: PersonIdentity }): readonly string[] {
  return [
    identity.nativeId,
    ...(identity.handle === undefined ? [] : [identity.handle, `@${identity.handle}`]),
    ...(identity.email === undefined ? [] : [identity.email]),
  ].filter((key) => key.length > 0);
}

/**
 * Every (key → Slack id) pair one derived person offers.
 *
 * A person with no Slack identity yields NONE — they cannot be pinged, and inventing a target for them is
 * the failure this whole file exists to prevent. A person with TWO Slack identities yields the canonical id
 * twice with different targets, which rule 2 then drops as ambiguous: that is the correct outcome, because
 * "which of their two accounts?" is not a question this layer may answer.
 */
function derivedKeyPairs({ person }: { person: DerivedPerson }): readonly KeyPair[] {
  const slack = person.identities.filter((identity) => identity.source === "slack");
  return slack.flatMap((identity) =>
    [person.id, ...slackIdentityKeys({ identity })].map((key) => ({ key, slackId: identity.nativeId })),
  );
}

/**
 * Every (key → Slack id) pair one HUMAN roster entry offers.
 *
 * The record's own `id`/`handle`/`email` are keys here (unlike the derived layer, where only Slack-owned
 * fields count) precisely because a human wrote them: this file IS the confirmation. `name` is still never a
 * key — a display name is ambiguous no matter who typed it.
 */
function overrideKeyPairs({ record }: { record: IdentityRecord }): readonly KeyPair[] {
  const slack = (record.identities ?? []).filter((identity) => identity.source === "slack");
  const recordKeys = [
    record.id,
    record.handle,
    `@${record.handle}`,
    ...(record.email === undefined ? [] : [record.email]),
  ];
  return slack.flatMap((identity) =>
    [...recordKeys, ...slackIdentityKeys({ identity })]
      .filter((key) => key.length > 0)
      .map((key) => ({ key, slackId: identity.nativeId })),
  );
}

/**
 * Every (key → Slack id) pair the bot's OWN declared identity offers, so an `--as me` send can tag the bot
 * itself. `identityCandidatesForRecord` never proposes this person: `ownerBot.ts` rewrites every record the
 * bot authors back to the human owner before an identity is ever resolved from it (that is the point of
 * me-to-me), so the bot's account can never earn a derived identity of its own to key off. This is the one
 * key pair that is not proposed by inference at all — it is `profile.json`'s `slackBot.selfUserIds`, an
 * operator declaration DEDICATED to this purpose and deliberately not `botUserIds` (which arms me-to-me's
 * unrelated rewrite of the bot's own authored records back to the owner — a real behaviour change nobody
 * asked for just by wanting to tag the bot in a DM).
 *
 * A key here maps to ITSELF: mentioning the bot's own id resolves to that same id.
 */
function selfKeyPairs({ selfUserIds }: { selfUserIds: readonly string[] }): readonly KeyPair[] {
  return selfUserIds.filter((id) => id.length > 0).map((id) => ({ key: id, slackId: id }));
}

/** Index one layer's pairs, DROPPING every key two different targets claimed (rule 2). */
function indexLayer({ pairs }: { pairs: readonly KeyPair[] }): {
  readonly index: ReadonlyMap<string, string>;
  readonly collisions: readonly string[];
} {
  const index = new Map<string, string>();
  const collisions = new Set<string>();
  for (const { key, slackId } of pairs) {
    const seen = index.get(key);
    if (seen !== undefined && seen !== slackId) {
      collisions.add(key);
    }
    index.set(key, slackId);
  }
  for (const key of collisions) {
    index.delete(key);
  }
  return { collisions: [...collisions].toSorted(), index };
}

/**
 * Build the mention index from all layers.
 *
 * @param derived the derived roster from `corpus/silver/index/identities.json`
 * @param overrides the human roster from the store's identity roster
 * @param selfUserIds the bot's own declared ids from `profile.json`'s `slackBot.selfUserIds`, when configured
 * @returns the merged index (override wins) plus the keys dropped as ambiguous
 */
export function buildMentionIndex({
  derived,
  overrides,
  selfUserIds = [],
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  selfUserIds?: readonly string[] | undefined;
}): {
  readonly index: ReadonlyMap<string, { readonly slackId: string; readonly origin: MentionOrigin }>;
  readonly collisions: readonly string[];
} {
  const derivedLayer = indexLayer({ pairs: derived.people.flatMap((person) => derivedKeyPairs({ person })) });
  const selfLayer = indexLayer({ pairs: selfKeyPairs({ selfUserIds }) });
  const overrideLayer = indexLayer({ pairs: overrides.flatMap((record) => overrideKeyPairs({ record })) });
  const index = new Map<string, { slackId: string; origin: MentionOrigin }>();
  for (const [key, slackId] of derivedLayer.index) {
    index.set(key, { origin: "derived", slackId });
  }
  // The bot's own declared identity BEFORE the human layer: it is not an inference, so it sits above
  // `derived`, but the human roster may still redeclare the same key and win — same rule as everywhere else.
  for (const [key, slackId] of selfLayer.index) {
    index.set(key, { origin: "self", slackId });
  }
  // The human layer LAST: a confirmation overrides an inference, and can rescue a key the derived layer
  // dropped as ambiguous. A collision WITHIN the human layer is still dropped — one human, two answers.
  for (const [key, slackId] of overrideLayer.index) {
    index.set(key, { origin: "override", slackId });
  }
  // A key the human layer confirms is no longer a live ambiguity, so it is not reported as one.
  const collisions = [...new Set([...derivedLayer.collisions, ...selfLayer.collisions, ...overrideLayer.collisions])]
    .filter((key) => !overrideLayer.index.has(key))
    .toSorted();
  return { collisions, index };
}

/**
 * The target for one key, applying the layer order the module note states.
 *
 * The human roster is consulted FIRST here rather than last, unlike inside {@link buildMentionIndex}: a
 * member-index refusal is terminal for everything below it, so the one layer allowed to overrule it has to
 * be asked before the refusal is honoured. That is the documented escape from every refusal this file
 * emits — a human confirms the key in the identity roster and it resolves.
 */
function targetFor({
  index,
  overrideIndex,
  memberLookups,
  key,
}: {
  index: ReadonlyMap<string, MentionTarget>;
  overrideIndex: ReadonlyMap<string, string>;
  memberLookups: ReadonlyMap<string, RoutedMentionLookup>;
  key: string;
}): MentionTarget | undefined {
  const confirmed = overrideIndex.get(key);
  if (confirmed !== undefined) {
    return { origin: "override", slackId: confirmed };
  }
  const lookup = memberLookups.get(key) ?? { kind: "unknown" };
  if (lookup.kind === "resolved") {
    return { origin: lookup.heardAsTarget === undefined ? "member" : "heard-as", slackId: lookup.nativeId };
  }
  return isUnpinnedMiss({ lookup }) ? index.get(key) : undefined;
}

/**
 * Resolve the people an artifact mentions against both roster layers.
 *
 * @param derived the derived roster
 * @param overrides the human override roster
 * @param selfUserIds the bot's own declared ids from `profile.json`'s `slackBot.selfUserIds`, when configured
 * @param freshness whether the derived roster still reflects what has been ingested
 * @param people the keys the artifact names, in first-appearance order
 * @returns the resolutions, their origins, the roster report, and any HELD keys requested
 */
export function resolveMentionKeys({
  derived,
  overrides,
  selfUserIds,
  freshness,
  people,
  memberLookups: givenLookups = new Map<string, RoutedMentionLookup>(),
  groupAddresses = new Map<string, GroupAddress>(),
}: {
  derived: DerivedRoster;
  overrides: readonly IdentityRecord[];
  selfUserIds?: readonly string[] | undefined;
  freshness: DeriveFreshness;
  people: readonly string[];
  memberLookups?: ReadonlyMap<string, RoutedMentionLookup>;
  groupAddresses?: ReadonlyMap<string, GroupAddress>;
}): MentionResolution {
  const { index, collisions } = buildMentionIndex({ derived, overrides, selfUserIds });
  const overrideIndex = indexLayer({ pairs: overrides.flatMap((record) => overrideKeyPairs({ record })) }).index;
  const memberLookups = markClaims({ keys: people, lookups: givenLookups, records: overrides });
  const resolved = new Map<string, MentionTarget>();
  for (const person of people) {
    const target = targetFor({ index, key: person, memberLookups, overrideIndex });
    if (target !== undefined) {
      resolved.set(person, target);
    }
  }
  return {
    groupAddresses,
    heldRequested: people.filter((person) => !resolved.has(person) && derived.heldPersonIds.has(person)),
    memberLookups,
    resolved,
    roster: {
      addressableKeys: index.size,
      collisions,
      derivedPeople: derived.people.length,
      freshness,
      heldPeople: derived.heldPersonIds.size,
    },
  };
}

/**
 * The plain key → Slack id map the renderer consumes, dropping the origins it has no use for.
 *
 * @param resolution the full resolution
 * @returns the mentions in the renderer's shape
 */
export function renderableMentions({ resolution }: { resolution: MentionResolution }): ResolvedMentions {
  return {
    groups: new Map(
      [...resolution.groupAddresses].flatMap(([handle, address]) =>
        address.kind === "addressable" ? [[handle, address.group.id] as const] : [],
      ),
    ),
    people: new Map([...resolution.resolved].map(([person, target]) => [person, target.slackId])),
  };
}

/**
 * Why each requested user group could not be addressed, in terms of what the group index found.
 *
 * A sibling of {@link mentionRefusals} rather than part of it, because it takes no `missing` list: a group
 * lookup already carries its own verdict, so "which ones failed" is decidable here rather than recomputed by
 * every caller. Every arm is a refusal that a reader can act on in one step — the disabled and empty arms in
 * particular, since both would otherwise render a perfect-looking mention that reaches nobody.
 *
 * @param resolution the resolution the groups were requested through
 * @returns one or more refusal lines per unresolved group, in request order; empty when every group resolved
 */
export function groupRefusals({ resolution }: { resolution: MentionResolution }): readonly string[] {
  return [...resolution.groupAddresses].flatMap(([handle, address]) => groupAddressRefusals({ address, key: handle }));
}

/**
 * The dry run's own summary of what a resolution settled: how many people, from which layer, how many user
 * groups, and how trustworthy the roster behind them is.
 *
 * ONE definition, and that is the point rather than tidiness. Two verbatim copies stood in
 * `../../cli/commands/slack/core.ts` and `./dripCore.ts`, and when the group half landed only one of them
 * would have grown the group count — leaving the as-me lane's dry run reporting `mentions: 0` for a message
 * that addresses a whole team. The count is what the `inert-mention-in-plain-text` warning tells an author
 * to read, so a count that cannot see a run type is worse than no count.
 *
 * The groups line is OMITTED when no group was requested, so a card that addresses nobody's team reads
 * exactly as it did before.
 *
 * @param resolution the resolution to describe
 * @returns the summary lines, in display order
 */
export function resolutionSummaryLines({ resolution }: { resolution: MentionResolution }): readonly string[] {
  const targets = [...resolution.resolved.values()];
  const overrides = targets.filter((target) => target.origin === "override").length;
  const self = targets.filter((target) => target.origin === "self").length;
  const addressable = [...resolution.groupAddresses.values()].filter(
    (address) => address.kind === "addressable",
  ).length;
  const { roster } = resolution;
  return [
    `mentions: ${String(resolution.resolved.size)} resolved (${String(overrides)} confirmed by the identity roster, ` +
      `${String(self)} the bot's own declared identity, ` +
      `${String(resolution.resolved.size - overrides - self)} from the derived roster)`,
    ...(resolution.groupAddresses.size === 0
      ? []
      : [
          `user groups: ${String(addressable)} of ${String(resolution.groupAddresses.size)} addressable ` +
            "(a group that is disabled, empty, named rather than handled, or ambiguous refuses the send)",
        ]),
    `roster: ${String(roster.addressableKeys)} addressable keys from ${String(roster.derivedPeople)} derived ` +
      `people · ${String(roster.heldPeople)} held (never addressable) · ${String(roster.collisions.length)} ` +
      "ambiguous keys dropped",
  ];
}

/**
 * Why a mention could not be resolved, in terms of the roster's actual state.
 *
 * "no exact match in the identity map" alone is true and useless: the commonest cause is a roster that was
 * never derived or is stale, and the second commonest is a key that WAS found but is held or ambiguous. Each
 * of those has a different fix, so each says its own.
 *
 * @param missing the requested keys that did not resolve
 * @param resolution the resolution those keys came from
 * @returns one or more refusal lines, ending with what to do about it
 */
export function mentionRefusals({
  missing,
  resolution,
}: {
  missing: readonly string[];
  resolution: MentionResolution;
}): readonly string[] {
  const { roster } = resolution;
  const held = new Set(resolution.heldRequested);
  const collided = new Set(roster.collisions);
  return [
    ...missing.flatMap((person) => {
      // The member index saw someone and declined to hand them over — that reason is the specific one, and
      // it displaces every generic line below it.
      const fromMembers = routedLookupRefusals({
        key: person,
        lookup: resolution.memberLookups.get(person) ?? { kind: "unknown" },
        source: "slack",
      });
      return fromMembers.length > 0 ? fromMembers : [genericRefusal({ collided, held, person, roster })];
    }),
    ...(roster.freshness.kind === "fresh" || !dependsOnDerive({ people: missing, resolution })
      ? []
      : [
          `${freshnessReason({ artefact: SILVER_ROSTER_ARTEFACT, freshness: roster.freshness })} — run \`${SILVER_ROSTER_ARTEFACT.command}\``,
        ]),
  ];
}

/** The refusal for a key the member index had nothing to say about — the pre-existing roster-state reasons. */
function genericRefusal({
  person,
  held,
  collided,
  roster,
}: {
  person: string;
  held: ReadonlySet<string>;
  collided: ReadonlySet<string>;
  roster: RosterReport;
}): string {
  if (held.has(person)) {
    return (
      `cannot resolve a mention for ${JSON.stringify(person)}: that identity link is HELD — derive ` +
      "PROPOSED it but nothing has confirmed it, and a held link may never address a mention. " +
      "Confirm it in the identity roster (slopweaver identity roster replace) to make it addressable."
    );
  }
  if (collided.has(person)) {
    return (
      `cannot resolve a mention for ${JSON.stringify(person)}: two different people claim that key, so ` +
      "it was DROPPED rather than resolved to whichever came first. Disambiguate it in " +
      "the identity roster (slopweaver identity roster replace)."
    );
  }
  return (
    `cannot resolve a mention for ${JSON.stringify(person)}: no exact match among the ` +
    `${String(roster.addressableKeys)} addressable keys (canonical person id, Slack id, Slack handle, ` +
    "`@handle`, or email), and no colleague in the member index answers to it either. Mentions are " +
    "exact-match only — never guessed."
  );
}

/**
 * Whether any RESOLVED mention was vouched for by the derived roster — the test {@link staleRosterRefusals}
 * asks, where every key resolved and each one carries the layer that answered it.
 *
 * The ORIGIN, not the member index. {@link dependsOnDerive} asks its question of keys that did NOT resolve,
 * where no origin exists and the member index is the only signal available. Here a key that resolved carries
 * the layer that answered it, and that is the exact answer: a target the human roster, the member index or
 * the bot's own declared identity vouched for cannot be changed by `derive` running again, because
 * {@link targetFor} never consulted `derive` for it.
 *
 * A key that did not resolve at all still counts, and that is not a leftover. `mentionRefusals` refuses
 * those before this ever runs in production, so the arm exists for a direct caller — and for one a fresh
 * `derive` genuinely could resolve, which is the case the stale verdict is about.
 *
 * Measured, which is why these are two functions rather than one. On a bare home the generic
 * refusal tells a reader to confirm the key in the store's identity roster; doing exactly that resolved
 * the mention through the OVERRIDE layer and the send was then refused anyway, for a derived roster that had
 * never been built and could not have mattered. A remedy a refusal names has to actually work.
 *
 * @param people the keys this send asks to mention
 * @param resolution the resolution those keys came from
 * @returns true when at least one mention rests on the derived roster, or has not resolved at all
 */
function restsOnDerive({ people, resolution }: { people: readonly string[]; resolution: MentionResolution }): boolean {
  return people.some((person) => {
    const target = resolution.resolved.get(person);
    return target === undefined || target.origin === "derived";
  });
}

/**
 * Whether any of these keys still RESTS on the derived roster — the test that decides whether a stale
 * `derive` can change this send's outcome at all.
 *
 * Before the member layer, every unresolved mention implicated the roster, so a stale verdict was always
 * worth reporting and always worth refusing on. Now it usually is not: a key the member index refused by
 * name has a reason of its own and a fix of its own, and appending "the roster is stale, run derive" to it
 * sends the reader off to a command that refuses under the heap ceiling and would not have helped anyway.
 */
function dependsOnDerive({
  people,
  resolution,
}: {
  people: readonly string[];
  resolution: MentionResolution;
}): boolean {
  return people.some((person) => {
    return isUnpinnedMiss({ lookup: resolution.memberLookups.get(person) });
  });
}

/**
 * The refusal for a send whose mentions rest on a roster that is STILL not fresh after the consumer's
 * just-in-time refresh had its chance.
 *
 * This is the third rule of the freshness contract with teeth: before it, a stale roster printed a warning
 * and the send went out anyway, which is how a message that could not mention a new colleague still reported
 * itself delivered. It refuses only when the roster can actually change the outcome — a card that mentions
 * nobody is not made wrong by a roster that has not seen this week's joiners.
 *
 * @param resolution the mention resolution, carrying the post-refresh verdict
 * @param people the keys this send asks to mention
 * @returns the refusal lines, or empty when the send may proceed
 */
export function staleRosterRefusals({
  resolution,
  people,
}: {
  resolution: MentionResolution;
  people: readonly string[];
}): readonly string[] {
  const action = freshnessAction({
    // A send whose every mention was settled WITHOUT the derived roster cannot be made wrong by that
    // roster being stale, so it is not held on one. This is the same test `affectsOutput` always made —
    // "can this artefact change the outcome" — now asked against what actually resolved rather than
    // against whether anyone was mentioned at all.
    affectsOutput: restsOnDerive({ people, resolution }),
    artefact: SILVER_ROSTER_ARTEFACT,
    freshness: resolution.roster.freshness,
    // The consumer that produced this resolution already had its just-in-time chance
    // (`mentionsFromIdentity`); reaching here still stale means the refusal arm, never another attempt.
    refreshAttempted: true,
  });
  return action.kind === "refuse" ? [action.line] : [];
}
