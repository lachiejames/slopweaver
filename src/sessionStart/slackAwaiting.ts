/**
 * The threads awaiting somebody else — a thread the owner spoke in whose last HUMAN word is theirs, that asked for a
 * reply, and that has had none for at least two business days ({@link CHASE_QUIET_MS}). The inverse of
 * {@link ./slackLeg.slackOwedThreads}.
 *
 * The rule: a thread with no reply is chased by tagging some specific people and asking specific
 * questions to drive engagement, and the drafts for that show across all workstreams via the queue, because
 * the owner's goal is to keep advancing workstreams and avoid letting them slip unless that is intentional.
 * This module only SELECTS; the chase is drafted in a visible seated session and parked
 * for the owner's yes (`skills/automation/reference/thread-chase.md`).
 *
 * ## Four choices, each the reason a thread is or is not listed
 *
 * - **The last HUMAN word.** A bot, an app or Slopweaver itself posting after the owner's question answers nothing, so
 *   an author that is not a person never ends the wait. A person's tick, thumbs-up or OK REACTION on any message
 *   of the owner's run does; a 👀 does not.
 * - **The owner's trailing run, not their last message.** "question?" then "also, one more thing" is one ask; every
 *   message of the owner's after the latest other person's word is judged, however long the run.
 * - **The AUTHORED text.** The projection resolves a mention run to a display name
 *   (`../cli/commands/sessionStart/slackRow.ts`'s `authoredText`), and the row's 140-character quote cuts off a
 *   late `?`.
 * - **A direct message is not judged, nor a group DM.** A thread key is `channel:rootTs`, and a DM answer is
 *   usually a new top-level message with its own key, so every DM question would read as unanswered. It is
 *   counted instead. A group DM carries a `C…` id, so it is told by Slack's own `mpdm-` name.
 *
 * The clock is business time (`../review/businessTime.ts`), the owner's rule that nobody is expected to reply at
 * a weekend. An instant it cannot read is `undated`, never zero.
 *
 * Pure — no I/O, no clock. `nowIso` is supplied so a frozen fixture judges its own time.
 */

import { BUSINESS_DAY_MS, businessMsBetween } from "../review/businessTime.js";
import type { PrLinkRef } from "../review/prLink.js";
import { mentionRunsIn } from "../review/prLink.js";

/**
 * How long a thread stays quiet on the owner's ask before it is a chase: two business days, a MINIMUM — the weekday
 * 09:30 firing can list it up to a day later than that.
 *
 * The first rule said ">24hrs"; what the owner did with the drafts says two days, and that wins. A chase parked
 * 25.5 business hours after the owner's own ask was dropped as not yet long enough to bump anybody in the thread;
 * one parked about 1.2 business days after an earlier bump was dropped; and two more were held until the thread
 * had been quiet two days from the owner's post. Every chase the owner released without
 * naming its people themselves had sat two business days or more. Re-measure:
 * `slopweaver slack draft list --all --json | jq '.items[] | select(.draft.why // "" | test("chase"))'`.
 *
 * The finding follow-up (`./findingFollowups.ts`) and the review-chase bump (`../review/humanWait.ts`) stay on
 * one business day: each is its own ruling, and neither is what the owner dropped.
 */
const CHASE_QUIET_MS = 2 * BUSINESS_DAY_MS;

/** Slack's link, mention and broadcast runs — `<https://x?y|label>`, `<@U…>`, `<!here>` — whose `?` asks nothing. */
const SLACK_RUN = /<[^<>]*>/g;

