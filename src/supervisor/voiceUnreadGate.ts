/**
 * The `tick-record` gate that makes a word the owner spoke on a call impossible to leave unread: a tick is refused while the
 * supervisor's `talk unread` cursor is behind any FINISHED word of the owner's, and a stretch the owner is still speaking is named,
 * never refused, until it finishes.
 *
 * Every word of the owner's transcripts with the conversational voice AI must be seen by the supervisor, and
 * skipping one must be impossible. The sweep
 * reads `talk unread` every tick; this is what makes skipping that read a refusal rather than a quiet gap.
 *
 * ## A stretch still being spoken is named, not refused
 *
 * The page snapshots an open stretch every 4 s (`site/components/voice/useCallTranscript.ts`), so during a monologue
 * the same segment lands past the cursor again after every mark. Refusing it held a chair's whole pass for over ten
 * minutes while every finished word had been read. A stretch
 * cannot be acted on until it is final, so one is passed when ALL of these hold: it is not final, its text is not cut
 * at the store's cap, its call has not written an end since it last opened, a snapshot of it is already behind the
 * cursor — the chair has read the start of this very turn — and its newest snapshot is within
 * {@link STILL_SPEAKING_MS} of the tick, either side.
 *
 * Nothing here marks it read. It stays past the cursor and refuses the next tick taken by any chair once it is final,
 * once its call ends, or once it has not grown for {@link STILL_SPEAKING_MS} — the last is how a call dropped without
 * an end line, whose stretch is never finalised, still refuses. What this buys is one tick's pass,
 * named in its output; what it costs is that a chair's LAST tick may pass a stretch it has seen only the start of,
 * which the next tick of any chair refuses.
 *
 * ## Nothing refuses inside the owner's two-minute floor
 *
 * The chair acts on a quiet stretch only once two minutes have passed since the owner's
 * last word (`../talk/chairWake.ts`'s {@link QUIET_BEFORE_DELIVERY_MS}), so a mid-stretch correction lands beside what
 * it corrects. While the owner's newest unread snapshot is younger than that, every unread word is passed and named as
 * `stillSpoken` — finished ones too, since the batch that brings them is not due. Past the floor the rules below apply.
 *
 * Every other unread word refuses, whatever its age or stamp: a finished one, a first snapshot nobody has read any of,
 * one on an ended call, a stale one.
 *
 * A line landing between this gate's one read and the tick's append is not refused by THIS tick, and is not
 * consumed by it either — only a printed mark moves the cursor — so it refuses the next tick taken by any chair
 * (a lock across the append would buy one tick of latency, not a word).
 *
 * Pure: the read is the shell's (`src/cli/commands/supervisor/tickRecordRun.ts`), taken once.
 */
import { QUIET_BEFORE_DELIVERY_MS } from "../talk/chairWake.js";
import type { UnparseableLine, UnreadWord } from "../talk/unreadWords.js";

/**
 * How recently a stretch must have grown to count as still being spoken: fifteen of the page's 4 s snapshots. The
 * page writes one only when the text changed, so a stretch silent this long is a pause or a dropped call, and refuses.
 */
export const STILL_SPEAKING_MS = 60_000;

/** What the shell read of the supervisor's unread words: the selection, or why it could not be read. */
export type VoiceUnreadRead =
  | {
      readonly kind: "read";
      readonly words: readonly UnreadWord[];
      readonly unparseable: readonly UnparseableLine[];
      /** Whether the supervisor cursor has never been marked — then words past the 24-hour first-read window are unseen. */
      readonly neverMarked: boolean;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/** The gate's verdict on one tick. `stillSpoken` is every stretch passed as still being spoken, for the tick to name. */
export type VoiceUnreadVerdict =
  | { readonly kind: "clean"; readonly stillSpoken: readonly UnreadWord[] }
  | {
      readonly kind: "refused";
      readonly words: readonly UnreadWord[];
      readonly unparseable: readonly UnparseableLine[];
      readonly neverMarked: boolean;
      readonly stillSpoken: readonly UnreadWord[];
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Whether one unread word is a stretch the owner is still speaking at the tick: growing past a read of it, and grown
 * within {@link STILL_SPEAKING_MS} of the tick on either side.
 *
 * @param word the unread word
 * @param nowIso the tick's own instant
 * @returns whether the tick passes it, naming it
 */
function stillSpokenAt({ word, nowIso }: { word: UnreadWord; nowIso: string }): boolean {
  return word.growingSinceRead && Math.abs(Date.parse(nowIso) - Date.parse(word.latestAtIso)) <= STILL_SPEAKING_MS;
}

/**
 * Whether the owner is still inside a quiet stretch's floor at the tick: their newest unread snapshot is younger than
 * {@link QUIET_BEFORE_DELIVERY_MS}, so the chair's one batch for it is not due and nothing of it is the chair's to act on.
 * A snapshot stamped more than {@link STILL_SPEAKING_MS} AHEAD of the tick opens no floor: a skewed clock would hold
 * the gate open until it caught up, so that word refuses as it always has.
 */
function quietNotYetDue({ words, nowIso }: { words: readonly UnreadWord[]; nowIso: string }): boolean {
  const sinceNewest = Date.parse(nowIso) - Math.max(...words.map((word) => Date.parse(word.latestAtIso)));
  return words.length > 0 && sinceNewest >= -STILL_SPEAKING_MS && sinceNewest < QUIET_BEFORE_DELIVERY_MS;
}

/**
 * Judge one tick: refused while any finished word of the owner's is unread, or any unread line did not parse (it may be the owner's
 * words), or the cursor has never been marked (a first read shows only 24 hours, so an older word would pass unseen);
 * unreadable when the read failed. A stretch still being spoken is carried as `stillSpoken` and refuses nothing, and so
 * is every unread word while their newest one is inside the two-minute floor (nothing acts before it).
 *
 * @param read what the shell read
 * @param nowIso the tick's own instant, which a stretch's newest snapshot is judged against
 * @returns the verdict
 */
export function judgeVoiceUnread({ read, nowIso }: { read: VoiceUnreadRead; nowIso: string }): VoiceUnreadVerdict {
  if (read.kind === "unreadable") {
    return read;
  }
  const inQuietFloor = quietNotYetDue({ nowIso, words: read.words });
  const passes = ({ word }: { word: UnreadWord }): boolean => inQuietFloor || stillSpokenAt({ nowIso, word });
  const stillSpoken = read.words.filter((word) => passes({ word }));
  const words = read.words.filter((word) => !passes({ word }));
  if (words.length === 0 && read.unparseable.length === 0 && !read.neverMarked) {
    return { kind: "clean", stillSpoken };
  }
  return { kind: "refused", neverMarked: read.neverMarked, stillSpoken, unparseable: read.unparseable, words };
}
