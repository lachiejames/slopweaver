/**
 * The owner has drifted from what they said they would do, handed to the voice so it says one fixed line about it
 * (`WindowNoticeLines.announceDrift` in `site/lib/talkPlanWindowNotices.ts`; the page's watch is
 * `site/components/voice/useFrontWindowNotices.ts`).
 *
 * Being notified of a drift is useful even when it is deliberate. The page posts the plan's label, the application's name and how long, bounded by
 * `driftNoticeOf`; the sentence is the server's (`driftSpeech`), spoken rather than prompted, and never a card.
 */
import { NextResponse } from "next/server";

import { driftNoticeOf } from "../../../../../../lib/driftNotice";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: a notice id, an application name, a plan label and a count, with room. */
const DRIFT_MAX_BYTES = 2_048;

/** What the page is answered. */
export type TalkCallDriftResult =
  { readonly ok: true; readonly already: boolean } | { readonly ok: false; readonly refused: string };

/**
 * Hand the voice one drift line.
 *
 * @param request the page's post: `{ noticeId, app, plan, minutes }`
 * @param context the call id
 * @returns whether the voice was handed it (or had been), or why not — a 409 when the floor refused it and a retry
 *   will do, a 424 when the write failed
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallDriftResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: DRIFT_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const notice = driftNoticeOf({ value: read.body });
  if (notice === undefined) {
    const refused = "a drift must carry a noticeId, an app, a plan and whole minutes in range";
    return NextResponse.json({ ok: false, refused }, { headers, status: 400 });
  }
  if (read.call.surface !== "voice") {
    const refused = "a typed conversation has no voice to say a drift line";
    return NextResponse.json({ ok: false, refused }, { headers, status: 422 });
  }
  const told = await read.call.windowNotices.announceDrift({ notice });
  if (told.kind === "refused") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 409 });
  }
  if (told.kind === "failed") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ already: told.kind === "already", ok: true }, { headers });
}
