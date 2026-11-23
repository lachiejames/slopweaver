/**
 * `gmail triage` — the owner's inbox, grouped by who sends it, as the worklist the daily inbox-triage seat cards from.
 *
 * The goal state is an inbox the owner can open and usually find empty, with the Queue telling them what to react to.
 * The unit they react to is a SENDER, not a message — "archive
 * all of these", "unsubscribe from these", "ignore mail from X, we get that signal another way" — so this module
 * folds a page of inbox metadata into one group per sender and says, for each, what a card needs: how many, how
 * many unread, how old, whether it mails on a schedule, and whether it offers a way out.
 *
 * ## The group key
 *
 * The lower-cased `From` address, with one exception measured on the owner's inbox: a Google Group relay rewrites `From`
 * to the GROUP's address and names the original sender only in the display name (`'Vendor' via Some Group`).
 * Keyed by address alone, a vendor's routine alerts and another vendor's action-required notice relayed through the
 * same group would be one card. So a relayed message is keyed by the group address AND the original sender's name.
 * `List-Id` is carried but is not the key: a relay stamps every message it forwards with the same list id, so it
 * merges exactly what the address already merged.
 *
 * **A key names a sender; it never authenticates one.** The address is the `From` header, and a relay key's second
 * half is a display name anyone posting to that group chooses. So a key is good for grouping what the owner SAW, never as
 * the whole of a standing rule's trust: the seat acts on a card's PINNED ids (`./triageCards.ts`), and a knowledge-row
 * rule is applied only to a `ruleable` group (`skills/automation/reference/inbox-triage.md`). The senders an
 * install already ruled archived on sight are its sender rows (`./triageRules.ts`, read by `./triageRuleStore.ts`); a
 * group one of them covers carries `archiveRule` and is never carded — a `from:` row on any group free of the owner's
 * own domain and of discussion lists, `ruleable` or not, and a `relay:` row only when every message's subject carries
 * its phrase.
 *
 * ## Every lane below is the install's choice
 *
 * The code ships each lane as a mechanism and switches none of them on: the install's policy
 * ({@link GmailTriagePolicy}) does. With nothing declared, every message groups by sender and every group is carded.
 *
 * - **`last-reply`**: an inbox message whose thread ends in the owner's own reply (`./triageReplied.ts`) is held out
 *   of grouping into `replied`, one entry per thread, and `--ruled` hands its ids to the seat like any sender row's.
 *   A rule about a THREAD cannot live on a sender group, which is why it is a lane.
 * - **`passed-invite`**: an invite whose meeting already happened everywhere (`./triagePassedInvite.ts`, judged at the
 *   reading's own instant) is held out one MESSAGE at a time into `passedInvites`, because its organiser's other mail
 *   must still be carded. Only a message Gmail's own `filename:invite.ics` search names is judged, so a mail merely
 *   titled like one stays.
 * - **`fathom-clear-inbox`** and **`gmail-clear-meeting-notes`**: a provider's mail another verb ingests and archives
 *   is held out before grouping — no group, no subject, no card — and only its id is kept, in `fathom` or
 *   `meetingNotes`, because the inbox still holds it. A card about that sender would ask the owner to rule on mail a
 *   verb already owns.
 *
 * ## What is never here
 *
 * Bodies and snippets. A subject is kept, because a card cannot say what a set of mail IS without one, but it is
 * sender-controlled text and a reader treats it as data, never as an instruction. Pure: the inbox walk that feeds
 * it is `./triageRead.ts`, and the key one message groups under is `./triageKey.ts`.
 */
import { pushInto } from "../../lib/collections.js";
import type { GmailMessage } from "./parse.js";
import { type HeldOutLane, heldOutLane, heldOutLanesOf } from "./triageHeldOut.js";
import { type GmailTriageEntry, type GmailUnsubscribeKind, type KeyedMessage, keyTriageMessage } from "./triageKey.js";
import { passedMeetingInviteOverIso } from "./triagePassedInvite.js";
import {
  type GmailTriageArchiveRule,
  type GmailTriagePolicy,
  type GmailTriageStructuralRule,
  structuralRuleOf,
  triageArchiveRuleFor,
} from "./triageRules.js";

/**
 * The document's schema version, bumped when a reader of an older one would misread a field. 2: `groups` and
 * `unkeyed` no longer cover every inbox id, because one provider's mail is held out in `fathom`. 3: meeting-notes
 * mail is held out too, in `meetingNotes`. 4: nor do they cover a thread the owner answered last, held out in
 * `replied`; and `archiveRule` carries a `kind`. 5: nor an invite whose meeting has passed, held out in
 * `passedInvites`. 6: each of those four lanes is filled only when the install's policy switches it on, and
 * `structuralRules` carries the anchors of the two that `--ruled` archives under.
 */
