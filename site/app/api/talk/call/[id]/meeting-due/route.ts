/**
 * Which meeting of the owner's is starting now, read by this server and said by the voice once, so the page can put its join
 * link beside the orb (`PlanCall.announceMeeting` in `site/lib/talkPlanCall.ts`; the page's watch is
 * `site/lib/meetingDueWatch.ts`).
 *
 * Measured: the owner was two minutes late for a meeting while talking to the voice. An owner already talking to it
 * is best reached through it, so the voice tells them to click the join button.
 * The page posts which notices it has already shown and which meetings the owner told the
 * voice they have had or will not go to (`meeting_skip`); this route reads their calendar itself with `talk meeting-due`, so
 * the meeting the voice names and the link the page shows are a read this server made, never a meeting a page
 * asserted. A skip only ever takes a meeting OUT; it can never name one in
 * ([why](../../../../../../../docs/console/voice-notices-meetings.md)).
 */
import { NextResponse } from "next/server";

import {
  MEETING_DUE_BODY_MAX,
  type MeetingNotice,
  meetingDueAnswerOf,
  shownNoticeIdsOf,
  skippedMeetingsOf,
} from "../../../../../../lib/meetingDue";
import { meetingDueCandidates } from "../../../../../../lib/meetingDueCandidates";
import { processMeetingLedger } from "../../../../../../lib/meetingLedger";
import { spawnVerb } from "../../../../../../lib/spawnVerb";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { talkToolFailureDetail } from "../../../../../../lib/talkToolFailure";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** How long the calendar read may take: one listing, well inside the page's own wait. */
const MEETING_DUE_READ_MS = 15_000;

/** The verb line, for the reason a failure names. */
const MEETING_DUE_TITLE = "talk meeting-due";

/** What the page is answered. */
export type TalkCallMeetingDueResult =
  | {
      readonly ok: true;
      readonly meeting: MeetingNotice | null;
      readonly already: boolean;
      /** Why the voice did not say the line, when it would not; `null` when it did, or had already. */
      readonly unspoken: string | null;
      /** This read's copy of every meeting the page said it has shown, so a pill already up follows it;
       * `null` when the calendar read failed. */
      readonly refreshed: readonly MeetingNotice[] | null;
    }
  | {
      readonly ok: false;
      readonly refused: string;
      /** On a taken floor, the read the route made all the same, so a floor held for minutes cannot hold a stale
       * briefing up. */
      readonly refreshed?: readonly MeetingNotice[] | null;
    };

/**
 * Read the owner's meetings due with `talk meeting-due`, strictly.
 *
 * @returns the meetings, or why the read gave none
 */
async function readMeetingsDue(): Promise<{ notices: readonly MeetingNotice[] } | { refused: string }> {
  const ran = await spawnVerb({
    argv: ["talk", "meeting-due", "--json"],
    timeoutMs: MEETING_DUE_READ_MS,
    title: MEETING_DUE_TITLE,
  });
  if (!ran.ok) {
    return { refused: talkToolFailureDetail({ outcome: ran, title: MEETING_DUE_TITLE }) };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(ran.out);
  } catch {
    return { refused: `${MEETING_DUE_TITLE} did not print JSON` };
  }
  const notices = meetingDueAnswerOf({ value: payload });
  if (notices === undefined) {
    return { refused: `${MEETING_DUE_TITLE} printed an answer this console cannot read` };
  }
  return { notices };
}

/**
 * Read the owner's calendar, and have the voice say the first meeting starting now that the page has not shown.
 *
 * @param request the page's post: `{ shown: string[], skipped: MeetingSkip[] }`
 * @param context the call id
 * @returns the meeting said (or said already, or shown unsaid), none, or why not — a 409 when the floor is taken and a
 *   retry will do
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallMeetingDueResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: MEETING_DUE_BODY_MAX, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const shown = shownNoticeIdsOf({ value: read.body["shown"] });
  if (shown === undefined) {
    const refused = "shown must be a short list of the meeting notice ids this page has already shown";
    return NextResponse.json({ ok: false, refused }, { headers, status: 400 });
  }
  const skips = skippedMeetingsOf({ value: read.body["skipped"] });
  if (skips === undefined) {
    const refused = "skipped must be a short list of the meetings the owner said they have had or will not go to";
    return NextResponse.json({ ok: false, refused }, { headers, status: 400 });
  }
  if (read.call.surface !== "voice") {
    const refused = "a typed conversation has no voice to say a meeting";
    return NextResponse.json({ ok: false, refused }, { headers, status: 422 });
  }
  const calendar = await readMeetingsDue();
  // A claimed meeting is this server's own read, the latest one, and the call answers it `already`. A failed read still
  // offers the claims: their link is owed whether or not the calendar answers now. The ledger
  // takes the raw read: a skip is this page's word, and another page's claim is not this page's to drop.
  const ledger = processMeetingLedger();
  let fresh: readonly MeetingNotice[] | undefined;
  if ("notices" in calendar) {
    ledger.refresh({ notices: calendar.notices });
    fresh = calendar.notices;
  }
  const nowMs = Date.now();
  const { notice, refreshed } = meetingDueCandidates({ claimed: ledger.notices(), nowMs, read: fresh, shown, skips });
  if (notice === undefined && "refused" in calendar) {
    return NextResponse.json({ ok: false, refused: calendar.refused }, { headers, status: 502 });
  }
  if (notice === undefined) {
    return NextResponse.json({ already: false, meeting: null, ok: true, refreshed, unspoken: null }, { headers });
  }
  const said = await read.call.announceMeeting({ notice, nowMs });
  if (said.kind === "refused") {
    return NextResponse.json({ ok: false, refreshed, refused: said.reason }, { headers, status: 409 });
  }
  // A line the voice would not say still shows the link: the link is what gets the owner into the meeting.
  const unspoken = said.kind === "failed" ? said.reason : null;
  return NextResponse.json(
    { already: said.kind === "already", meeting: notice, ok: true, refreshed, unspoken },
    { headers },
  );
}
