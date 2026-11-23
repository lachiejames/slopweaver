/**
 * Run one `read_card` or `open_card` call. `read_card` resolves the card and answers with it and every address it
 * links, opening nothing — what the voice calls for the card the owner already has open, a card read ahead and one
 * they said not to open. `open_card` resolves the same card, then puts it in front of them — the console on its
 * panel, its first published page as a new tab in their desktop app (never Chrome) and its Slack thread in their Slack
 * app — and answers with what each opening came to as well. It opens the card the call turns to before a word is said
 * about it, and any card the owner asks for (`../../lib/openCard.ts`).
 *
 * Every opening is attempted on its own: a console the shell could not move never stops the page, and a page the
 * verb refused never stops the thread. The page and the thread go through `browser_open`'s own verb route, so the
 * browser register and the published-page check hold here exactly as when the model calls it. Its own file so
 * `talkToolRun.ts` stays under the line cap; every effect is a seam, so a test passes plain fakes.
 *
 * Both calls READ every briefing the card links before answering, whatever opened (`./cardBriefingRead.ts`): the
 * owner expects that done without asking whenever a Queue card opens. A briefing that would not open comes back with the sentence the voice says instead, never left to the model.
 */
import type { ActPullState } from "../../lib/actPullVerb";
import { type AlignmentCards, actToolPlan, type CardToolPlan } from "../../lib/cardToolPlan";
import { withLookedUpPull } from "../../lib/queueActRow";
import type { QueueFocus } from "../../lib/queueFocus";
import { type QueueRow } from "../../lib/queueRows";
import type { RecentlyLeftCard } from "../../lib/recentQueueDepartures";
import { alreadyShownWhy } from "../../lib/slackThreadsShown";
import type { UnreadSource } from "../../lib/talkActionItems";
import { unreadClause } from "../../lib/unreadFit";
import type { VoicePartialFailure } from "../../lib/voiceFailureToast";
import { unreadAtEither, withRecordUnread } from "../../lib/voiceRecordQueue";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";
import { type ReadBriefing, readCardBriefings } from "./cardBriefingRead";
import { cardKeyOf, drawnCard, settledWhy } from "./drawnCard";
import {
  linksForVoice,
  type Opening,
  refusedOpening,
  refusedOpenings,
  removedFields,
  skippedOpening,
  withBriefings,
} from "./openCardAnswer";
import type { runVerbTool } from "./talkToolCalls";

export type { Opening } from "./openCardAnswer";

/** What moving the console to a card's panel came to. */
export type ConsolePresentation = { readonly kind: "opened" } | { readonly kind: "refused"; readonly why: string };

/** Every row the voice can open a card from, what did not load, and where the console is now. */
export interface VoiceCards {
  /** Every row the Queue draws, in both work contexts (`../../lib/talkActionItems.ts` `actionItemProjection`). */
  readonly rows: readonly QueueRow[];
  /** The workstreams lifted now (`../../lib/queueFocus.ts`), so a triage pass sections the rows as the Queue does. */
  readonly focuses: readonly QueueFocus[];
  /** The cards that recently left it, from the same projection — read marked removed, never opened. */
  readonly recentlyLeft: readonly RecentlyLeftCard[];
  /** The Alignment page's acts, resolved after the Queue's and never among them (`cardToolPlan`). */
  readonly alignment: AlignmentCards;
  readonly unread: readonly UnreadSource[];
  /** The console's path and query, as its address bar holds them. */
  readonly fromPath: string;
}

/** What `open_card` reaches. */
export interface OpenCardSeams {
  readonly cards: () => VoiceCards;
  /**
   * Why the console cannot be moved to a card the record holds, `undefined` when the screen draws it
   * (`../../lib/voiceRecordQueue.ts` `undrawnNowWhy`), asked at the move: moving it to a card it has not drawn opens a
   * panel on nothing.
   */
  readonly undrawnWhy: (input: { readonly key: string }) => Promise<string | undefined>;
  /**
   * Look up the pull request a finding act opened, as a card opened on its branch draws it once its read settles
   * (`../console/useActPull.ts` `readActPull`). Settles either way: a failed read is a `not-measured` answer.
   */
  readonly actLookup: (input: { readonly branch: string }) => Promise<ActPullState>;
  /** Whether the owner's `openCards` stage switch is on. Off, nothing opens and the card still comes back. */
  readonly openCardsOn: () => boolean;
  /** Move the console to one card's panel: this window in a browser, the console window in the desktop shell. */
  readonly presentConsole: (input: { readonly path: string }) => Promise<ConsolePresentation>;
  /** One verb tool's round trip — `browser_open` here. */
  readonly verb: typeof runVerbTool;
  /** One briefing's masked read, by slug (`./cardBriefingRead.ts` `fetchBriefing`). */
  readonly readBriefing: ReadBriefing;
}

