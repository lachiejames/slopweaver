/**
 * The conversation as the stage draws it: one stream of speech, the history on the right, where a turn still being
 * said sits at the bottom looking unfinished. There is no live caption reading it a second time under the orb: the
 * history is the one place to look, and a second copy is clutter.
 *
 * A message that reads as already sent while it is being rewritten every second misleads, and what the owner is
 * saying now and what the voice is saying now want a different visual treatment. So every shown stretch of speech
 * carries whether its turn is done (`final`, from `talkPlanEvents.ts`'s fold), and an unfinished one is never drawn as
 * a sent bubble.
 *
 * A history holding only finished turns hides the owner's most recent words. So the history carries every turn,
 * finished or not, and while the owner is heard before any of their words are recognised it shows a typing indicator
 * (`speakingIndicatorShows`).
 */

/** One stretch of speech as it was last heard, and whether its turn is done. */
export interface HeardSegment {
  readonly id: string;
  readonly who: "owner" | "voice";
  readonly text: string;
  /** `false` while the turn is still being said and its text may still change; `true` once it is done. */
  readonly final: boolean;
}

/**
 * How many turns the stage's history keeps, and so the orb messenger's; `talk thread` has the rest. A live turn older
 * than these is drawn in the earlier history instead (`liveWindowOf`, `site/lib/chatThreadCarried.ts`).
 */
export const SHOWN_SEGMENTS = 40;

/** The conversation as the stage's history draws it. */
export interface StageConversation {
  /** The newest `kept` turns, finished or not, oldest first: the history. */
  readonly history: readonly HeardSegment[];
}

/**
 * A stretch of speech as the stage shows it: its id is the call's own id joined to the segment's, because a reconnect
 * keeps what the dropped call showed while segment ids repeat across calls (`transcriptSink.ts`), so a bare id would
 * let a new call's turn overwrite an old one in place and take its row.
 *
 * @param call the call that heard it
 * @param speech the stretch as heard, its id the call's own
 * @param final whether its turn is done
 * @returns the segment to show
 */
export function shownSegmentOf({
  call,
  speech,
  final,
}: {
  call: string;
  speech: Omit<HeardSegment, "final">;
  final: boolean;
}): HeardSegment {
  return { final, id: `${call}:${speech.id}`, text: speech.text, who: speech.who };
}

/**
 * The shown segments with one more heard: a stretch already shown is replaced where it stands, its text grown or
 * finished; a new one joins the end and the oldest falls off past `kept`.
 *
 * @param held the segments shown now
 * @param heard the stretch just heard
 * @param kept how many are kept
 * @returns the segments to show
 */
export function withHeardSegment({
  held,
  heard,
  kept,
}: {
  held: readonly HeardSegment[];
  heard: HeardSegment;
  kept: number;
}): readonly HeardSegment[] {
  const index = held.findIndex((entry) => entry.id === heard.id);
  if (index === -1) {
    return [...held.slice(Math.max(0, held.length - (kept - 1))), heard];
  }
  return [...held.slice(0, index), heard, ...held.slice(index + 1)];
}

/**
 * What the stage's history is fed, wherever it is drawn — the stage and the orb's messenger both call this, so the two
 * are one transcript shown twice and cannot drift. A `?said=` moment beside a stage preview replaces the live turns and
 * hearing in both, and says so, so the earlier conversation is left off a recording rather than mixed with made-up
 * turns.
 *
 * @param segments the call's segments, oldest first
 * @param hearing whether the owner's voice is being heard right now
 * @param preview the stage preview's query string, `undefined` with none
 * @param kept how many turns the history keeps, unfinished ones counted
 * @returns the history, whether the owner is heard, and whether a preview stood in for the call
 */
export function shownConversationOf({
  segments,
  hearing,
  preview,
  kept,
}: {
  segments: readonly HeardSegment[];
  hearing: boolean;
  preview: string | undefined;
  kept: number;
}): StageConversation & { readonly hearing: boolean; readonly previewed: boolean } {
  let shown = segments;
  let heard = hearing;
  let previewed = false;
  if (preview !== undefined) {
    const said = saidPreviewOf({ search: preview });
    if (said !== undefined) {
      shown = said.segments;
      heard = said.hearing;
      previewed = true;
    }
  }
  return { ...stageConversationOf({ kept, segments: shown }), hearing: heard, previewed };
}

/**
 * The conversation for the stage: the newest `kept` turns, finished or not, are the history, so it never lags what is
 * being said.
 *
 * @param segments the shown segments, oldest first
 * @param kept how many turns the history keeps, unfinished ones counted
 * @returns the history's turns
 */
