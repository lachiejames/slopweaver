/**
 * A count of the owner's Queue the voice just said that the app does not show, kept as the call's provenance
 * (`PlanCall.recordGrounding` in `site/lib/talkPlanCall.ts`; the page's check is `site/lib/talkCountGrounding.ts`), so
 * the thread answering "where did that come from" can say. It is never handed back to the voice.
 *
 * A count the voice says that the app does not show is a mismatch: the voice said "That covers fourteen cards"
 * while the app showed Everything 29. Handing that back as a correction made the voice say "Everything's
 * ninety-three." out of nowhere. The page posts only the structured claim — a key, a subject from a closed set, a
 * number, the app's labelled figures and whether the thread wrote it (`countGroundingOf`) — and the entry's words are
 * the server's (`countGroundingEntry`).
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { countGroundingEntry, countGroundingOf } from "../../../../../../lib/talkVoiceRecord";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: a key, a subject, a number and nine labelled figures, with room. */
const COUNT_GROUNDING_MAX_BYTES = 4_096;

/** What the page is answered. */
export type TalkCallCountGroundingResult = { readonly ok: true } | { readonly ok: false; readonly refused: string };

/**
 * Keep one count grounding.
 *
 * @param request the page's post: `{ grounding: { key, claimed, subject, expected: [{ label, count }], fromThread } }`
 * @param context the call id
 * @returns whether it was kept, now or already, or why not — a 409 once the call has ended
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallCountGroundingResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: COUNT_GROUNDING_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const grounding = countGroundingOf({ value: read.body["grounding"] });
  if ("refused" in grounding) {
    return NextResponse.json({ ok: false, refused: grounding.refused }, { headers, status: 400 });
  }
  const { text, why } = countGroundingEntry({ grounding });
  const kept = read.call.recordGrounding({ post: { key: grounding.key, source: "count-grounding", text, why } });
  if (kept.kind === "refused") {
    return NextResponse.json({ ok: false, refused: kept.reason }, { headers, status: 409 });
  }
  return NextResponse.json({ ok: true }, { headers });
}