/** What one `open_card` call came to. */
export interface OpenCardRan {
  readonly answer: unknown;
  readonly detail: string;
  readonly refused: boolean;
  /** Whether the answer hands the model third-party text — the card's words and the verb's — for the relay gate. */
  readonly readText: boolean;
  /**
   * Each opening that was attempted and refused. The call still answers with the card, so `refused` stays false, and
   * this is what tells the console window to say so (`../../lib/voiceFailureToast.ts`), since otherwise only the
   * voice knows a card opening was refused (five of five were).
   */
  readonly partialFailures: readonly VoicePartialFailure[];
  /**
   * The card on the owner's Queue the call resolved, and whether the console put it in front of them — what the Queue
   * walk steps on (`../../lib/cardWalk.ts`). Absent when it resolved none, or one that already left their Queue.
   */
  readonly walk?: { readonly cardKey: string; readonly opened: boolean };
}

/** Why nothing opened while the owner's switch is off, said the same way for every opening. */
export const SWITCHED_OFF = "the owner's openCards switch is off";

/**
 * One `browser_open` call's outcome, never a rejection: a thrown route is a refusal with its reason.
 *
 * @param verb the verb round trip
 * @param args `browser_open`'s arguments — exactly one of page or url
 * @returns what it came to
 */
async function presented({
  verb,
  args,
}: {
  verb: OpenCardSeams["verb"];
  args: Record<string, unknown>;
}): Promise<Opening> {
  try {
    const ran = await verb({ args, name: "browser_open" });
    if (ran.refused) {
      return refusedOpening({ why: ran.detail });
    }
    // A thread this call already put in front of the owner is not opened again (`./slackScreenVerb.ts`): skipped, never a toast.
    const already = alreadyShownWhy({ answer: ran.answer });
    if (already !== undefined) {
      return skippedOpening({ why: already });
    }
    return { outcome: "opened" };
  } catch (cause) {
    return refusedOpening({ why: cause instanceof Error ? cause.message : "browser_open failed" });
  }
}

/**
 * Move the console, never a rejection.
 *
 * @param seams what the call reaches
 * @param path the card's console address
 * @returns what it came to
 */
async function consoleOpening({ seams, path }: { seams: OpenCardSeams; path: string }): Promise<Opening> {
  try {
    const moved = await seams.presentConsole({ path });
    if (moved.kind === "refused") {
      return refusedOpening({ why: moved.why });
    }
    return { outcome: "opened" };
  } catch (cause) {
    return refusedOpening({ why: cause instanceof Error ? cause.message : "the console did not move" });
  }
}

/**
 * The card a call's `key` names, or the refusal the model hears instead — shared by `read_card` and `open_card`, so
 * the card one reads is the card the other would open.
 *
 * An Alignment act whose pull request the page looks up is read only once that lookup settles, then drawn from it as
 * the page draws it (`../console/AlignmentAct.tsx`): before it, the card is only the sentence
 * saying it has nothing to draw yet.
 *
 * @param args the model's arguments
 * @param seams the rows the card resolves against, and the act lookup
 * @returns the card's plan, or the refusal as the call's answer
 */
async function resolvedCard({
  args,
  seams,
}: {
  args: Record<string, unknown>;
  seams: Pick<OpenCardSeams, "actLookup" | "cards">;
}): Promise<{ readonly plan: CardToolPlan } | { readonly refusal: OpenCardRan }> {
  const named = cardKeyOf({ key: args["key"] });
  if (!("key" in named)) {
    return named;
  }
  const { key } = named;
  const first = seams.cards();
  const drawn = drawnCard({ cards: first, key });
  if (!("plan" in drawn)) {
    return drawn;
  }
  const branch = lookupBranchOf({ plan: drawn.plan });
  if (branch === undefined) {
    return drawn;
  }
  const lookup = await seams.actLookup({ branch });
  // The cards are read again once the lookup answers: an act settled while it waited is no longer drawn, so it is
  // never opened from the read taken before. A source unread at either read is named, since another
  // Queue call may have replaced the record while it waited.
  const later = seams.cards();
  const now = { ...later, unread: unreadAtEither({ after: later.unread, before: first.unread }) };
  const after = drawnCard({ cards: now, key });
  if (!("plan" in after) || lookupBranchOf({ plan: after.plan }) !== branch) {
    return after;
  }
  // The same branch proves the act is still drawn: `lookupBranchOf` answers one only for an act.
  const act = after.plan.act!;
  return { plan: actToolPlan({ fromPath: now.fromPath, row: withLookedUpPull({ lookup, row: act }) }) };
}

