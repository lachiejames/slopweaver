/**
 * Claim one tool call a plan call's delegated thread made, before the page runs it.
 *
 * The events stream can hand the page a tool call the server has already settled — its event sat in a buffer past
 * the pending-tool timeout, or a reloaded page was replayed one it had answered — and the answer route refusing it
 * afterwards is too late, because by then the tool has run. So the page runs a tool only once this route says the
 * token still stands for a waiting call no one has claimed.
 */
import { NextResponse } from "next/server";

import { str } from "../../../../../../lib/bag";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { processTriagePresented } from "../../../../../../lib/triagePresented";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest claim body taken: a token, and nothing else. */
const CLAIM_MAX_BYTES = 1024;

/** What the page is answered. */
export type TalkCallClaimResult = { readonly ok: true } | { readonly ok: false; readonly refused: string };

/**
 * Claim the tool call.
 *
 * @param request the press, whose JSON body is `{ token, claimant }`
 * @param context the call id
 * @returns `ok` when the page may run it, or why it may not
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallClaimResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: CLAIM_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const token = str({ bag: read.body, key: "token" });
  const claimant = str({ bag: read.body, key: "claimant" });
  if (token === undefined || claimant === undefined) {
    return NextResponse.json({ ok: false, refused: "the body is not { token, claimant }" }, { headers, status: 400 });
  }
  const claimed = read.call.claim({ claimant, token });
  if (claimed.kind === "refused") {
    return NextResponse.json({ ok: false, refused: claimed.reason }, { headers, status: 409 });
  }
  // Before the page runs it: a call that may stop the triage clock clears the due card here, whatever then becomes
  // of its answer.
  processTriagePresented().claimed({
    call: read.call,
    rawArguments: claimed.arguments,
    token,
    tool: claimed.tool,
    turnId: claimed.turnId,
  });
  return NextResponse.json({ ok: true }, { headers });
}