export function stageConversationOf({
  segments,
  kept,
}: {
  segments: readonly HeardSegment[];
  kept: number;
}): StageConversation {
  return { history: segments.slice(Math.max(0, segments.length - kept)) };
}

/**
 * Whether the history shows the owner's typing indicator: they are being heard and none of their words are recognised
 * yet, so the transcript says the owner is speaking before it can say what. The voice's own unfinished turn never
 * hides it — the owner may be talking over it — and the owner's finished turns never do either.
 *
 * @param segments the history's turns
 * @param hearing whether the owner's voice is being heard right now
 * @returns true while the owner is heard with no unfinished turn of theirs shown
 */
export function speakingIndicatorShows({
  segments,
  hearing,
}: {
  segments: readonly HeardSegment[];
  hearing: boolean;
}): boolean {
  return hearing && !segments.some((segment) => segment.who === "owner" && !segment.final);
}

/** The query parameter that fills a `?stage=` preview's history at one moment of the owner's turn: `?stage=star-cluster&said=mid-turn`. */
export const SAID_PREVIEW_PARAM = "said";

/**
 * The moments of the owner's turn a preview can draw: speaking before any of their words are recognised, mid-turn with
 * them arriving, settled once the turn is done, folded — a long turn of the owner's, settled, then the voice's answer
 * — and linked, a turn of the owner's carrying a pasted link with no break in it, then the voice's long answer.
 */
export const SAID_MOMENTS = ["speaking", "mid-turn", "settled", "folded", "linked"] as const;

/** The turns every preview moment opens on, finished. */
const SAID_BEFORE: readonly HeardSegment[] = [
  { final: true, id: "said-1", text: "What's waiting on me this morning?", who: "owner" },
  {
    final: true,
    id: "said-2",
    text: "Two cards on the Queue: a review ask on the console pull request, and a Linear ticket to close.",
    who: "voice",
  },
];

/** The owner's turn as each moment shows it. */
const SAID_TURN = "Open the review ask first, and read me the";

/** The folded moment's ramble, which starts on one thing and lands on another, and the voice's answer to it. */
const SAID_FOLDED: readonly HeardSegment[] = [
  {
    final: true,
    id: "said-3",
    text: "Okay so the review ask, I had a look at the Slack thread for it earlier and honestly the way those messages read is a bit stiff, like they open on a greeting and then bury the actual ask three lines down, which is the opposite of how I write. Anyway, that is a separate thing. What I actually want right now is the console pull request: read me the diff, and tell me whether it is safe to land before lunch.",
    who: "owner",
  },
  {
    final: true,
    id: "said-4",
    text: "It is safe to land: two files change, both inside the Queue page, and its checks are green.",
    who: "voice",
  },
];

/**
 * The linked moment: a Slack link pasted mid-sentence, one token with no break in it wider than the messenger, and
 * the voice's answer, long enough to wrap over several lines — the newest turn, which the history must show whole.
 */
const SAID_LINKED: readonly HeardSegment[] = [
  {
    final: true,
    id: "said-3",
    text: "Have a look at https://acme.slack.com/archives/C0SYN7REVIEWASK/p1760012345678901?thread_ts=1760012345.678901&cid=C0SYN7REVIEWASK and tell me what it needs from me",
    who: "owner",
  },
  {
    final: true,
    id: "said-4",
    text: "That thread is the review ask on the console pull request. It needs one thing from you: a yes on the two files inside the Queue page, since its checks are already green. On the next item, which bothers you most now: slow replies, interruptions, or replies that go on too long?",
    who: "voice",
  },
];

/**
 * What a preview's history holds at one moment of the owner's turn, so each can be photographed with no call up —
 * beside `?stage=` and `?orb=`, and in the orb's messenger ({@link messengerPreviewOf}). One exact name or nothing, as
 * `stagePreviewOf` reads its own.
 *
 * @param search the page's `location.search`
 * @returns the turns and whether the owner is heard, or `undefined` when the address asks for no moment
 */
export function saidPreviewOf({
  search,
}: {
  search: string;
}): { readonly segments: readonly HeardSegment[]; readonly hearing: boolean } | undefined {
  const asked = new URLSearchParams(search).getAll(SAID_PREVIEW_PARAM);
  if (asked.length !== 1) {
    return undefined;
  }
  const moment = SAID_MOMENTS.find((name) => name === asked[0]);
  if (moment === undefined) {
    return undefined;
  }
  if (moment === "speaking") {
    return { hearing: true, segments: SAID_BEFORE };
  }
  if (moment === "mid-turn") {
    return { hearing: true, segments: [...SAID_BEFORE, { final: false, id: "said-3", text: SAID_TURN, who: "owner" }] };
  }
  const settled: HeardSegment = { final: true, id: "said-3", text: `${SAID_TURN} diff.`, who: "owner" };
  if (moment === "settled") {
    return { hearing: false, segments: [...SAID_BEFORE, settled] };
  }
  if (moment === "linked") {
    return { hearing: false, segments: [...SAID_BEFORE, ...SAID_LINKED] };
  }
  return { hearing: false, segments: [...SAID_BEFORE, ...SAID_FOLDED] };
}

