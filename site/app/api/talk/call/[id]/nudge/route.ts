/**
 * The owner's nudge on a plan call: the voice is handed this server's developer message and answers their last words, and any
 * Codex turn running at the press is stopped (`PlanCall.nudge` in `site/lib/talkPlanCall.ts`). If the voice hands
 * nothing to Codex, the server starts the turn itself (`site/lib/talkPlanOwedTurn.ts`).
 *
 * A voice stuck mid-call needs a nudge button the owner can reach. The
 * body carries only which press it was (`site/lib/talkNudgeBody.ts`) — the owner's, or the page's own over a
 * promise the voice never started — and what the voice is handed is this server's
 * sentence, never the page's words.
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { NUDGE_BODY_REFUSAL, nudgeBodyOf } from "../../../../../../lib/talkNudgeBody";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest nudge body taken: an empty object, with room. */
const NUDGE_MAX_BYTES = 256;

/** What the page is answered. */
export type TalkCallNudgeResult =
  | { readonly ok: true; readonly interrupted: number; readonly notInterrupted: number }
  | { readonly ok: false; readonly refused: string };

/**
 * Nudge the call.
 *
 * @param request the press, `{}` for the owner's and `{ promised: true }` for the page's own
 * @param context the call id
 * @returns how many Codex turns were stopped once the voice was asked to speak, or why it was not
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallNudgeResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: NUDGE_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const press = nudgeBodyOf({ body: read.body });
  if (press === undefined) {
    return NextResponse.json({ ok: false, refused: NUDGE_BODY_REFUSAL }, { headers, status: 400 });
  }
  const nudged = await read.call.nudge({ promised: press.promised });
  if (nudged.kind === "refused") {
    return NextResponse.json({ ok: false, refused: nudged.reason }, { headers, status: 409 });
  }
  if (nudged.kind === "failed") {
    // The server knows it was not sent: a definite answer the page shows, never a lost one it cannot place.
    return NextResponse.json({ ok: false, refused: nudged.reason }, { headers, status: 424 });
  }
  const { interrupted, notInterrupted } = nudged;
  return NextResponse.json(
    { interrupted: interrupted.length, notInterrupted: notInterrupted.length, ok: true },
    { headers },
  );
}