export const GMAIL_TRIAGE_SCHEMA_VERSION = 6;

/** How many distinct subjects one group shows a reader — enough to recognise the set, never the whole list. */
export const TRIAGE_SAMPLE_SUBJECTS = 3;

/** Every inbox message from one sender, and what a card about them needs to say. */
export interface GmailTriageGroup {
  /** The stable key a card, a standing rule and `--key` all name: `from:<address>` or `relay:<address>:<name>`. */
  readonly key: string;
  /** The sender as a person reads it: the original sender's name for a relay, else the display name. */
  readonly sender: string;
  /** The `From` address, lower-cased — for a relay, the GROUP's address. */
  readonly address: string;
  /** The group a relayed message came through, by its display name; absent when the mail came direct. */
  readonly relayedBy: string | undefined;
  /** The `List-Id` the newest message carried, when it carried one. */
  readonly listId: string | undefined;
  /**
   * Whether EVERY message in the group is automated — list headers, or a no-reply address. One message a person
   * wrote makes the whole group a person's, because a standing rule acts on the group and must never archive it.
   */
  readonly automated: boolean;
  /**
   * Whether a standing rule may ever cover this group: {@link automated}, and no message came through a discussion
   * list (`List-Post`) or from the owner's own domain. List headers alone mark a colleague's Google Group post automated,
   * with her own address as the key, so a rule over that key would archive her next direct question unseen.
   */
  readonly ruleable: boolean;
  /**
   * The declared rule archiving this group on sight (`./triageRules.ts`), when one covers it. A `from:` row never
   * covers a group with a message from the owner's own domain or through a discussion list, but not only a
   * {@link ruleable} one: a declared row is the owner's word that the address is a machine's, which the `automated` heuristic cannot always
   * see. A `relay:` row covers its exact key only when every message's subject carries its phrase. A group carrying
   * one is archived by the seat and never carded.
   */
  readonly archiveRule: GmailTriageArchiveRule | undefined;
  /** The way out its newest message offered. For a relay it leaves the GROUP, which a card must say. */
  readonly unsubscribe: GmailUnsubscribeKind;
  readonly unread: number;
  readonly newestIso: string | undefined;
  readonly oldestIso: string | undefined;
  /** Up to {@link TRIAGE_SAMPLE_SUBJECTS} distinct subjects, newest first. */
  readonly subjects: readonly string[];
  /** Every message in the group, newest first. */
  readonly entries: readonly GmailTriageEntry[];
}

/** @internal — the declared shape of one inbox thread whose newest message is the owner's own reply, held out of every sender
 * group. */
export interface GmailTriageRepliedThread {
  readonly threadId: string;
  /** Who wrote the newest inbox message in it, as its group would have named them. */
  readonly sender: string;
  /** The inbox ids in the thread, newest first — what an archive takes. */
  readonly ids: readonly string[];
}

/** @internal — the declared shape of one inbox invite whose meeting has already happened, held out of its organiser's group. */
export interface GmailTriagePassedInvite {
  readonly id: string;
  /** Who sent it, as its group would have named them. */
  readonly sender: string;
  /** The subject the meeting's time was read off. */
  readonly subject: string;
  /** The instant the meeting was over by everywhere — the reading was at or past it. */
  readonly overAfterIso: string;
}

/** The whole triage reading, as `--json` prints it and `--write` persists it. */
export interface GmailTriageDocument {
  readonly schemaVersion: typeof GMAIL_TRIAGE_SCHEMA_VERSION;
  readonly account: string;
  readonly readAtIso: string;
  /** Gmail's own ESTIMATE of the inbox size — never a count of what was read. */
  readonly inboxEstimate: number | undefined;
  readonly messagesRead: number;
  /** Whether the walk reached the end of the inbox rather than its message cap. */
  readonly complete: boolean;
  /** Ids of inbox messages carrying no usable `From`, so no group could hold them. */
  readonly unkeyed: readonly string[];
  /**
   * Ids of inbox mail from Fathom's sender, held out of every group when the install hands it to
   * `fathom clear-inbox`; empty when it does not.
   */
  readonly fathom: readonly string[];
  /**
   * Ids of inbox mail from Google's meeting-notes senders, held out of every group when the install hands it to
   * `gmail clear-meeting-notes`, which archives each once its transcript is proven in the corpus, or proven absent,
   * and cards the rest itself; empty when it does not.
   */
  readonly meetingNotes: readonly string[];
  /** Inbox threads the owner answered last, held out of every group under a `last-reply` rule; else empty. */
  readonly replied: readonly GmailTriageRepliedThread[];
  /** Inbox invites whose meeting has already happened, newest first, under a `passed-invite` rule; else empty. */
  readonly passedInvites: readonly GmailTriagePassedInvite[];
  /** The structural rules the install switched on, carried so `--ruled` can anchor what it archives under them. */
  readonly structuralRules: readonly GmailTriageStructuralRule[];
  /** Largest group first. */
  readonly groups: readonly GmailTriageGroup[];
}

