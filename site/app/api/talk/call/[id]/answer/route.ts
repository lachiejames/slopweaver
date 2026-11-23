/**
 * Answer one tool call a plan call's delegated thread made, with what the page's executor produced.
 *
 * Not a JSON-RPC proxy: the body names an opaque token the events stream handed out and the answer's content
 * items, and the call writes exactly one response, to exactly the request that token stands for, once. The
 * page records the relay gate's "read" only after this route says `answered` — the model has it only then.
 */
import { NextResponse } from "next/server";

import { str } from "../../../../../../lib/bag";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { PLAN_ANSWER_MAX_BYTES, planContentItemsOf } from "../../../../../../lib/talkPlanProtocolItems";
import { processTriagePresented } from "../../../../../../lib/triagePresented";
import { triageVisitIdOf } from "../../../../../../lib/triageWalk";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** What the page is answered. */
export type TalkCallAnswerResult = { readonly ok: true } | { readonly ok: false; readonly refused: string };

/**
 * Answer the call.
 *
 * @param request the press, whose JSON body is `{ token, contentItems, success, claimant }`, and `triageVisit` on a
 *   `triage_next` answer that put a card in front of the owner — taken only beside a successful `triage_next` of a voice
 *   call (`site/lib/triagePresented.ts`), and ignored beside anything else, the answer itself still going through
 * @param context the call id
 * @returns `ok`, or why the answer did not reach the call
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallAnswerResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: PLAN_ANSWER_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const token = str({ bag: read.body, key: "token" });
  const contentItems = planContentItemsOf({ value: read.body["contentItems"] });
  const success = read.body["success"];
  const claimant = str({ bag: read.body, key: "claimant" });
  if (token === undefined || claimant === undefined || contentItems === undefined || typeof success !== "boolean") {
    return NextResponse.json(
      {
        ok: false,
        refused: "the body is not { token, claimant, contentItems: [inputText | inputImage, …], success }",
      },
      { headers, status: 400 },
    );
  }
  const rawVisit = read.body["triageVisit"];
  const triageVisit = rawVisit === undefined ? undefined : triageVisitIdOf({ value: rawVisit });
  if (rawVisit !== undefined && triageVisit === undefined) {
    return NextResponse.json({ ok: false, refused: "triageVisit must be a triage visit id" }, { headers, status: 400 });
  }
  const answered = read.call.answer({ claimant, contentItems, success, token });
  if (answered.kind === "refused") {
    return NextResponse.json({ ok: false, refused: answered.reason }, { headers, status: 409 });
  }
  // Read only once the answer settled: which card is in front of the owner, for the time-up line (`triage-due`).
  processTriagePresented().answered({
    call: read.call,
    rawArguments: answered.arguments,
    success,
    token,
    tool: answered.tool,
    triageVisit,
  });
  return NextResponse.json({ ok: true }, { headers });
}
