/**
 * The shapes of an install's `gmail triage` mail policy, and the pure matcher a sender row is applied by.
 *
 * **The code ships mechanisms; the install chooses.** Which sender's mail is archived unasked, whether a thread the
 * owner answered last or an invite whose meeting already happened is archived, and which provider verb owns which
 * mail are each one install's own choices about its own mailbox. They live in the store's `gmail-triage-rules` row,
 * read by `./triageRuleStore.ts` and written by `slopweaver gmail triage-rules --set <path>`, never in git. An install
 * that declares nothing gets a triage that rules nothing: every group is carded, no thread or invite is held out, and
 * no provider's mail is set aside for another verb.
 *
 * **What a sender row does**: the triage marks a group whose key it names, the seat archives that group's printed ids
 * with `gmail triage --ruled` then `gmail archive`, and no card is ever made of it.
 *
 * **A `from:` row** never matches a group with a message from the owner's own domain or through a discussion list,
 * where a colleague's mail could wear the key, so that group is carded as usual. It does NOT need the group
 * `ruleable`: `automated` is a heuristic over list headers and no-reply local parts, there for the un-vetted paths (a
 * card's rule option), and a declared row is the owner's ruling by exact address that the sender is a machine — a
 * vendor's `accounts@` address carries neither signal.
 *
 * **A `relay:` row** cannot take that guard: a Google Group relay's address is the GROUP's, on the owner's domain, and
 * the group stamps `List-Post` on everything it forwards, so every relay through an internal group reads as both.
 * Its key's sender half is a display name anyone posting to the group chooses, so a relay row is narrowed twice
 * instead — the exact key, and a phrase EVERY message's subject must carry. A colleague posting to the same group is
 * keyed by her own display name, a different key; one message with another subject leaves the whole group carded.
 *
 * A key names a sender and never authenticates one, and a subject is the sender's text too. What bounds that residue
 * is that the act is an archive, and archived mail stays searchable.
 */
/** What every declared choice carries: the anchor to the owner's ruling, and why it loses the owner nothing. */
interface PolicyChoiceBase {
  /** Where the ruling is checkable: a pointer into the install's own record (a card, a call, a knowledge row). */
  readonly anchor: string;
  /** Why acting on it loses the owner nothing — the signal reaches them another way. */
  readonly why: string;
}

/** What every sender row carries: who the owner ruled out, and the anchor to the ruling. */
interface ArchiveRuleBase extends PolicyChoiceBase {
  /** The sender as the owner would name it. */
  readonly sender: string;
}

/** A sender the owner ruled out by its exact `From` address. */
interface FromArchiveRule extends ArchiveRuleBase {
  readonly kind: "from";
  /** The triage group key it covers, exactly: `from:<address>`. */
  readonly key: `from:${string}`;
  /**
   * A phrase every message's subject must contain, case-sensitively, when the owner ruled out only SOME of the
   * address's mail — absent when they ruled out all of it.
   */
  readonly subjectIncludes?: string;
}

/** One sender's mail relayed by a Google Group, ruled out by the relay key AND a subject phrase. */
interface RelayArchiveRule extends ArchiveRuleBase {
  readonly kind: "relay";
  /** The triage group key it covers, exactly: `relay:<group address>:<original sender, lower-cased>`. */
  readonly key: `relay:${string}`;
  /** A phrase every message's subject must contain, case-sensitively, for the group to be covered. */
  readonly subjectIncludes: string;
}

/** One declared sender archive rule. */
export type GmailTriageArchiveRule = FromArchiveRule | RelayArchiveRule;

/**
 * A ruling about a MESSAGE rather than a sender, switched on by the install. `last-reply`: a thread whose newest
 * message is the owner's own reply (`./triageReplied.ts`) is held out of every group and archived unasked.
 * `passed-invite`: an invite whose meeting already happened everywhere (`./triagePassedInvite.ts`) is held out of
 * its organiser's group and archived unasked.
 */
export interface GmailTriageStructuralRule extends PolicyChoiceBase {
  readonly kind: "last-reply" | "passed-invite";
}

