/**
 * A triage card's clock is up, handed to the voice so it says so and the owner's ways out follow (`PlanCall.announceTriageDue`
 * in `site/lib/talkPlanCall.ts`; the page's clock is `site/components/voice/useTriageWalk.ts`).
 *
 * The voice needs a built-in timer so it can say when the card's clock is up. The page posts only the visit's id,
 * which the call says once; the developer message is
 * the server's (`TRIAGE_DUE_TEXT`), so no page words reach the voice. A typed conversation has no voice to say it, so
 * there the menu bar's countdown and the page's chime are the whole clock.
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { processTriagePresented } from "../../../../../../lib/triagePresented";
import { triageVisitIdOf } from "../../../../../../lib/triageWalk";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: one visit id, with room. */
const TRIAGE_DUE_MAX_BYTES = 1_024;

/** What the page is answered. */
export type TalkCallTriageDueResult =
  { readonly ok: true; readonly already: boolean } | { readonly ok: false; readonly refused: string };

/**
 * Hand the voice one triage card's time-up line.
 *
 * @param request the page's post: `{ visitId }`
 * @param context the call id
 * @returns whether the voice was handed it (or had been), or why not — a 403 for a visit no `triage_next` answer put
 *   in front of the owner (`site/lib/triagePresented.ts`), a 409 when the floor refused it and a retry will do, a 424 when
 *   the write failed
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallTriageDueResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: TRIAGE_DUE_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const visitId = triageVisitIdOf({ value: read.body["visitId"] });
  if (visitId === undefined) {
    return NextResponse.json({ ok: false, refused: "visitId must be a triage visit id" }, { headers, status: 400 });
  }
  if (read.call.surface !== "voice") {
    const refused = "a typed conversation has no voice to say a triage clock";
    return NextResponse.json({ ok: false, refused }, { headers, status: 422 });
  }
  if (!processTriagePresented().holds({ call: read.call, visitId })) {
    const refused =
      "that visit is not the triage card a triage_next answer put in front of the owner, or a newer call has taken it on";
    return NextResponse.json({ ok: false, refused }, { headers, status: 403 });
  }
  const told = await read.call.announceTriageDue({ visitId });
  if (told.kind === "refused") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 409 });
  }
  if (told.kind === "failed") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ already: told.kind === "already", ok: true }, { headers });
}