/**
 * The refusal to answer with once a card being opened was settled while an opening awaited, read afresh: the plan was
 * resolved before the awaits, and a press in another window can land during any of them. What
 * already opened stays opened and the answer says so, so the voice is never told the owner's screen did not move when it did;
 * the act itself is no longer offered as open. Nor is one the re-read no longer DRAWS — a held list gone partial, or
 * the handshake unheard, withholds every act, and a settle can sit in what that list left out.
 *
 * @param seams the cards, read now
 * @param keys the key the model named, and the row's own key it resolved to
 * @param openings what each opening came to before the settle was seen
 * @returns the refusal, or `undefined` while the act is still drawn and neither key is settled
 */
function settledSince({
  seams,
  keys,
  openings,
  slug,
}: {
  seams: Pick<OpenCardSeams, "cards">;
  keys: readonly string[];
  openings: { readonly card: Opening; readonly page: Opening; readonly thread: Opening };
  slug: string | undefined;
}): OpenCardRan | undefined {
  const { alignment, unread } = seams.cards();
  const hit = keys.find((key) => alignment.settled.includes(key));
  const key = keys.at(-1)!;
  let why: string;
  let detail: string;
  if (hit !== undefined) {
    why = settledWhy({ key: hit });
    detail = `${hit} settled while opening`;
  } else if (alignment.acts.some((row) => keys.includes(row.key))) {
    return undefined;
  } else {
    why = `${key} is no longer drawn as open since it was opened; still unread: ${unreadClause({ unread })}`;
    detail = `${key} undrawn while opening`;
  }
  const { card, page, thread } = openings;
  const answer = { opened: { card, page: { ...page, slug }, thread }, refused: why };
  return {
    // A settle names the sources unread beside it; the undrawn sentence already words them.
    answer: hit === undefined ? answer : withRecordUnread({ answer, capBytes: TOOL_OUTPUT_MAX, unread }),
    detail,
    partialFailures: refusedOpenings({ cardKey: key, openings }),
    readText: false,
    refused: true,
  };
}

/**
 * The branch a finding act's pull request is looked up by, `undefined` for every other card.
 *
 * @param plan the resolved card
 * @returns the branch to look up
 */
function lookupBranchOf({ plan }: { plan: CardToolPlan }): string | undefined {
  const act = plan.act;
  if (act?.record.kind !== "act") {
    return undefined;
  }
  return act.record.lookupBranch;
}

/** A card's answer with its briefings attached, the failures among them, and the log's word on them. */
interface Briefed {
  readonly answer: unknown;
  readonly failures: readonly VoicePartialFailure[];
  readonly said: string;
}

/**
 * A resolved card's answer with every briefing it links read and attached (`./openCardAnswer.ts` `withBriefings`).
 *
 * @param answer the card's answer before its briefings
 * @param plan the resolved card
 * @param read every briefing the card links, as read
 * @returns the answer, the briefing failures, and the log's word on them — empty on a card linking none
 */
function briefed({
  answer,
  plan,
  read,
}: {
  answer: Readonly<Record<string, unknown>>;
  plan: CardToolPlan;
  read: Awaited<ReturnType<typeof readCardBriefings>>;
}): Briefed {
  const fitted = withBriefings({ answer, briefings: read, cardKey: plan.key });
  if (read.length === 0) {
    return { ...fitted, said: "" };
  }
  const whole = fitted.answer.briefings.filter((briefing) => briefing.read === true).length;
  return { ...fitted, said: `, briefings ${String(whole)}/${String(read.length)} read whole` };
}

/**
 * Run one `read_card` call: the card, every address it links and every briefing it links already read, with NOTHING
 * opened — the card the owner already has open, one read ahead in a walk, one they said not to open — so it has no
 * seam that moves their screen.
 *
 * @param args the model's arguments
 * @param seams the rows, the act lookup and the briefing read
 * @returns the answer, the log line, and how the relay gate counts it
 */
