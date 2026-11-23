/**
 * The voice says it is looking: the owner asked it to look at their screen and the turn was handed off, so it says one fixed
 * line now rather than nothing until the look is answered (`PlanCall.sayLooking` in `site/lib/talkPlanCall.ts`).
 *
 * Silence while the look runs reads as ignored, so the voice acknowledges it is looking. A lookup the owner asked for
 * gets "finding it" the same way. The body carries only
 * which of the two it was, from a closed set: what the voice says is this server's sentence, never the page's words.
 */
import { NextResponse } from "next/server";

import { lookAskOf } from "../../../../../../lib/lookAck";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: `{"ask":"find"}`, with room. */
const LOOK_MAX_BYTES = 256;

/** What the page is answered. */
export type TalkCallLookResult =
  { readonly ok: true; readonly said: string } | { readonly ok: false; readonly refused: string };

/**
 * Have the voice say it is looking.
 *
 * @param request the page's post, `{ ask: "look" | "find" }`
 * @param context the call id
 * @returns the line the voice was asked to say, or why it was not
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallLookResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: LOOK_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const ask = lookAskOf({ body: read.body });
  if (ask === undefined) {
    return NextResponse.json({ ok: false, refused: 'ask must be "look" or "find"' }, { headers, status: 400 });
  }
  const looked = await read.call.sayLooking({ ask });
  if (looked.kind === "refused") {
    return NextResponse.json({ ok: false, refused: looked.reason }, { headers, status: 409 });
  }
  if (looked.kind === "failed") {
    // The server knows it was not said: a definite answer the page logs, never a lost one it cannot place.
    return NextResponse.json({ ok: false, refused: looked.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ ok: true, said: looked.text }, { headers });
}
