/**
 * One message the owner typed or pasted into the Messenger box while a voice call is up, handed to that call's voice as
 * their own turn (`PlanCall.typeIn`, `site/lib/talkPlanCall.ts`). A pasted Slack thread link needs a way to reach the
 * voice, so the box works during a call.
 *
 * No call id in the path: the window the owner types in may not be the one holding the call, so the server finds the one
 * live voice call itself (`liveVoiceCallOf`, `site/lib/talkArbiter.ts`) and refuses rather than guesses when there are
 * two, or when the one up was made after the owner pressed send. The body is `{ messageId, pressedMs, text }`; the id is the
 * page's own, so a retry of a send whose answer was lost is answered `already` and never reaches the voice twice. What the voice makes of it reaches the holding page on the
 * call's own event stream, never in this answer.
 */
import { NextResponse } from "next/server";

import { TYPED_MESSAGE_ID_MAX_CHARS, TYPED_TEXT_MAX_CHARS } from "../../../../lib/planCallContract";
import { liveVoiceCallOf } from "../../../../lib/talkArbiter";
import { livePlanCalls } from "../../../../lib/talkCallRegistry";
import { readConsoleBody } from "../../../../lib/talkCallRequest";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: the longest message, every character escaped at its widest, with room for the id. */
const TYPED_IN_MAX_BYTES = TYPED_TEXT_MAX_CHARS * 6 + 1024;

/** What the page is answered. */
export type TalkTypedInResult =
  | { readonly ok: true; readonly already: boolean }
  | {
      readonly ok: false;
      readonly refused: string;
      /** The voice may have been handed it after all, so the page never sends it again under a new id. */
      readonly ambiguous: boolean;
      /** Set when no voice call is up, the one answer the page goes back to typing on. */
      readonly gone?: boolean;
    };

/**
 * Hand the owner's message to the live call's voice.
 *
 * @param request the press, with a `{ messageId, pressedMs, text }` JSON body
 * @returns whether the voice was handed it (or had been), or why not
 */
export async function POST(request: Request): Promise<NextResponse<TalkTypedInResult>> {
  const headers = { "cache-control": "no-store" };
  const refuse = ({ refused, status, ambiguous = false }: { refused: string; status: number; ambiguous?: boolean }) =>
    NextResponse.json<TalkTypedInResult>({ ambiguous, ok: false, refused }, { headers, status });
  const read = await readConsoleBody({ maxBytes: TYPED_IN_MAX_BYTES, request });
  if ("refused" in read) {
    return refuse(read);
  }
  const messageId = read.body["messageId"];
  const text = read.body["text"];
  if (typeof messageId !== "string" || messageId === "" || messageId.length > TYPED_MESSAGE_ID_MAX_CHARS) {
    return refuse({ refused: "the body carries no messageId of 1 to 128 characters", status: 400 });
  }
  if (typeof text !== "string" || text.trim() === "" || text.length > TYPED_TEXT_MAX_CHARS) {
    const refused = `the message is not text of 1 to ${String(TYPED_TEXT_MAX_CHARS)} characters`;
    return refuse({ refused, status: 400 });
  }
  const pressedMs = read.body["pressedMs"];
  if (typeof pressedMs !== "number" || !Number.isFinite(pressedMs)) {
    return refuse({ refused: "the body carries no pressedMs instant", status: 400 });
  }
  const pick = liveVoiceCallOf({ live: livePlanCalls(), pressedMs });
  if (pick.kind === "none") {
    return NextResponse.json<TalkTypedInResult>(
      { ambiguous: false, gone: true, ok: false, refused: pick.reason },
      { headers, status: 404 },
    );
  }
  if (pick.kind === "several" || pick.kind === "newer") {
    return refuse({ refused: pick.reason, status: 409 });
  }
  const typed = await pick.call.typeIn({ messageId, text });
  if (typed.kind === "sent" || typed.kind === "already") {
    return NextResponse.json<TalkTypedInResult>({ already: typed.kind === "already", ok: true }, { headers });
  }
  if (typed.kind === "refused") {
    return refuse({ refused: typed.reason, status: 409 });
  }
  if (typed.kind === "failed") {
    return refuse({ refused: typed.reason, status: 424 });
  }
  return refuse({ ambiguous: true, refused: typed.reason, status: 504 });
}
