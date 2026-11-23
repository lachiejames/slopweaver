/**
 * The page's watch for a meeting of the owner's starting while they are on a call: it asks the call's `meeting-due` route now and
 * every {@link MEETING_POLL_MS} after, one post at a time, and puts the meeting the route says in front of the owner once.
 * The route reads the calendar and has the voice say the line (`PlanCall.announceMeeting`); this only paces the asks,
 * remembers what it has shown, and logs what each came to. Every effect is a seam, so the whole loop is a unit test
 * (`site/__tests__/unit/meetingDueWatch.test.ts`); the real timers and fetch are `../components/voice/useMeetingWatch.ts`.
 *
 * The voice is the best one to get the owner's attention while they are already talking to it. The route answers within its own read, so a poll every 30 seconds says a meeting at most about half a
 * minute after it enters the window — two minutes before its start, so in time.
 */
import { isBag } from "./bag";
import {
  type MeetingNotice,
  type MeetingSkip,
  meetingNoticeOf,
  refreshedNoticesOf,
  unskippedNotices,
} from "./meetingDue";

/** How often the watch asks while the call is up. */
export const MEETING_POLL_MS = 30_000;

/** How soon a refused ask is tried again: the floor was taken, or another line was being sent. */
export const MEETING_RETRY_MS = 5_000;

/** What one ask of the route came to. Every kind carries the route's fresh read of meetings already shown. */
export type MeetingPost = (
  | { readonly kind: "none" }
  | {
      readonly kind: "due";
      readonly meeting: MeetingNotice;
      readonly already: boolean;
      /** Why the voice did not say the line, `undefined` when it did or had already. */
      readonly unspoken: string | undefined;
    }
  | { readonly kind: "retry"; readonly why: string }
  | { readonly kind: "dropped"; readonly why: string }
) & {
  /** So a pill already up follows it (`refreshedPill`); `null` when no read came back, which vouches for no briefing. */
  readonly refreshed: readonly MeetingNotice[] | null;
};

/**
 * What one answer of the route means: a meeting to show, none, the floor taken or the response lost (try again
 * soon), or a refusal that the next regular ask may clear. A taken floor still carries the read the route made, so a
 * floor held for minutes cannot hold a stale briefing up with it.
 *
 * @param status the HTTP status, `undefined` when no response arrived
 * @param body the parsed response body, `undefined` when there was none or it was not JSON
 * @param why the route's own refusal, or the transport's
 * @returns what the watch does next
 */
export function meetingPostOf({
  status,
  body,
  why,
}: {
  status: number | undefined;
  body: unknown;
  why: string;
}): MeetingPost {
  let refreshed: readonly MeetingNotice[] | null = null;
  if (isBag(body)) {
    refreshed = refreshedNoticesOf({ value: body["refreshed"] });
  }
  if (status === undefined || status === 409) {
    return { kind: "retry", refreshed, why };
  }
  if (status < 200 || status >= 300) {
    return { kind: "dropped", refreshed, why };
  }
  if (!isBag(body)) {
    return { kind: "dropped", refreshed, why: "the meeting-due route answered no JSON" };
  }
  const { meeting, already, unspoken } = body;
  if (meeting === null) {
    return { kind: "none", refreshed };
  }
  const notice = meetingNoticeOf({ value: meeting });
  if (notice === undefined) {
    return { kind: "dropped", refreshed, why: "the meeting-due route answered a meeting this page cannot read" };
  }
  return {
    already: already === true,
    kind: "due",
    meeting: notice,
    refreshed,
    unspoken: typeof unspoken === "string" ? unspoken : undefined,
  };
}

/**
 * The log line for a meeting put in front of the owner: whether the voice said it, and that the link is shown either way.
 *
 * @param post the route's answer
 * @returns the line
 */
export function meetingShownDetail({ post }: { post: Extract<MeetingPost, { kind: "due" }> }): string {
  let said = "said";
  if (post.unspoken !== undefined) {
    said = `not said (${post.unspoken})`;
  } else if (post.already) {
    said = "said earlier on this call";
  }
  return `${post.meeting.title}: ${said}, join link shown`;
}

/** What the watch reaches. */
export interface MeetingWatchSeams {
  /** Run `run` once `ms` has passed, while the call is live; returns a cancel. */
  readonly after: (input: { readonly ms: number; readonly run: () => void }) => () => void;
  /** Whether the call the watch began on is still the page's. */
  readonly live: () => boolean;
  /** One ask of the route, never a rejection. */
  readonly post: (input: {
    readonly shown: readonly string[];
    readonly skipped: readonly MeetingSkip[];
  }) => Promise<MeetingPost>;
  /** The notice ids already put in front of the owner, kept across calls so a rollover never says one twice. */
  readonly shown: () => readonly string[];
  /** The meetings the owner said they have had or will not go to (`meeting_skip`), kept for the provider's life. */
  readonly skipped: () => readonly MeetingSkip[];
  /** Put a meeting in front of the owner and remember it as shown. */
  readonly show: (input: { readonly meeting: MeetingNotice }) => void;
  /** Take the route's fresh read of meetings already shown, so the pill up follows it. */
  readonly refresh: (input: { readonly notices: readonly MeetingNotice[] | null }) => void;
  /** Write a line in the call's log. */
  readonly note: (input: { readonly detail: string; readonly refused: boolean }) => void;
}

/**
 * Start the watch: ask now, then on the cadence, until the call is no longer the page's or the returned cancel runs.
 *
 * @param seams what the watch reaches
 * @returns a function that stops the watch
 */
export function watchMeetings({ seams }: { seams: MeetingWatchSeams }): () => void {
  let stopped = false;
  let cancelNext: () => void = () => undefined;
  let lastDropped: string | undefined;
  // A function, not an inline test: the cancel can run while a post is awaited.
  const halted = (): boolean => stopped || !seams.live();
  const next = ({ ms }: { ms: number }): void => {
    if (!halted()) {
      cancelNext = seams.after({
        ms,
        run: () => {
          void ask();
        },
      });
    }
  };
  async function ask(): Promise<void> {
    if (halted()) {
      return;
    }
    const posted = await seams.post({ shown: seams.shown(), skipped: seams.skipped() });
    if (halted()) {
      return;
    }
    // Every answer, a refusal's too: one with no read vouches for no briefing, so the pill's goes until a read does.
    seams.refresh({ notices: posted.refreshed });
    // A skip the owner made while this ask was out: the route judged it without, so its meeting never goes up now.
    const ruledOut =
      posted.kind === "due" && unskippedNotices({ notices: [posted.meeting], skips: seams.skipped() }).length === 0;
    if (ruledOut) {
      seams.note({ detail: `${posted.meeting.title}: skipped on the owner's word, no join link`, refused: false });
      next({ ms: MEETING_POLL_MS });
    } else if (posted.kind === "due") {
      seams.show({ meeting: posted.meeting });
      seams.note({ detail: meetingShownDetail({ post: posted }), refused: posted.unspoken !== undefined });
      next({ ms: MEETING_POLL_MS });
    } else if (posted.kind === "retry") {
      next({ ms: MEETING_RETRY_MS });
    } else if (posted.kind === "dropped") {
      // Logged once per reason: a calendar nobody connected would otherwise write the same line every poll.
      if (posted.why !== lastDropped) {
        seams.note({ detail: `no meeting check: ${posted.why}`, refused: true });
      }
      lastDropped = posted.why;
      next({ ms: MEETING_POLL_MS });
    } else {
      next({ ms: MEETING_POLL_MS });
    }
  }
  void ask();
  return () => {
    stopped = true;
    cancelNext();
  };
}