export async function runReadCard({
  args,
  seams,
}: {
  args: Record<string, unknown>;
  seams: Pick<OpenCardSeams, "actLookup" | "cards" | "readBriefing">;
}): Promise<OpenCardRan> {
  const resolved = await resolvedCard({ args, seams });
  if ("refusal" in resolved) {
    return resolved.refusal;
  }
  const { plan } = resolved;
  const { card, key, links, page, removed } = plan;
  const files = links.briefingFiles;
  const read = await readCardBriefings({ files, readBriefing: seams.readBriefing, slugs: links.briefings });
  const unbriefed = { card, links: linksForVoice({ links }), ...removedFields({ removed }) };
  const { answer, failures, said } = briefed({ answer: unbriefed, plan, read });
  // Counted as a read: the card's own words are third-party text.
  const ran: OpenCardRan = {
    answer,
    detail: `${key}, read${removed === undefined ? "" : " (off the owner's Queue)"}${said}`,
    partialFailures: failures,
    readText: true,
    refused: false,
  };
  // Only a card still on the owner's Queue is in the Queue walk (`../../lib/cardToolPlan.ts` `page`).
  if (removed !== undefined || page !== "queue") {
    return ran;
  }
  return { ...ran, walk: { cardKey: key, opened: false } };
}

/**
 * Run one `open_card` call — the card the call turns to, before a word on it, or on the owner's ask (`read_card` is the read).
 *
 * @param args the model's arguments
 * @param seams what the call reaches
 * @returns the answer, the log line, and how the relay gate counts it
 */
export async function runOpenCard({
  args,
  seams,
}: {
  args: Record<string, unknown>;
  seams: OpenCardSeams;
}): Promise<OpenCardRan> {
  const resolved = await resolvedCard({ args, seams });
  if ("refusal" in resolved) {
    return resolved.refusal;
  }
  const { plan } = resolved;
  const { firstPage, key, links, path, removed } = plan;
  // Read while the openings run: neither waits on the other, and a briefing that will not open never stops one.
  const files = links.briefingFiles;
  const reading = readCardBriefings({ files, readBriefing: seams.readBriefing, slugs: links.briefings });
  if (removed !== undefined) {
    // No Queue panel draws a card that left it, so nothing on the owner's screen moves: the card is read, marked removed.
    const off: Opening = { outcome: "skipped", why: `${key} left the owner's Queue at ${removed.atIso}` };
    const unbriefed = {
      card: plan.card,
      links: linksForVoice({ links }),
      opened: { card: off, page: { ...off, slug: firstPage?.slug }, thread: off },
      ...removedFields({ removed }),
    };
    const { answer, failures, said } = briefed({ answer: unbriefed, plan, read: await reading });
    const detail = `${key}, off the owner's Queue, nothing opened${said}`;
    return { answer, detail, partialFailures: failures, readText: true, refused: false };
  }
  const on = seams.openCardsOn();
  const skipped: Opening = { outcome: "skipped", why: SWITCHED_OFF };
  let card: Opening = skipped;
  let page: Opening = { outcome: "none" };
  let thread: Opening = { outcome: "none" };
  const keys = [String(args["key"]), key];
  // A card the record holds and the screen has not drawn is read, and the console is not moved to it, so the walk and the triage clock never count it as in front of the owner.
  const undrawn = await seams.undrawnWhy({ key });
  if (on && undrawn !== undefined) {
    card = skippedOpening({ why: undrawn });
  } else if (on) {
    card = await consoleOpening({ path, seams });
  }
  // One after the other: two presents at once would race for the front of the owner's screen.
  if (firstPage !== undefined) {
    page = on ? await presented({ args: { page: firstPage.slug }, verb: seams.verb }) : skipped;
  }
  if (links.threadUrl !== undefined) {
    thread = on ? await presented({ args: { url: links.threadUrl }, verb: seams.verb }) : skipped;
  }
  const openings = { card, page, thread };
  const settled = plan.act === undefined ? undefined : settledSince({ keys, openings, seams, slug: firstPage?.slug });
  if (settled !== undefined) {
    return settled;
  }
  const unbriefed = {
    card: plan.card,
    links: linksForVoice({ links }),
    opened: { card, page: { ...page, slug: firstPage?.slug }, thread },
  };
  const { answer, failures, said } = briefed({ answer: unbriefed, plan, read: await reading });
  const parts = [key, `card ${card.outcome}`, `page ${page.outcome}`, `thread ${thread.outcome}`];
  const detail = `${parts.join(", ")}${said}`;
  const partialFailures = [...refusedOpenings({ cardKey: key, openings }), ...failures];
  // Counted as a read however the openings went: the card's own words and the verb's output are third-party text.
  const ran: OpenCardRan = { answer, detail, partialFailures, readText: true, refused: false };
  if (plan.page !== "queue") {
    return ran;
  }
  return { ...ran, walk: { cardKey: key, opened: card.outcome === "opened" } };
}
