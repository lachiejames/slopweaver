/**
 * The frame the page took the moment the owner asked the voice to look, steered into the Codex turn answering them or
 * starting it (`PlanCall.attachLook` in `site/lib/talkPlanCall.ts`), so the reply is drawn from the screen as they saw it rather
 * than from whether the thread chose to call `read_screen`.
 *
 * A look request is answered as if the voice had just looked. The body carries the picture and nothing else; the words beside it are this server's.
 */
import { NextResponse } from "next/server";

import { str } from "../../../../../../lib/bag";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { PLAN_ANSWER_MAX_BYTES } from "../../../../../../lib/talkPlanProtocolItems";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** What the page is answered. */
export type TalkCallFrameResult =
  { readonly ok: true; readonly turnId: string } | { readonly ok: false; readonly refused: string };

/**
 * Steer the frame into the running turn, or start one with it.
 *
 * @param request the page's post, whose JSON body is `{ imageUrl }`, a `data:image/` URL bounded like a tool answer
 * @param context the call id
 * @returns the turn the frame reached, or why it did not
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallFrameResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: PLAN_ANSWER_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const imageUrl = str({ bag: read.body, key: "imageUrl" });
  if (imageUrl === undefined) {
    return NextResponse.json({ ok: false, refused: "the body is not { imageUrl }" }, { headers, status: 400 });
  }
  const framed = await read.call.attachLook({ imageUrl });
  if (framed.kind === "refused") {
    return NextResponse.json({ ok: false, refused: framed.reason }, { headers, status: 409 });
  }
  if (framed.kind === "failed") {
    // The child answered that the turn did not take it: a definite answer the page logs, never a lost one.
    return NextResponse.json({ ok: false, refused: framed.reason }, { headers, status: 424 });
  }
  if (framed.kind === "unsure") {
    // Written and unanswered: a 5xx, which the page logs as lost because nobody can say whether it landed.
    return NextResponse.json({ ok: false, refused: framed.reason }, { headers, status: 504 });
  }
  return NextResponse.json({ ok: true, turnId: framed.turnId }, { headers });
}
