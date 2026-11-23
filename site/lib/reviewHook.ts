/**
 * Who a pull request is waiting on, as the pull-request page draws it: the ask line in every row's summary,
 * and the whole ask trail in its fold.
 *
 * Every pull request says, prominently, who was asked, where, when, how
 * long ago, and whether to ask again. Every fact here is one `github landing` already printed — the trail's
 * recipients are the classifier's, scoped to THIS pull request, and its first recipient is exactly the
 * person the bump verdict judged — so this module only chooses the words. It never decides somebody was
 * asked, and it never says "nobody asked" unless the verb itself answered `no`: an older reading, or a Slack
 * window that could not carry an absence, reads as not known rather than as a confident nobody.
 *
 * Pure. The clock is a seam: the caller passes `ago`, the page's own age wording.
 */
import type { LandingAsk, LandingBump, LandingRow, LandingShare } from "../components/live/readLanding";
import type { SemanticTone } from "./consoleTone";
import { type PersonLabel, personLabel, type SlackPeople } from "./slackPeople";

/** How long ago an instant was, in the page's own wording (`26.1h ago`). */
export type AgoWords = (iso: string) => string;

/** The whether-to-ask-again chip beside an ask line. */
export interface AgainChip {
  readonly tone: SemanticTone;
  readonly text: string;
  /** The verb's own sentence behind the chip, drawn on hover. */
  readonly title: string;
}

/** The ask line one row's summary draws. */
export interface AskLine {
  /**
   * `asked` names people; `shared` is the owner's post to a channel with nobody named (the third state),
   * drawn as its clock's badge with {@link AskLine.note} under it; the other three say why nobody is named.
   */
  readonly kind: "asked" | "shared" | "not-due" | "nobody-asked" | "unknown";
  /** Who the newest ask asked, as labels — empty unless `kind` is `asked`. */
  readonly who: readonly PersonLabel[];
  /** The sentence after the names: where, and how long ago — or the whole sentence when nobody is named. */
  readonly text: string;
  /** The newest ask's own message, when there is one to open. */
  readonly permalink: string | undefined;
  /** Whether to ask again, when the verb judged it. */
  readonly again: AgainChip | undefined;
  /**
   * The messages the verb could not settle as an ask or not, lifted out of its sentence so the line draws
   * them as numbered links rather than a wall of URLs — empty unless `kind` is `unknown`.
   */
  readonly unsettled: readonly string[];
  /** The one line under a `shared` badge: why the clock reads that colour. `undefined` on every other kind. */
  readonly note: string | undefined;
}

/** One entry of the trail as the fold lists it. */
export interface TrailLine {
  readonly key: string;
  readonly who: readonly PersonLabel[];
  readonly text: string;
  readonly permalink: string;
}

/**
 * Where an ask was posted, as a phrase: `in #dev-alerts`, or `by direct message`.
 *
 * @returns the phrase
 */
function whereOf({ ask }: { ask: LandingAsk }): string {
  if (ask.isDirectMessage) {
    return "by direct message";
  }
  return `in ${ask.channel}`;
}

/**
 * The chip for the verb's bump verdict. A due chase is the one loud state: somebody was asked and has been
 * silent past the bar, so the page says to ask again and since when.
 *
 * @returns the chip, or `undefined` when the reading carries no verdict
 */
function againOf({ bump, ago }: { bump: LandingBump | undefined; ago: AgoWords }): AgainChip | undefined {
  if (bump === undefined) {
    return undefined;
  }
  switch (bump.kind) {
    case "due":
      return {
        text: `ask again: silent since ${ago(bump.silentSinceIso)}`,
        title: `no reply since the ask, and past the bar since ${bump.eligibleSinceIso}`,
        tone: "danger",
      };
    case "too-soon":
      return { text: "too soon to ask again", title: bump.why, tone: "neutral" };
    case "replied":
      return { text: "they replied", title: bump.why, tone: "success" };
    case "unknown":
      return { text: "ask again: not known", title: bump.why, tone: "warning" };
    default: {
      const never: never = bump;
      return never;
    }
  }
}

/** A URL inside the verb's sentence. */
const URL_PATTERN = /https?:\/\/\S+/gu;

/**
 * The verb's reason, split into its sentence and the message links it carried. The sentence loses the
 * colon that introduced the links, so it still reads as one.
 *
 * @returns the sentence and the links, in the order the verb wrote them
 */
