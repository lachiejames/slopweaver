/**
 * A Slack send the owner asked for on this call that was held or failed, handed to the voice so it tells them unasked
 * (`PlanCall.announceSendOutcome` in `site/lib/talkPlanCall.ts`; the page's watch is `site/lib/slackSendWatch.ts`).
 *
 * Without this the voice can confirm a reply the as-me gates held, and nothing tells the owner. The page posts only WHICH send — its Slack link and the instant the owner asked — and this
 * route reads the outcome itself with `talk slack-send-outcome`, so what the voice is told is a read this server made,
 * never an outcome a page asserted. The developer message is the server's. A send that went is refused
 * (`SENT_SINCE_REFUSAL`) and never handed over, since saying it is sent now is not useful.
 */
import { NextResponse } from "next/server";

import {
  checkSendOf,
  SENT_SINCE_REFUSAL,
  SENT_SINCE_STATUS,
  sendNoticeId,
  terminalSlackSendOutcomeOf,
} from "../../../../../../lib/slackSendWatch";
import { spawnVerb } from "../../../../../../lib/spawnVerb";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { talkToolFailureDetail } from "../../../../../../lib/talkToolFailure";
import { talkArgvFor, talkToolFor } from "../../../../../../lib/talkTools";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: one Slack link and one instant, with room. */
const SEND_OUTCOME_MAX_BYTES = 4_096;

/** What the page is answered. */
export type TalkCallSendOutcomeResult =
  { readonly ok: true; readonly already: boolean } | { readonly ok: false; readonly refused: string };

/**
 * Read one Slack send's outcome, and hand the voice it when it is terminal.
 *
 * @param request the page's post: `{ send: { url, since } }`
 * @param context the call id
 * @returns whether the voice was handed it (or had been), or why not — a 409 when there is no outcome to tell yet
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallSendOutcomeResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: SEND_OUTCOME_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  const send = checkSendOf({ value: read.body["send"] });
  const tool = talkToolFor({ name: "slack_send_outcome" });
  if (send === undefined) {
    const refused = "send must be a Slack message link and the ISO instant the owner asked for it";
    return NextResponse.json({ ok: false, refused }, { headers, status: 400 });
  }
  if (tool?.where !== "verb") {
    const refused = "slack_send_outcome is not a verb tool, so this server cannot read the send";
    return NextResponse.json({ ok: false, refused }, { headers, status: 500 });
  }
  const built = talkArgvFor({ args: { since: send.since, url: send.url }, tool });
  if (built.kind === "refused") {
    return NextResponse.json({ ok: false, refused: built.why }, { headers, status: 400 });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: tool.timeoutMs, title: tool.title });
  if (!ran.ok) {
    const refused = talkToolFailureDetail({ outcome: ran, title: tool.title });
    return NextResponse.json({ ok: false, refused }, { headers, status: 409 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(ran.out);
  } catch {
    return NextResponse.json({ ok: false, refused: `${tool.title} did not print JSON` }, { headers, status: 409 });
  }
  const outcome = terminalSlackSendOutcomeOf({ value: payload });
  if (outcome === undefined) {
    return NextResponse.json({ ok: false, refused: "the send has no outcome to tell yet" }, { headers, status: 409 });
  }
  if (outcome.state === "sent") {
    // Read again here, a send the page saw held may have gone since: never said unasked, and never offered again.
    return NextResponse.json({ ok: false, refused: SENT_SINCE_REFUSAL }, { headers, status: SENT_SINCE_STATUS });
  }
  const told = await read.call.announceSendOutcome({ noticeId: sendNoticeId({ send }), outcome });
  if (told.kind === "refused") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 409 });
  }
  if (told.kind === "failed") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ already: told.kind === "already", ok: true }, { headers });
}
