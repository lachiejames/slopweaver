/**
 * The owner has strayed off ISO in work hours with an ISO card waiting on them, handed to the voice so it says one fixed line
 * naming that card (`WindowNoticeLines.announceIsoNudge` in `site/lib/talkPlanWindowNotices.ts`; the page's watch is
 * `site/components/voice/useFrontWindowNotices.ts`).
 *
 * The nudge reminds the owner that ISO work is still waiting. The page posts the one card's key and subject, the stretch's minutes and whether it is the
 * second, bounded by `isoNudgeNoticeOf`; the sentence is the server's (`isoNudgeSpeech`), spoken rather than prompted,
 * and never a card or a DM.
 */
import { NextResponse } from "next/server";

import { isoNudgeNoticeOf } from "../../../../../../lib/isoNudgeNotice";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: a notice id, a card key and subject, a count and a flag, with room. */
const ISO_NUDGE_MAX_BYTES = 2_048;

/** What the page is answered. */
export type TalkCallIsoNudgeResult =
  { readonly ok: true; readonly already: boolean } | { readonly ok: false; readonly refused: string };

/**
 * Hand the voice one ISO nudge.
 *
 * @param request the page's post: `{ noticeId, item: { key, subject }, minutes, again }`
 * @param context the call id
 * @returns whether the voice was handed it (or had been), or why not — a 409 when the floor refused it and a retry
 *   will do, a 424 when the write failed
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallIsoNudgeResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: ISO_NUDGE_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const notice = isoNudgeNoticeOf({ value: read.body });
  if (notice === undefined) {
    const refused = "an ISO nudge must carry a noticeId, one card's key and subject, whole minutes in range and again";
    return NextResponse.json({ ok: false, refused }, { headers, status: 400 });
  }
  if (read.call.surface !== "voice") {
    const refused = "a typed conversation has no voice to say an ISO nudge";
    return NextResponse.json({ ok: false, refused }, { headers, status: 422 });
  }
  const told = await read.call.windowNotices.announceIsoNudge({ notice });
  if (told.kind === "refused") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 409 });
  }
  if (told.kind === "failed") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ already: told.kind === "already", ok: true }, { headers });
}