function splitWhy({ why }: { why: string }): { sentence: string; links: readonly string[] } {
  const links = why.match(URL_PATTERN);
  if (links === null) {
    return { links: [], sentence: why };
  }
  const sentence = why.replace(URL_PATTERN, "").replace(/\s+/gu, " ").trim().replace(/[:,]$/u, "");
  return { links, sentence };
}

/** The clock's colour as the page's tone: the owner's green, yellow and red, and a neutral for a clock not known. */
const SHARE_TONE: Record<LandingShare["tone"], SemanticTone> = {
  green: "success",
  red: "danger",
  unknown: "neutral",
  yellow: "warning",
};

/**
 * The third state: posted to a channel, nobody named. The badge is the clock, the line under it says why, and
 * the post itself is the citation.
 *
 * @returns the line
 */
function sharedLine({ share, ago }: { share: LandingShare; ago: AgoWords }): AskLine {
  // Every colour but "in conversation" rests on an absence — no ask, no reply — each carried as far as its own read.
  const asOf = `${share.asOfIso.slice(0, 10)} ${share.asOfIso.slice(11, 16)}Z`;
  const title = `the business-day clock on the post in ${share.channel}, read as of ${asOf}: ${share.seen}`;
  let replies = "";
  if (share.replies > 0) {
    replies = ` · ${String(share.replies)} ${share.replies === 1 ? "reply" : "replies"}`;
  }
  return {
    again: { text: share.badge, title, tone: SHARE_TONE[share.tone] },
    kind: "shared",
    note: share.why,
    permalink: share.permalink,
    text: `shared in ${share.channel} ${ago(share.postedAtIso)}, no reviewer named${replies}`,
    unsettled: [],
    who: [],
  };
}

/**
 * The line when nobody is named: why, in the verb's own terms.
 *
 * @returns the line
 */
function unnamedLine({ row, ago }: { row: LandingRow; ago: AgoWords }): AskLine {
  const unnamed = { again: undefined, note: undefined, permalink: undefined, unsettled: [], who: [] };
  if (row.draft) {
    return { ...unnamed, kind: "not-due", text: "a draft: nobody is asked until it is ready" };
  }
  if (row.stacked) {
    return { ...unnamed, kind: "not-due", text: "stacked: nobody is asked until its base lands" };
  }
  if (row.channelShare !== undefined) {
    return sharedLine({ ago, share: row.channelShare });
  }
  if (row.askTrail === undefined) {
    return { ...unnamed, kind: "unknown", text: "who was asked is not in this reading; it predates the ask trail" };
  }
  if (row.slackAsked === "no") {
    return { ...unnamed, kind: "nobody-asked", text: "nobody asked in Slack yet" };
  }
  let why: { sentence: string; links: readonly string[] } = { links: [], sentence: "the verb did not say why" };
  if (row.slackWhy !== undefined && row.slackWhy.trim() !== "") {
    why = splitWhy({ why: row.slackWhy });
  }
  return { ...unnamed, kind: "unknown", text: `not known who was asked: ${why.sentence}`, unsettled: why.links };
}

/**
 * The ask line for one row: the newest ask's people, where and how long ago, with whether to ask again.
 *
 * A draft or a stacked row reads as not due before its trail is consulted — nobody is chased on either —
 * and the fold still lists any ask it carries.
 *
 * @param people the names the reading resolved for each Slack id
 * @param ago how the page words an age
 * @returns the line
 */
export function askLineOf({ row, people, ago }: { row: LandingRow; people: SlackPeople; ago: AgoWords }): AskLine {
  const newest = row.askTrail?.[0];
  if (row.draft || row.stacked || newest === undefined) {
    return unnamedLine({ ago, row });
  }
  const trailSize = row.askTrail?.length;
  let more = "";
  if (trailSize !== undefined && trailSize > 1) {
    more = ` · ${String(trailSize)} asks in all`;
  }
  return {
    again: againOf({ ago, bump: row.bump }),
    kind: "asked",
    note: undefined,
    permalink: newest.permalink,
    text: `${whereOf({ ask: newest })} ${ago(newest.atIso)}${more}`,
    unsettled: [],
    who: newest.recipients.map((id) => personLabel({ id, people })),
  };
}