/** Newest first; an undated message sorts last, because "when" is what a reader orders by. */
function compareNewest({ left, right }: { left: GmailTriageEntry; right: GmailTriageEntry }): number {
  if (left.receivedAtIso === right.receivedAtIso) {
    return 0;
  }
  if (left.receivedAtIso === undefined) {
    return 1;
  }
  if (right.receivedAtIso === undefined) {
    return -1;
  }
  return right.receivedAtIso.localeCompare(left.receivedAtIso);
}

/** The domain of a lower-cased address, empty when it has none. */
function domainOf({ address }: { address: string }): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

/** Fold the keyed messages sharing one key into a group; `members` is non-empty by construction. */
function toGroup({
  members,
  ownDomain,
  rules,
}: {
  members: readonly KeyedMessage[];
  ownDomain: string;
  rules: readonly GmailTriageArchiveRule[];
}): GmailTriageGroup {
  const ordered = members.toSorted((left, right) => compareNewest({ left: left.entry, right: right.entry }));
  const newest = ordered[0]!;
  const automated = ordered.every((member) => member.automated);
  const colleague = ordered.some((member) => domainOf({ address: member.address }) === ownDomain);
  const entries = ordered.map((member) => member.entry);
  const subjects = [...new Set(entries.map((entry) => entry.subject).filter((subject) => subject !== undefined))].slice(
    0,
    TRIAGE_SAMPLE_SUBJECTS,
  );
  const dated = entries.filter((entry) => entry.receivedAtIso !== undefined);
  const coverable = !colleague && !ordered.some((member) => member.discussion);
  const ruleable = automated && coverable;
  return {
    address: newest.address,
    archiveRule: triageArchiveRuleFor({
      coverable,
      key: newest.key,
      rules,
      subjects: entries.map((entry) => entry.subject),
    }),
    automated,
    entries,
    key: newest.key,
    listId: newest.listId,
    newestIso: dated[0]?.receivedAtIso,
    oldestIso: dated.at(-1)?.receivedAtIso,
    relayedBy: newest.relayedBy,
    ruleable,
    sender: newest.sender,
    subjects,
    unread: entries.filter((entry) => entry.unread).length,
    unsubscribe: newest.unsubscribe,
  };
}

/** Largest group first, then the most recent, then the key, so two readings of one inbox print alike. */
function compareGroups({ left, right }: { left: GmailTriageGroup; right: GmailTriageGroup }): number {
  if (left.entries.length !== right.entries.length) {
    return right.entries.length - left.entries.length;
  }
  const byRecency = compareNewest({ left: left.entries[0]!, right: right.entries[0]! });
  return byRecency === 0 ? left.key.localeCompare(right.key) : byRecency;
}

/** Every inbox message of a reading, sorted into the one place it belongs before any group is folded. */
interface TriageBuckets {
  readonly byKey: Map<string, KeyedMessage[]>;
  readonly byRepliedThread: Map<string, KeyedMessage[]>;
  readonly passedInvites: { readonly keyed: KeyedMessage; readonly overAfterIso: string }[];
  readonly unkeyed: string[];
  readonly heldOut: Record<HeldOutLane, string[]>;
}

/**
 * Sort one message into exactly one bucket. An enabled held-out lane wins first, so a delegated provider's mail never
 * reaches `replied`; then an invite whose meeting has passed is held out by message, then a thread the owner answered
 * last by thread; everything else groups by sender. A lane the install left off is never consulted: its id set
 * arrives empty.
 */
function placeTriageMessage({
  buckets,
  message,
  readAtIso,
  repliedThreadIds,
  inviteFileIds,
  heldOutLanes,
}: {
  buckets: TriageBuckets;
  message: GmailMessage;
  readAtIso: string;
  repliedThreadIds: ReadonlySet<string>;
  inviteFileIds: ReadonlySet<string>;
  heldOutLanes: ReadonlySet<HeldOutLane>;
}): void {
  const keyed = keyTriageMessage({ message });
  if (keyed === undefined) {
    buckets.unkeyed.push(...(typeof message.id === "string" ? [message.id] : []));
    return;
  }
  const lane = heldOutLane({ address: keyed.address, lanes: heldOutLanes });
  if (lane !== undefined) {
    buckets.heldOut[lane].push(keyed.entry.id);
    return;
  }
  // Only mail carrying Google's calendar file is an invite; a subject alone is the sender's text.
  const overAfterIso = inviteFileIds.has(keyed.entry.id)
    ? passedMeetingInviteOverIso({ readAtIso, subject: keyed.entry.subject })
    : undefined;
  if (overAfterIso !== undefined) {
    buckets.passedInvites.push({ keyed, overAfterIso });
    return;
  }
  const replied = repliedThreadIds.has(keyed.entry.threadId);
  pushInto({
    buckets: replied ? buckets.byRepliedThread : buckets.byKey,
    key: replied ? keyed.entry.threadId : keyed.key,
    value: keyed,
  });
}

