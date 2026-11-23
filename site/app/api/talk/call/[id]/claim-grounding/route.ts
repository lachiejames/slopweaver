/**
 * A done claim, a pull request number, a fleet promise or a running-list claim the voice just said that nothing on the call
 * grounds, kept as the call's provenance
 * (`PlanCall.recordGrounding` in `site/lib/talkPlanCall.ts`; the page's check is `site/lib/talkSpokenClaims.ts`), so the
 * thread answering "why did you say that" can say where it came from. A done claim, a fleet promise or a running-list
 * claim kept now is also owed the voice's fixed correction aloud (`site/lib/talkPlanCompletionCorrection.ts`); a pull request number or a repeated ask is never
 * handed back to the voice.
 *
 * A voice saying "Draft sent." with nothing sent is the failure this guards. The page posts only the closed shape — a key,
 * and an act from the closed set, a whole pull request number, or a kind alone (`claimGroundingOf`) — and every word, the
 * entry's and the correction's, is the server's (`claimGroundingEntry`, `claimCorrectionSpeech`).
 */
import { NextResponse } from "next/server";

import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { claimGroundingEntry, claimGroundingOf } from "../../../../../../lib/talkSpokenClaims";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: a key, a kind and one field, with room. */
const CLAIM_GROUNDING_MAX_BYTES = 1_024;

/** What the page is answered. */
export type TalkCallClaimGroundingResult = { readonly ok: true } | { readonly ok: false; readonly refused: string };

/**
 * Keep one claim grounding.
 *
 * @param request the page's post: `{ grounding: { key, kind: "outcome", act } | { key, kind: "pr-number", claimed } |
 *   { key, kind: "repeated-ask" | "fleet-promise" | "running-list" } }`
 * @param context the call id
 * @returns whether it was kept, now or already, or why not — a 409 once the call has ended
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallClaimGroundingResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: CLAIM_GROUNDING_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const grounding = claimGroundingOf({ value: read.body["grounding"] });
  if ("refused" in grounding) {
    return NextResponse.json({ ok: false, refused: grounding.refused }, { headers, status: 400 });
  }
  const { text, why } = claimGroundingEntry({ grounding });
  const kept = read.call.recordGrounding({ post: { key: grounding.key, source: "claim-grounding", text, why } });
  if (kept.kind === "refused") {
    return NextResponse.json({ ok: false, refused: kept.reason }, { headers, status: 409 });
  }
  // Owed only when kept NOW: the page's retry of a post already kept is `already` and owes nothing more.
  if (kept.kind === "recorded" && grounding.kind === "outcome") {
    read.call.corrections.owe({ claim: { act: grounding.act, kind: "outcome" }, key: grounding.key });
  }
  if (kept.kind === "recorded" && (grounding.kind === "fleet-promise" || grounding.kind === "running-list")) {
    read.call.corrections.owe({ claim: { kind: grounding.kind }, key: grounding.key });
  }
  return NextResponse.json({ ok: true }, { headers });
}