/** A fenced code block, whose `?` is code rather than a question. */
const FENCED_CODE = /```[^`]*```/g;

/** An inline code span. */
const INLINE_CODE = /`[^`\n]*`/g;

/** What one message of the owner's asks of anybody. */
export interface ReplyAsk {
  /** A `?` outside every link, mention and code span. */
  readonly asksQuestion: boolean;
  /** The PEOPLE it tags, never the owner and never Slopweaver, in the order written, each once. */
  readonly taggedIds: readonly string[];
  /** Whether it tags a user group or broadcasts to the room (`<!here>`, `<!channel>`). */
  readonly tagsGroup: boolean;
}

/**
 * What one message of the owner's asks, read off the text they typed.
 *
 * @param authoredText the message's own authored text, mention runs intact
 * @param ownerId the owner's own Slack id, which is never somebody they are waiting on
 * @param selfIds Slopweaver's own bot ids, which never answer for anybody
 * @returns the three signals, kept apart so a reader can see which one fired
 */
export function replyAskOf({
  authoredText,
  ownerId,
  selfIds,
}: {
  authoredText: string;
  ownerId: string;
  selfIds: ReadonlySet<string>;
}): ReplyAsk {
  const prose = authoredText.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ").replace(SLACK_RUN, " ");
  const taggedIds: string[] = [];
  let tagsGroup = authoredText.includes("<!here") || authoredText.includes("<!channel");
  for (const run of mentionRunsIn({ text: authoredText })) {
    if (run.id.startsWith("S")) {
      tagsGroup = true;
      continue;
    }
    if (run.id !== ownerId && !selfIds.has(run.id) && !taggedIds.includes(run.id)) {
      taggedIds.push(run.id);
    }
  }
  return { asksQuestion: prose.includes("?"), taggedIds, tagsGroup };
}

/**
 * Whether one message wants an answer from somebody: it asks something, or it names who should act.
 *
 * A tag of somebody who has ALREADY spoken in the thread asks nothing on its own: "thanks <@alice>" after her
 * answer is a closer, and only a `?` beside it makes it a new ask.
 *
 * @param ask the message's signals
 * @param spokeIds the people who have already spoken in the thread
 * @returns true when it asks a question, tags a group, or tags somebody who has not yet spoken there
 */
export function expectsReply({ ask, spokeIds }: { ask: ReplyAsk; spokeIds: ReadonlySet<string> }): boolean {
  return ask.asksQuestion || ask.tagsGroup || ask.taggedIds.some((id) => !spokeIds.has(id));
}

/** Slack's own name for a group DM (`mpdm-a--b--c-1`), which carries a `C…` id and so needs its name to tell. */
const GROUP_DM_NAME = /^#?mpdm-/;

/** One message of the owner's in a thread, as the selection needs it. */
export interface SlackOwnerWord {
  readonly tsIso: string;
  /** Slack's own `ts` for the message, the tiebreak `tsIso`'s second resolution needs. */
  readonly ownTs: number;
  readonly permalink: string;
  /** The message's projected text, trimmed for display only — never what {@link ReplyAsk} was read from. */
  readonly quote: string;
  readonly ask: ReplyAsk;
  readonly pullRequests: readonly PrLinkRef[];
  /** The PEOPLE who answered it with a tick, thumbs-up or OK reaction, never the owner and never a bot. */
  readonly reactedBy: readonly string[];
}

/** Somebody in the thread other than the owner: an author, or a person the owner's last words tagged. */
export interface SlackThreadPerson {
  readonly id: string;
  readonly name: string;
  /** When they last spoke in the thread; absent for somebody the owner tagged who has never spoken there. */
  readonly lastIso?: string;
  readonly lastOwnTs?: number;
  /** Whether their word counts as an answer — the `authorIsHuman` test every Slack detector shares. */
  readonly isHuman: boolean;
  /** Whether a chase may tag them: a person the members index knows, still active, not the owner, not a bot. */
  readonly taggable: boolean;
}

/** One thread the owner spoke in, with everything the selection reads. */
export interface SlackAwaitingCandidate {
  readonly channelId: string;
  readonly channelName?: string;
  readonly threadTs: string;
  /** Whether anybody replied in the thread at all — false is a channel root nobody threaded under. */
  readonly hasReplies: boolean;
  /** Every message of the owner's in the thread, oldest first — never a tail, which loses a long run's ask. */
  readonly ownerWords: readonly SlackOwnerWord[];
  /** Every other author, and every person the owner's messages tagged. */
  readonly people: readonly SlackThreadPerson[];
}

/** Why one thread is, or is not, awaiting somebody. */
export type AwaitingVerdict =
  | { readonly kind: "answered" }
  | { readonly kind: "awaiting"; readonly businessMs: number; readonly run: readonly SlackOwnerWord[] }
  | { readonly kind: "direct-message" }
  | { readonly kind: "inside-chase-wait"; readonly businessMs: number }
  | { readonly kind: "no-ask" }
  | { readonly kind: "undated" };

/**
 * Whether one instant is later in a thread than another, by `tsIso` and then Slack's own `ts` — the rule
 * `../cli/commands/sessionStart/slackRow.ts`'s `isLaterThan` applies to a whole row.
 *
 * @param candidate the instant being considered
 * @param held the instant it is compared against
 * @returns whether the candidate is strictly later
 */
function laterThan({
  candidate,
  held,
}: {
  candidate: { readonly tsIso: string; readonly ownTs: number };
  held: { readonly tsIso: string; readonly ownTs: number };
}): boolean {
  if (candidate.tsIso !== held.tsIso) {
    return candidate.tsIso > held.tsIso;
  }
  if (Number.isNaN(candidate.ownTs) || Number.isNaN(held.ownTs)) {
    return false;
  }
  return candidate.ownTs > held.ownTs;
}

/**
 * The latest word any other PERSON spoke in the thread, or undefined when no person but the owner ever did.
 *
 * @param people the thread's other people
 * @returns that word's instant
 */
function latestOtherHumanWord({
  people,
}: {
  people: readonly SlackThreadPerson[];
}): { readonly tsIso: string; readonly ownTs: number } | undefined {
  let latest: { readonly tsIso: string; readonly ownTs: number } | undefined;
  for (const person of people) {
    if (!person.isHuman || person.lastIso === undefined || person.lastOwnTs === undefined) {
      continue;
    }
    const word = { ownTs: person.lastOwnTs, tsIso: person.lastIso };
    if (latest === undefined || laterThan({ candidate: word, held: latest })) {
      latest = word;
    }
  }
  return latest;
}

/**
 * The people the owner's trailing run is answering: whoever spoke after the owner's previous word, or — when they never spoke before
 * the run — whoever spoke last. A tag of one of them is a thanks, not an ask; a tag of anybody else, including
 * somebody who spoke long before, still asks. The owner's first word
 * in a thread is the one case this cannot tell: "nice one @bob" after Alice spoke last is kept, because the same
 * shape is "@bob please verify", and a chase the seat drops costs less than an ask that slips.
 *
 * @param people the thread's other people
 * @param answeredAt the latest other person's word, where the owner's run begins
 * @param ownerWords every message of the owner's in the thread
 * @returns their ids
 */
function answeredSince({
  people,
  answeredAt,
  ownerWords,
}: {
  people: readonly SlackThreadPerson[];
  answeredAt: { readonly tsIso: string; readonly ownTs: number };
  ownerWords: readonly SlackOwnerWord[];
}): ReadonlySet<string> {
  let before: { readonly tsIso: string; readonly ownTs: number } | undefined;
  for (const spoke of ownerWords) {
    const earlier = laterThan({ candidate: answeredAt, held: spoke });
    if (earlier && (before === undefined || laterThan({ candidate: spoke, held: before }))) {
      before = spoke;
    }
  }
  const ids = new Set<string>();
  for (const person of people) {
    if (!person.isHuman || person.lastIso === undefined || person.lastOwnTs === undefined) {
      continue;
    }
    const word = { ownTs: person.lastOwnTs, tsIso: person.lastIso };
    const since =
      before === undefined
        ? !laterThan({ candidate: answeredAt, held: word })
        : laterThan({ candidate: word, held: before });
    if (since) {
      ids.add(person.id);
    }
  }
  return ids;
}

/**
 * Why one thread is, or is not, awaiting somebody.
 *
 * @param candidate the thread to judge
 * @param nowIso the run's own instant
 * @returns the verdict, carrying the owner's trailing run and the business time since its last message when awaiting
 */
export function awaitingVerdictOf({
  candidate,
  nowIso,
}: {
  candidate: SlackAwaitingCandidate;
  nowIso: string;
}): AwaitingVerdict {
  const groupDm = candidate.channelName !== undefined && GROUP_DM_NAME.test(candidate.channelName);
  if (candidate.channelId.startsWith("D") || groupDm) {
    return { kind: "direct-message" };
  }
  const answeredAt = latestOtherHumanWord({ people: candidate.people });
  const run = candidate.ownerWords.filter(
    (word) => answeredAt === undefined || laterThan({ candidate: word, held: answeredAt }),
  );
  const last = run.at(-1);
  if (last === undefined || run.some((word) => word.reactedBy.length > 0)) {
    return { kind: "answered" };
  }
  const spokeIds: ReadonlySet<string> =
    answeredAt === undefined
      ? new Set()
      : answeredSince({ answeredAt, ownerWords: candidate.ownerWords, people: candidate.people });
  if (!run.some((word) => expectsReply({ ask: word.ask, spokeIds }))) {
    return { kind: "no-ask" };
  }
  const businessMs = businessMsBetween({ fromIso: last.tsIso, toIso: nowIso });
  if (businessMs === undefined) {
    return { kind: "undated" };
  }
  if (businessMs < CHASE_QUIET_MS) {
    return { businessMs, kind: "inside-chase-wait" };
  }
  return { businessMs, kind: "awaiting", run };
}

/** One thread the selection kept, beside its trailing run and how long it has been quiet. */
export interface SlackAwaitingThread {
  readonly candidate: SlackAwaitingCandidate;
  readonly run: readonly SlackOwnerWord[];
  readonly businessMs: number;
}

/**
 * Every thread awaiting somebody past {@link CHASE_QUIET_MS}, and a tally of why each other thread was not.
 *
 * @param candidates every thread the owner spoke in, in any order
 * @param nowIso the run's own instant
 * @returns the kept threads in the order given, and one count per verdict kind
 */
export function slackAwaitingThreads({
  candidates,
  nowIso,
}: {
  candidates: readonly SlackAwaitingCandidate[];
  nowIso: string;
}): {
  readonly awaiting: readonly SlackAwaitingThread[];
  readonly tally: Readonly<Record<AwaitingVerdict["kind"], number>>;
} {
  const tally: Record<AwaitingVerdict["kind"], number> = {
    answered: 0,
    awaiting: 0,
    "direct-message": 0,
    "inside-chase-wait": 0,
    "no-ask": 0,
    undated: 0,
  };
  const awaiting: SlackAwaitingThread[] = [];
  for (const candidate of candidates) {
    const verdict = awaitingVerdictOf({ candidate, nowIso });
    tally[verdict.kind] += 1;
    if (verdict.kind === "awaiting") {
      awaiting.push({ businessMs: verdict.businessMs, candidate, run: verdict.run });
    }
  }
  return { awaiting, tally };
}