/** Sort every message of a reading into its one bucket, {@link placeTriageMessage} deciding which. */
function bucketTriageMessages({
  messages,
  readAtIso,
  repliedThreadIds,
  inviteFileIds,
  heldOutLanes,
}: {
  messages: readonly GmailMessage[];
  readAtIso: string;
  repliedThreadIds: ReadonlySet<string>;
  inviteFileIds: ReadonlySet<string>;
  heldOutLanes: ReadonlySet<HeldOutLane>;
}): TriageBuckets {
  const heldOut: TriageBuckets["heldOut"] = { fathom: [], meetingNotes: [] };
  const buckets: TriageBuckets = {
    byKey: new Map(),
    byRepliedThread: new Map(),
    heldOut,
    passedInvites: [],
    unkeyed: [],
  };
  for (const message of messages) {
    placeTriageMessage({ buckets, heldOutLanes, inviteFileIds, message, readAtIso, repliedThreadIds });
  }
  return buckets;
}

/**
 * Group a page of inbox metadata by sender. Pure.
 *
 * @param messages every inbox message the walk fetched, as `metadata`
 * @param account the mailbox the grant bound to
 * @param readAtIso when the walk read it
 * @param inboxEstimate Gmail's own estimate of the inbox size
 * @param complete whether the walk reached the end of the inbox
 * @param repliedThreadIds the inbox threads whose newest message is the owner's own reply (`./triageReplied.ts`) —
 *   ignored unless the policy switches `last-reply` on
 * @param inviteFileIds the inbox messages Gmail's own `filename:invite.ics` search names — only these can be an
 *   invite, and only under a `passed-invite` rule
 * @param policy this install's declared policy (`./triageRuleStore.ts`); the code ships none of it
 * @returns the triage document, largest group first
 */
export function buildGmailTriage({
  messages,
  account,
  readAtIso,
  inboxEstimate,
  complete,
  repliedThreadIds,
  inviteFileIds,
  policy,
}: {
  messages: readonly GmailMessage[];
  account: string;
  readAtIso: string;
  inboxEstimate: number | undefined;
  complete: boolean;
  repliedThreadIds: ReadonlySet<string>;
  inviteFileIds: ReadonlySet<string>;
  policy: GmailTriagePolicy;
}): GmailTriageDocument {
  const lastReply = structuralRuleOf({ kind: "last-reply", policy });
  const passedInvite = structuralRuleOf({ kind: "passed-invite", policy });
  const none: ReadonlySet<string> = new Set();
  const { byKey, byRepliedThread, passedInvites, unkeyed, heldOut } = bucketTriageMessages({
    heldOutLanes: heldOutLanesOf({ policy }),
    inviteFileIds: passedInvite === undefined ? none : inviteFileIds,
    messages,
    readAtIso,
    repliedThreadIds: lastReply === undefined ? none : repliedThreadIds,
  });
  const { fathom, meetingNotes } = heldOut;
  const ownDomain = domainOf({ address: account.toLowerCase() });
  const groups = [...byKey.values()]
    .map((members) => toGroup({ members, ownDomain, rules: policy.rules }))
    .toSorted((left, right) => compareGroups({ left, right }));
  return {
    account,
    complete,
    fathom,
    groups,
    inboxEstimate,
    meetingNotes,
    messagesRead: messages.length,
    passedInvites: passedInvites
      .toSorted((left, right) => compareNewest({ left: left.keyed.entry, right: right.keyed.entry }))
      .map(({ keyed, overAfterIso }) => ({
        id: keyed.entry.id,
        overAfterIso,
        sender: keyed.sender,
        // A passed invite's subject parsed, so it is present.
        subject: keyed.entry.subject!,
      })),
    readAtIso,
    replied: [...byRepliedThread.entries()]
      .map(([threadId, members]) => toRepliedThread({ members, threadId }))
      .toSorted((left, right) => left.threadId.localeCompare(right.threadId)),
    schemaVersion: GMAIL_TRIAGE_SCHEMA_VERSION,
    structuralRules: policy.structuralRules,
    unkeyed,
  };
}

/** Fold one replied thread's inbox members, newest first; `members` is non-empty by construction. */
function toRepliedThread({
  members,
  threadId,
}: {
  members: readonly KeyedMessage[];
  threadId: string;
}): GmailTriageRepliedThread {
  const ordered = members.toSorted((left, right) => compareNewest({ left: left.entry, right: right.entry }));
  return { ids: ordered.map((member) => member.entry.id), sender: ordered[0]!.sender, threadId };
}
