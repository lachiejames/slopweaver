/**
 * The call's completed speech a starting Codex turn has not had, steered into that turn as quoted data
 * (`PlanCall.steerSpokenRecord` in `site/lib/talkPlanCall.ts`; the page's coordinator is
 * `site/components/voice/voiceRecordWiring.ts`).
 *
 * Measured: asked where its own "fourteen cards" came from, the voice said it had not said it. The thread answering
 * that question never saw the voice's words. The page posts the lines, bounded
 * (`spokenRecordOf`); the delimiters and the escaping are the server's (`spokenRecordText`). With them goes the draft
 * of the card the owner's words began over, so "what is the reply?" needs no card tool.
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { SPOKEN_RECORD_MAX_BODY_BYTES, spokenRecordOf } from "../../../../../../lib/talkVoiceRecord";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** What the page is answered. `unsure` is a write whose answer was not read: the page keeps its lines. */
export type TalkCallSpokenRecordResult =
  | { readonly ok: true; readonly turnId: string }
  | { readonly ok: false; readonly refused: string; readonly unsure: boolean };

/**
 * Steer one spoken record into a running turn.
 *
 * @param request the page's post: `{ record: { turnId, lines: [{ id, who, text }], openCard? } }`
 * @param context the call id
 * @returns the turn that took it, or why not — 409 refused, 424 failed, 504 written with no answer read
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallSpokenRecordResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: SPOKEN_RECORD_MAX_BODY_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused, unsure: false }, { headers, status: read.status });
  }
  const record = spokenRecordOf({ value: read.body["record"] });
  if ("refused" in record) {
    return NextResponse.json({ ok: false, refused: record.refused, unsure: false }, { headers, status: 400 });
  }
  const steered = await read.call.steerSpokenRecord({ record });
  switch (steered.kind) {
    case "steered": {
      return NextResponse.json({ ok: true, turnId: steered.turnId }, { headers });
    }
    case "refused": {
      return NextResponse.json({ ok: false, refused: steered.reason, unsure: false }, { headers, status: 409 });
    }
    case "failed": {
      return NextResponse.json({ ok: false, refused: steered.reason, unsure: false }, { headers, status: 424 });
    }
    case "unsure": {
      return NextResponse.json({ ok: false, refused: steered.reason, unsure: true }, { headers, status: 504 });
    }
    default: {
      const never: never = steered;
      return never;
    }
  }
}
