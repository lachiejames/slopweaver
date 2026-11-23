/**
 * The conversation the owner and the console voice had, across every call and typed conversation, as one thread — what the
 * orb's messenger and the stage open on, so it picks up where the two of them stopped.
 *
 * Opening the chat shows the last message sent either way and nothing that happened sooner, and the transcript holds
 * no supervisor chatter. So the
 * thread is read from the call files alone, and from them only the speech: the owner's words and the voice's, spoken or
 * typed. Never a tool line, a relay, the supervisor's chat, or what the thinking model wrote for the voice to say.
 *
 * Pure: the calls are already read (`./callStore.ts`).
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { CallRecord } from "./callRecord.js";
import type { TalkSurface } from "./talkSurface.js";

/**
 * Whether `path` is `root` or inside it, by path segments: `/w/main-other` is not inside `/w/main`.
 *
 * @param path the checkout a call names
 * @param root a declared main checkout
 * @returns whether the call's checkout lies under that declaration
 */
function withinCheckout({ path, root }: { path: string; root: string }): boolean {
  const between = relative(resolve(root), resolve(path));
  return between === "" || (!isAbsolute(between) && between !== ".." && !between.startsWith(`..${sep}`));
}

/**
 * Whether a call was recorded by another install's console: one that said, when it wrote the call, that it served
 * its install's MAIN checkout, at a path under none of the main checkouts this install declares. A home carried from
 * another machine holds that machine's calls, every one stamped with its own main checkout's path, and they are no
 * conversation the panel on this machine picks up from. A path rule, not an install identity: a call with no origin,
 * one from a worktree console (`mainWorktree: false`), and every call in a home that declares no main checkout are
 * kept, because nothing in them says they are another install's.
 *
 * @param call the call read
 * @param mainCheckoutPaths the main checkouts this install's profile declares
 * @returns whether to leave it out of this install's thread
 */
function recordedElsewhere({
  call,
  mainCheckoutPaths,
}: {
  call: CallRecord;
  mainCheckoutPaths: readonly string[];
}): boolean {
  const { origin } = call;
  if (origin === undefined || !origin.mainWorktree || mainCheckoutPaths.length === 0) {
    return false;
  }
  return !mainCheckoutPaths.some((root) => withinCheckout({ path: origin.checkoutRoot, root }));
}

/**
 * The calls the thread may show: every call but the desktop test instance's, whose record keeps the mark once any
 * open carried it (`./callOpened.ts`), and but another install's ({@link recordedElsewhere}). A call with neither is
 * shown exactly as before either rule existed.
 *
 * @param calls the calls read
 * @param mainCheckoutPaths the main checkouts this install's profile declares
 * @returns the calls the thread may show
 */
function ownerCalls({
  calls,
  mainCheckoutPaths,
}: {
  calls: readonly CallRecord[];
  mainCheckoutPaths: readonly string[];
}): readonly CallRecord[] {
  return calls.filter((call) => call.origin?.instance !== "e2e" && !recordedElsewhere({ call, mainCheckoutPaths }));
}

/** How many turns the thread holds by default: enough to scroll back through a few days of talk. */
export const THREAD_TURNS_DEFAULT = 200;

/** The most turns one read may ask for. */
export const THREAD_TURNS_MAX = 1000;

/**
 * How many of the newest calls anyone spoke on are read for it (`readCalls`' `speaking`): a reopen spawns this read,
 * so it stays a handful of files, and a silent call is passed over rather than counted, so a run of them never hides
 * the last thing said. Measured: the newest 8 held 765 turns (`slopweaver talk calls --limit 8 --json`).
 */
export const THREAD_CALLS_READ = 20;

/** One turn of the thread. */
export interface ThreadTurn {
  /** `<callId>:<segmentId>` — the id the page gives the same turn while its call is live (`shownSegmentOf`). */
  readonly id: string;
  readonly who: "owner" | "voice";
  readonly text: string;
  /** When its last snapshot was taken. */
  readonly atIso: string;
  /** When it began: the thread's order, which a page sets a turn it carried among by. */
  readonly beganIso: string;
  /** Spoken on a call, or typed in the messenger. */
  readonly medium: TalkSurface;
  /** Whether the turn was finished; a call that dropped mid-sentence keeps the words it had (`./callRecord.ts`). */
  readonly final: boolean;
}

