/**
 * Stop a plan call: tell its app-server to stop realtime, kill it, and forget the call. Idempotent — a call
 * already gone answers `wasLive: false`, which a hang-up racing the call's own close is not an error.
 *
 * The page posts this on hang-up and, with `keepalive`, when it is going away; the absent-stream grace in
 * `talkPlanCallWire.ts` is what ends a call whose page vanished without managing either. A page reloaded after the voice
 * window's renderer died posts it with the crash as its `reason` (`lib/talkCallStop.ts`), so the call ends at once
 * and says why.
 */
import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../../../lib/consolePress";
import { planCallById } from "../../../../../../lib/talkCallRegistry";
import { parseTalkCallStopRequest } from "../../../../../../lib/talkCallStop";

/** Never prerendered: it ends a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** What the page is answered. */
export type TalkCallStopResult =
  { readonly ok: true; readonly wasLive: boolean } | { readonly ok: false; readonly refused: string };

/**
 * Stop the call.
 *
 * @param request the press, with any JSON body
 * @param context the call id
 * @returns whether a live call was stopped
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallStopResult>> {
  const headers = { "cache-control": "no-store" };
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return NextResponse.json({ ok: false, refused }, { headers, status: 403 });
  }
  const parsed = parseTalkCallStopRequest({ raw: await request.text() });
  if (parsed.kind === "refused") {
    return NextResponse.json({ ok: false, refused: parsed.why }, { headers, status: 400 });
  }
  const { id } = await context.params;
  const call = planCallById({ id });
  if (call === undefined) {
    return NextResponse.json({ ok: true, wasLive: false }, { headers });
  }
  call.stop({ reason: parsed.reason });
  return NextResponse.json({ ok: true, wasLive: true }, { headers });
}