/**
 * A provider verb the install hands some mail to instead of carding it. `fathom-clear-inbox` and
 * `gmail-clear-meeting-notes` hold that provider's mail out of every group, because the verb ingests and archives it;
 * `spend-tasks` routes a finance platform's task reminders to `slopweaver spend tasks`, which the seat reads from
 * this row rather than from the reading.
 */
export interface GmailTriageDelegate extends PolicyChoiceBase {
  readonly kind: "fathom-clear-inbox" | "gmail-clear-meeting-notes" | "spend-tasks";
}

/**
 * A ruling the seat may act on only after a live check the reading cannot make, so it never reaches `--ruled`: the
 * seat pins the group, performs the check with existing verbs, and archives only what passes.
 * `provider-integration-not-installed`: mail from `key` about an integration the provider's own API reads as not
 * installed. `calendar-invite-responded`: an invite the owner's own attendee entry on the event already answers.
 */
export type GmailTriageGatedRule =
  | (PolicyChoiceBase & { readonly kind: "provider-integration-not-installed"; readonly key: `from:${string}` })
  | (PolicyChoiceBase & { readonly kind: "calendar-invite-responded" });

/** Everything one install chose about its inbox, as the triage applies it. Empty everywhere means rule nothing. */
export interface GmailTriagePolicy {
  readonly rules: readonly GmailTriageArchiveRule[];
  readonly structuralRules: readonly GmailTriageStructuralRule[];
  readonly delegates: readonly GmailTriageDelegate[];
  readonly gatedRules: readonly GmailTriageGatedRule[];
}

/** The policy an install that declared nothing has: every group carded, nothing held out. */
export const EMPTY_TRIAGE_POLICY: GmailTriagePolicy = { delegates: [], gatedRules: [], rules: [], structuralRules: [] };

/**
 * The structural rule of one kind an install switched on, when it did. Pure.
 *
 * @param policy the install's policy
 * @param kind which structural rule to look for
 * @returns the rule, or undefined when the install left it off
 */
export function structuralRuleOf({
  policy,
  kind,
}: {
  policy: GmailTriagePolicy;
  kind: GmailTriageStructuralRule["kind"];
}): GmailTriageStructuralRule | undefined {
  return policy.structuralRules.find((rule) => rule.kind === kind);
}

/**
 * Whether the install hands a provider's mail to one delegate verb. Pure.
 *
 * @param policy the install's policy
 * @param kind which delegate to look for
 * @returns true when the install enabled it
 */
export function delegateEnabled({
  policy,
  kind,
}: {
  policy: GmailTriagePolicy;
  kind: GmailTriageDelegate["kind"];
}): boolean {
  return policy.delegates.some((delegate) => delegate.kind === kind);
}

/**
 * The declared rule covering one triage group, when there is one. Pure.
 *
 * @param rules every sender row the install declared
 * @param key the group's key, compared exactly
 * @param coverable whether no message in the group came from the owner's domain or through a discussion list — asked of
 *   a `from:` row only, since a relay through an internal group is neither by construction
 * @param subjects every message's subject in the group, a missing one as undefined — asked of a row carrying a
 *   subject phrase
 * @returns the rule, or undefined when none names the key or the group fails that row's narrowing
 */
export function triageArchiveRuleFor({
  rules,
  key,
  coverable,
  subjects,
}: {
  rules: readonly GmailTriageArchiveRule[];
  key: string;
  coverable: boolean;
  subjects: readonly (string | undefined)[];
}): GmailTriageArchiveRule | undefined {
  const rule = rules.find((candidate) => candidate.key === key);
  if (rule === undefined) {
    return undefined;
  }
  if (rule.kind === "from" && !coverable) {
    return undefined;
  }
  const phrase = rule.subjectIncludes;
  if (phrase === undefined) {
    return rule;
  }
  // A group with no subjects at all, or one missing subject, is never covered.
  const everyCarries = subjects.length > 0 && subjects.every((subject) => subject?.includes(phrase) === true);
  return everyCarries ? rule : undefined;
}
