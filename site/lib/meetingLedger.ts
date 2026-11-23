/**
 * Which meetings the voice has been told to say, for the whole server process rather than one plan call, so a meeting
 * is said once however many calls it spans, and its join link still reaches a page that lost the answer saying so.
 *
 * Two cases decide this: a line spoken whose response the page lost leaves the page's shown set without it, so a
 * rollover onto a fresh plan call before the retry would say it again if the record lived on the call; and a retry
 * landing after the meeting left `talk meeting-due`'s window would find nothing due, so the link never showed. The
 * route offers {@link MeetingLedger.notices} beside the fresh read for that second case (`meetingToTell` in
 * `./meetingDue.ts`). It hangs off `globalThis`
 * under a symbol for the reason `./talkCallRegistry.ts` gives: `next dev` re-evaluates a module when it recompiles
 * it, and the routes are separate modules.
 */
import { MEETING_LATE_EDGE_MS, type MeetingNotice, meetingPillLive } from "./meetingDue";

/** The meetings claimed, by notice id. */
export class MeetingLedger {
  private readonly claimed = new Map<string, MeetingNotice>();

  /**
   * Whether a meeting has been claimed already.
   *
   * @param noticeId the meeting's notice id, which carries its start
   * @returns true once any call claimed it
   */
  has({ noticeId }: { noticeId: string }): boolean {
    return this.claimed.has(noticeId);
  }

  /**
   * Claim a meeting before it is said, forgetting a claim only once `talk meeting-due` can never name it again — its
   * start is past the verb's late edge, {@link MEETING_LATE_EDGE_MS} — and its link is no longer worth showing. Its
   * end alone is not enough: an event extended after it was read keeps its notice id and could come due again.
   *
   * @param notice the meeting, as the server read it
   * @param nowMs the instant claimed at
   */
  claim({ notice, nowMs }: { notice: MeetingNotice; nowMs: number }): void {
    for (const [id, held] of this.claimed) {
      const pastDue = nowMs > Date.parse(held.startIso) + MEETING_LATE_EDGE_MS;
      if (pastDue && !meetingPillLive({ notice: held, nowMs })) {
        this.claimed.delete(id);
      }
    }
    this.claimed.set(notice.noticeId, notice);
  }

  /**
   * Take a fresh read of meetings already claimed, so a claim carries the latest end this server read: an event
   * extended after it was said would otherwise be judged ended at its old end once the verb's window has passed it.
   * A meeting not claimed is left alone — reading one is not saying it.
   *
   * @param notices the meetings `talk meeting-due` just read
   */
  refresh({ notices }: { notices: readonly MeetingNotice[] }): void {
    for (const notice of notices) {
      if (this.claimed.has(notice.noticeId)) {
        this.claimed.set(notice.noticeId, notice);
      }
    }
  }

  /**
   * Every meeting claimed and not yet forgotten.
   *
   * @returns those meetings, in the order they were claimed
   */
  notices(): readonly MeetingNotice[] {
    return [...this.claimed.values()];
  }
}

const KEY = Symbol.for("slopweaver.talk.meetingLedger");

/**
 * The one ledger for this server process, made on first use.
 *
 * @returns the process-global ledger
 */
export function processMeetingLedger(): MeetingLedger {
  const holder = globalThis as typeof globalThis & { [KEY]?: MeetingLedger };
  let found = holder[KEY];
  if (found === undefined) {
    found = new MeetingLedger();
    holder[KEY] = found;
  }
  return found;
}
