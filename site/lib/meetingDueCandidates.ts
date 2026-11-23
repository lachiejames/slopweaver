/**
 * What one ask of the call's `meeting-due` route is answered with, given this read, the process ledger's claims and the
 * page's own word: the meeting to tell the owner and the fresh copy of every pill the page already shows. Pure, so the route
 * (`site/app/api/talk/call/[id]/meeting-due/route.ts`) is a thin shell over it and the ordering is a unit test
 * (`site/__tests__/unit/meetingDueCandidates.test.ts`) rather than a spawn and a call to mock.
 *
 * The owner's word binds both candidate lists. A skip filters this read AND the ledger's claims, since a claim kept from an
 * earlier lost answer would otherwise still raise the heads-up for a meeting the owner ruled out
 * ([why](../../docs/console/voice-notices-meetings.md)).
 */
import { type MeetingNotice, type MeetingSkip, meetingToTell, unskippedNotices, withoutBriefing } from "./meetingDue";

/**
 * The meeting to tell the owner, and the fresh read of the pills already up.
 *
 * @param read this ask's calendar read, `undefined` when it failed
 * @param claimed the meetings any call of this server was already told to say (`./meetingLedger.ts`)
 * @param skips the meetings the owner said they have had or will not go to
 * @param shown the notice ids the page has already put in front of the owner
 * @param nowMs the instant judged at
 * @returns the meeting (`undefined` for none) and the refreshed pills (`null` when the read failed)
 */
export function meetingDueCandidates({
  read,
  claimed,
  skips,
  shown,
  nowMs,
}: {
  read: readonly MeetingNotice[] | undefined;
  claimed: readonly MeetingNotice[];
  skips: readonly MeetingSkip[];
  shown: readonly string[];
  nowMs: number;
}): { readonly notice: MeetingNotice | undefined; readonly refreshed: readonly MeetingNotice[] | null } {
  let due: readonly MeetingNotice[] = [];
  if (read !== undefined) {
    due = unskippedNotices({ notices: read, skips });
  }
  // Only this read, never a claim: a claim is an earlier read, and the pill already holds one at least that fresh.
  // `null` when the read failed: nothing vouches for a pill's briefing, though its join link stands.
  let refreshed: readonly MeetingNotice[] | null = null;
  if (read !== undefined) {
    refreshed = due.filter((one) => shown.includes(one.noticeId));
  }
  const told = meetingToTell({ claimed: unskippedNotices({ notices: claimed, skips }), due, nowMs, shown });
  // A claim this read does not name carries a briefing nothing vouches for now; its link stays.
  const vouched = told !== undefined && due.some((one) => one.noticeId === told.noticeId);
  if (told === undefined || vouched) {
    return { notice: told, refreshed };
  }
  return { notice: withoutBriefing({ notice: told }), refreshed };
}
