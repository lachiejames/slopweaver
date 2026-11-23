/**
 * A reopened call's opening window (`site/lib/talkPlanReopenReminder.ts`): the page says `ready` the moment its
 * connection is up, which starts the three seconds, and `speech` the moment its microphone meter hears the owner, which gives
 * the reminder away. The owner's own words go first, and after three seconds
 * of their silence the voice reminds them where they left off.
 *
 * The body carries only which of the two it is: whether this call is a reopen, and the reminder's words, are the
 * mint's, held by the server. A call that is not a reopen answers `unavailable`, so the page posts `ready` on every
 * call and watches for the owner's speech only on one that answered `armed`.
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import type { ReopenReminderPostOutcome } from "../../../../../../lib/talkPlanReopenReminder";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: `{"action":"speech"}`, with room. */
const REOPEN_REMINDER_MAX_BYTES = 256;

/** What the page is answered. */
export type TalkCallReopenReminderResult =
  { readonly ok: true; readonly outcome: ReopenReminderPostOutcome } | { readonly ok: false; readonly refused: string };

/**
 * Start the window, or give it away.
 *
 * @param request `{ action: "ready" }` once connected, `{ action: "speech" }` once the meter hears the owner
 * @param context the call id
 * @returns how the window took it
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallReopenReminderResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: REOPEN_REMINDER_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  // Exactly one of the two bodies, never a body that also carries anything else.
  const action = Object.keys(read.body).length === 1 ? read.body["action"] : undefined;
  if (action === "ready") {
    return NextResponse.json({ ok: true, outcome: read.call.reopenReminder.ready() }, { headers });
  }
  if (action === "speech") {
    return NextResponse.json(
      { ok: true, outcome: read.call.reopenReminder.giveWay({ reason: "speech" }) },
      { headers },
    );
  }
  return NextResponse.json(
    { ok: false, refused: 'the body names no action: send {"action":"ready"} or {"action":"speech"}' },
    { headers, status: 400 },
  );
}