/**
 * The preview the orb's messenger draws its history with: any address carrying a `?said=` moment, with or without a
 * `?stage=` beside it, whenever no call is up. Read off the address rather than off the stage's own preview, which
 * dismissing the stage drops, so the messenger can be photographed holding turns. A live call's turns are never
 * replaced.
 *
 * @param search the page's `location.search`
 * @returns the address to read the said moment from, or `undefined` when there is none to draw
 */
export function messengerPreviewOf({
  search,
  callActive,
}: {
  search: string;
  callActive: boolean;
}): string | undefined {
  if (callActive || saidPreviewOf({ search }) === undefined) {
    return undefined;
  }
  return search;
}

/** How near the bottom, in pixels, still counts as at it: a sub-pixel or a trackpad's last nudge never unpins. */
export const HISTORY_BOTTOM_SLACK_PX = 24;

/**
 * Whether the history is scrolled to its newest line. Scrolling up holds the view, and an arrow at the bottom takes the
 * owner back to the live end — so the history follows new lines only while this is true, and the arrow shows while it
 * is not.
 *
 * @param scrollTop how far the history is scrolled
 * @param scrollHeight its full height
 * @param clientHeight its visible height
 * @returns true at, or within the slack of, the bottom
 */
export function isAtBottom({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return scrollHeight - scrollTop - clientHeight <= HISTORY_BOTTOM_SLACK_PX;
}

/**
 * Whether the history still follows new lines after one scroll. Once the owner has pressed the latest arrow, they are
 * always looking at the bottom, so more words arriving must not bring the arrow back. Reading `isAtBottom` on every
 * scroll event was that bug: the arrow's smooth scroll fires events on its way down, none at the bottom yet, and the
 * first one unpinned it. So only a scroll UP that leaves the bottom lets go — the owner's own, deliberate — and every
 * other scroll keeps what was.
 *
 * @param following whether it followed before this scroll
 * @param atBottom whether this scroll left it at the bottom
 * @param scrollTop where this scroll left it
 * @param lastScrollTop where it was before this scroll
 * @returns true while it follows new lines
 */
export function followsAfterScroll({
  following,
  atBottom,
  scrollTop,
  lastScrollTop,
}: {
  following: boolean;
  atBottom: boolean;
  scrollTop: number;
  lastScrollTop: number;
}): boolean {
  if (atBottom) {
    return true;
  }
  if (scrollTop < lastScrollTop) {
    return false;
  }
  return following;
}

/** About two lines of a stage bubble, in characters: each end of a folded turn of the owner's keeps at most this many. */
export const FOLD_EDGE_CHARS = 120;

/** How much longer than its two ends a turn must be to fold, so a fold always hides more than a few words. */
const FOLD_MARGIN_CHARS = 60;

/** A turn as the history draws it: whole, or folded to where it started and where it landed. */
export type Fold =
  { readonly kind: "whole" } | { readonly kind: "folded"; readonly head: string; readonly tail: string };

/**
 * A finished turn of the owner's, folded to its two ends. The owner needs to know their words are there, not to read
 * their own transcript, and a ramble can start on one topic and end on another, so a preview of the top and the bottom
 * of the message serves — two lines from each end, an ellipsis between, expandable. The two ends are disjoint slices
 * cut on a space, so a wide window never shows a word twice; the bubble still caps each at two lines. An end with no
 * space to cut on — a pasted address, say — stays whole rather than be cut mid-token.
 *
 * @param text the whole turn
 * @returns the turn whole when it is short enough to read at a glance, else its opening and its close
 */
export function foldOf({ text }: { text: string }): Fold {
  const said = text.trim();
  if (said.length <= FOLD_EDGE_CHARS * 2 + FOLD_MARGIN_CHARS) {
    return { kind: "whole" };
  }
  const headEnd = said.lastIndexOf(" ", FOLD_EDGE_CHARS);
  const tailStart = said.indexOf(" ", said.length - FOLD_EDGE_CHARS);
  if (headEnd <= 0 || tailStart === -1) {
    return { kind: "whole" };
  }
  return { head: said.slice(0, headEnd).trimEnd(), kind: "folded", tail: said.slice(tailStart).trimStart() };
}
