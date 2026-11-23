/**
 * The voice takes its turn: the owner's words went unanswered and the page judged the silence not theirs, so the voice is handed
 * one fixed sentence it answers in its own words (`PlanCall.resume` in `site/lib/talkPlanCall.ts`) — or, when Codex's
 * words are held for the owner, those words instead, since they are the answer owed. If the voice hands nothing to Codex,
 * the server starts the turn itself (`site/lib/talkPlanOwedTurn.ts`).
 *
 * After a steer the voice drives the conversation onto the next thing, rather than leaving the presence idle. The body carries nothing: what the voice reads is
 * this server's sentence, never the page's words.
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: an empty object, with room. */
const RESUME_MAX_BYTES = 256;

/** What the page is answered. */
export type TalkCallResumeResult = { readonly ok: true } | { readonly ok: false; readonly refused: string };

/**
 * Have the voice take its turn.
 *
 * @param request the page's post, with an empty JSON body
 * @param context the call id
 * @returns whether the voice was handed the sentence or the held answer, or why it was not
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallResumeResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: RESUME_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const resumed = await read.call.resume();
  if (resumed.kind === "refused") {
    return NextResponse.json({ ok: false, refused: resumed.reason }, { headers, status: 409 });
  }
  if (resumed.kind === "failed") {
    // The server knows it was not handed over: a definite answer the page logs, never a lost one it cannot place.
    return NextResponse.json({ ok: false, refused: resumed.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ ok: true }, { headers });
}