/**
 * Every ask on one row, newest first, as the fold lists them — each with its own message to open.
 *
 * @param people the names the reading resolved for each Slack id
 * @param ago how the page words an age
 * @returns one line per ask; empty when there is no trail, which the caller words from {@link askLineOf}
 */
export function trailLinesOf({
  row,
  people,
  ago,
}: {
  row: LandingRow;
  people: SlackPeople;
  ago: AgoWords;
}): readonly TrailLine[] {
  if (row.askTrail === undefined) {
    return [];
  }
  return row.askTrail.map((ask) => ({
    key: ask.messageKey,
    permalink: ask.permalink,
    text: `${whereOf({ ask })} ${ago(ask.atIso)} · ${ask.atIso.slice(0, 16).replace("T", " ")}Z`,
    who: ask.recipients.map((id) => personLabel({ id, people })),
  }));
}

/** A row's wait as the page draws it: the next-act word and its sentence. */
export interface DrawnWait {
  readonly next: string;
  readonly sentence: string;
  /** The Slack watermark behind a `sync-slack` wait, absent on any other act — a pick included. */
  readonly slackThroughIso: string | undefined;
  /**
   * Who the owner picked, when a pick they approved superseded the verb's wait: that `ask` means asking this person
   * for a review, never opening a discussion, which the verb's own `ask` leaves open.
   */
  readonly pickedReviewer: string | undefined;
}

/**
 * The wait a row draws: the verb's own, unless a pick the owner approved supersedes it.
 *
 * `github landing` never reads the reviewer register, so after the owner approves a suggested reviewer its wait keeps
 * saying the act is naming one — "only your word is missing" — until a reading sees the ask. A pick newer than
 * every ask is exactly what the reviewer reading's `picked` hook means, and with one standing, the act is to ask
 * the person picked. Drawing the verb's sentence beside "you picked Bob" would be the row contradicting itself.
 *
 * @param picked who the owner picked, while the reviewer reading's hook on this row is `picked`
 * @param people the names the reading resolved for each Slack id
 * @returns the wait to draw, or `undefined` when the row is not waiting on a human
 */
export function drawnWaitOf({
  row,
  picked,
  people,
}: {
  row: LandingRow;
  picked: { readonly reviewer: string } | undefined;
  people: SlackPeople;
}): DrawnWait | undefined {
  const wait = row.humanWait;
  if (wait === undefined) {
    return undefined;
  }
  if (picked === undefined) {
    return {
      next: wait.next,
      pickedReviewer: undefined,
      sentence: wait.sentence,
      slackThroughIso: wait.slackThroughIso,
    };
  }
  const name = personLabel({ id: picked.reviewer, people }).text;
  return {
    next: "ask",
    pickedReviewer: name,
    sentence: `you picked ${name}; no ask to them is seen since the pick; your queue holds any ask waiting on your yes`,
    slackThroughIso: undefined,
  };
}

/**
 * The machine word behind a pull request's state — on the hover of its pull-requests page row and of a citation
 * chip's state tag alike, the state itself said by `./prPlainState.ts`: a human wait's next act, else the dispatch
 * verdict when the verb issued one, else the action.
 *
 * All three are the verb's words, most specific first. `name-the-reviewer` says more than `blocked-on`, and
 * the one `DispatchVerdict` the supervisor cards rather than dispatches (`src/review/landingDispatch.ts`) more than
 * `conflicting`.
 *
 * @param wait the row's human wait as {@link drawnWaitOf} draws it, joined with any reviewer pick
 * @returns the tag text
 */
export function tagOf({ row, wait }: { row: LandingRow; wait: DrawnWait | undefined }): string {
  // A row waiting on a human names the ONE act its wait needs, never the bare `blocked-on`.
  if (wait !== undefined) {
    return wait.next;
  }
  if (row.verdict !== undefined) {
    return row.verdict;
  }
  return row.action;
}

/**
 * Whether the page holds its reviewer suggestion back on this row: while a post to a channel with nobody named
 * has not reached red, the channel has it. The suggestion appears once the clock is red, and a suggestion drawn from the first minute would contradict the badge beside it. An `unknown`
 * clock holds it too: that tone refuses to say nobody replied, and a suggestion would act on exactly that.
 *
 * @returns true while the channel's clock has not reached red
 */
export function suggestionHeld({ row }: { row: LandingRow }): boolean {
  const share = row.channelShare;
  return share !== undefined && share.tone !== "red";
}
