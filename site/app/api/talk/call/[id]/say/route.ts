/**
 * One message the owner typed into the orb messenger's box, sent to the typed conversation it opened: one `turn/start` on its
 * thread (`TypedPlanSession.say` in `site/lib/talkTypedSession.ts`). What the thread writes back reaches the page on
 * the conversation's own event stream, never in this answer.
 *
 * The body is `{ messageId, text }`: the id is the page's own, so a retry of a send whose answer was lost answers
 * with the first one's outcome and never starts a second turn.
 */
import { NextResponse } from "next/server";

import { TYPED_MESSAGE_ID_MAX_CHARS, TYPED_TEXT_MAX_CHARS } from "../../../../../../lib/planCallContract";
import { typedSendRefusal } from "../../../../../../lib/talkArbiter";
import { liveConversations } from "../../../../../../lib/talkCallRegistry";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { TypedPlanSession } from "../../../../../../lib/talkTypedSession";

/** Never prerendered: it writes to a live thread. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: the longest message, every character escaped at its widest, with room for the id. */
const SAY_MAX_BYTES = TYPED_TEXT_MAX_CHARS * 6 + 1024;

/** What the page is answered. */
export type TalkCallSayResult =
  | { readonly ok: true; readonly turnId: string }
  | {
      readonly ok: false;
      readonly refused: string;
      readonly ambiguous: boolean;
      /** Set when no conversation holds the id, the one answer the page opens a fresh one and sends again on. */
      readonly gone?: boolean;
    };

/**
 * Send the message.
 *
 * @param request the press, with a `{ messageId, text }` JSON body
 * @param context the conversation's id
 * @returns the turn it started, or why none was — `ambiguous` when the thread may have taken it after all
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallSayResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: SAY_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json(
      { ambiguous: false, gone: read.status === 404, ok: false, refused: read.refused },
      { headers, status: read.status },
    );
  }
  const { body, call } = read;
  if (!(call instanceof TypedPlanSession)) {
    return NextResponse.json(
      {
        ambiguous: false,
        ok: false,
        refused: `${id} is a voice call; what the owner types goes to a typed conversation`,
      },
      { headers, status: 409 },
    );
  }
  const messageId = body["messageId"];
  const text = body["text"];
  if (typeof messageId !== "string" || messageId === "" || messageId.length > TYPED_MESSAGE_ID_MAX_CHARS) {
    return NextResponse.json(
      { ambiguous: false, ok: false, refused: "the body carries no messageId of 1 to 128 characters" },
      { headers, status: 400 },
    );
  }
  if (typeof text !== "string" || text.length > TYPED_TEXT_MAX_CHARS) {
    return NextResponse.json(
      {
        ambiguous: false,
        ok: false,
        refused: `the message is not text of at most ${String(TYPED_TEXT_MAX_CHARS)} characters`,
      },
      { headers, status: 400 },
    );
  }
  const busy = typedSendRefusal({ live: liveConversations({ nowMs: Date.now() }) });
  if (busy !== undefined) {
    return NextResponse.json({ ambiguous: false, ok: false, refused: busy }, { headers, status: 409 });
  }
  const said = await call.say({ messageId, text });
  if (said.kind === "accepted") {
    return NextResponse.json({ ok: true, turnId: said.turnId }, { headers });
  }
  return NextResponse.json(
    { ambiguous: said.kind === "ambiguous", ok: false, refused: said.reason },
    { headers, status: 409 },
  );
}