/**
 * The thread: every call's speech in the order each turn began, cut to the newest `turns`. Never call by call: a turn
 * of one conversation can begin after a later one opened — a second page with its own conversation open — so grouping
 * by call would end the thread on a turn that was not the last. Turns begun in the same instant keep
 * their calls' opening order, then each call's own. A turn with no words is no turn, and a call the desktop test
 * instance placed, or another install recorded, is no conversation of the owner's here ({@link ownerCalls}).
 *
 * @param calls the calls read, in any order
 * @param mainCheckoutPaths the main checkouts this install's profile declares
 * @param turns how many of the newest turns to keep
 * @returns the turns, oldest first
 */
export function chatThreadOf({
  calls,
  mainCheckoutPaths,
  turns,
}: {
  calls: readonly CallRecord[];
  mainCheckoutPaths: readonly string[];
  turns: number;
}): readonly ThreadTurn[] {
  const thread = ownerCalls({ calls, mainCheckoutPaths })
    .toSorted((a, b) => Date.parse(a.openedIso) - Date.parse(b.openedIso))
    .flatMap((call) =>
      call.segments
        .filter((segment) => segment.text.trim() !== "")
        .map((segment) => ({
          beganMs: Date.parse(segment.beganIso),
          turn: {
            atIso: segment.atIso,
            beganIso: segment.beganIso,
            final: segment.final,
            id: `${call.callId}:${segment.id}`,
            medium: call.surface,
            text: segment.text.trim(),
            who: segment.who,
          } satisfies ThreadTurn,
        })),
    )
    .toSorted((a, b) => a.beganMs - b.beganMs)
    .map(({ turn }) => turn);
  return thread.slice(Math.max(0, thread.length - turns));
}

/**
 * Whether the thread leaves out anything older than its first turn: a call file the read never opened, or a turn the
 * cut to `turns` dropped. A page holding a turn the thread lacks may take it as aged out only then; otherwise the
 * turn is one not written yet, a batch landing after a later one.
 *
 * A file never opened may be another install's, which the thread would have left out anyway; it still counts here,
 * because nothing unread says whose it is.
 *
 * @param calls the calls read
 * @param mainCheckoutPaths the main checkouts this install's profile declares
 * @param passedOver how many call files the read never opened (`./callStore.ts`'s `CallsRead`)
 * @param turns how many of the newest turns the thread keeps
 * @returns whether older history was left out
 */
export function threadCutOf({
  calls,
  mainCheckoutPaths,
  passedOver,
  turns,
}: {
  calls: readonly CallRecord[];
  mainCheckoutPaths: readonly string[];
  passedOver: number;
  turns: number;
}): boolean {
  const said = ownerCalls({ calls, mainCheckoutPaths }).reduce(
    (count, call) => count + call.segments.filter((segment) => segment.text.trim() !== "").length,
    0,
  );
  return passedOver > 0 || said > turns;
}

/**
 * What the thread could not read: every file the read could not open, then every call read with lines that did not
 * parse. A torn line may be the newest thing said, so a call that kept its other lines is still one the history must
 * say is missing something, rather than end on its older turn as though it were the last. A torn call the thread
 * leaves out anyway is no gap in it; a file that could not be opened at all says nothing of whose it is, so it stays.
 *
 * @param calls the calls read
 * @param mainCheckoutPaths the main checkouts this install's profile declares
 * @param unreadable the files the read could not open, each with why
 * @returns every gap, each with why
 */
export function threadUnreadableOf({
  calls,
  mainCheckoutPaths,
  unreadable,
}: {
  calls: readonly CallRecord[];
  mainCheckoutPaths: readonly string[];
  unreadable: readonly string[];
}): readonly string[] {
  const torn = ownerCalls({ calls, mainCheckoutPaths })
    .filter((call) => call.skipped > 0)
    .map((call) => `${call.callId}: ${String(call.skipped)} line(s) did not parse`);
  return [...unreadable, ...torn];
}
