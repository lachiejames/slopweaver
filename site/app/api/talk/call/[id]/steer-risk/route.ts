/**
 * A deliverable the owner explicitly steered is at risk, read by this server and said by the voice once per note, cutting
 * in (`WindowNoticeLines.announceSteerRisk` in `site/lib/talkPlanWindowNotices.ts`; the page's watch is
 * `site/lib/steerRiskWatch.ts`).
 *
 * A steered deliverable at risk gets a floating note AND a voice cut-in the minute it is known. The page posts nothing
 * but the ask; this route reads the open steer notes itself with `talk steer-risk`, so
 * the risk the voice names is a read this server made and the same one the owner's screen shows, never one a page asserted.
 * Worked example, and why: `docs/doctrine-rationale/explicit-steer.md`.
 */
import { NextResponse } from "next/server";

import { spawnVerb } from "../../../../../../lib/spawnVerb";
import { type SteerRiskAnswer, type SteerRiskNotice, steerRiskAnswerOf } from "../../../../../../lib/steerRiskNotice";
import { planCallContextById } from "../../../../../../lib/talkCallRegistry";
import { readCallRequest } from "../../../../../../lib/talkCallRequest";
import { steerRiskClaimId } from "../../../../../../lib/talkNoticeLedger";
import { talkToolFailureDetail } from "../../../../../../lib/talkToolFailure";

/** Never prerendered: it writes to a live call. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body taken: the page posts an empty object. */
const STEER_RISK_MAX_BYTES = 256;

/** How long the register read may take: one local file, well inside the page's own wait. */
const STEER_RISK_READ_MS = 15_000;

/** The verb line, for the reason a failure names. */
const STEER_RISK_TITLE = "talk steer-risk";

/** What the page is answered. */
export type TalkCallSteerRiskResult =
  | {
      readonly ok: true;
      /** The note the voice cut in with, or had already; `null` when no steer note is open and unsaid. */
      readonly said: SteerRiskNotice | null;
      readonly already: boolean;
    }
  | { readonly ok: false; readonly refused: string };

/**
 * Read the open steer notes with `talk steer-risk`, strictly.
 *
 * @returns the notes, or why the read gave none
 */
async function readSteerRisk(): Promise<SteerRiskAnswer | { refused: string }> {
  const ran = await spawnVerb({
    argv: ["talk", "steer-risk", "--json"],
    timeoutMs: STEER_RISK_READ_MS,
    title: STEER_RISK_TITLE,
  });
  if (!ran.ok) {
    return { refused: talkToolFailureDetail({ outcome: ran, title: STEER_RISK_TITLE }) };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(ran.out);
  } catch {
    return { refused: `${STEER_RISK_TITLE} did not print JSON` };
  }
  const answer = steerRiskAnswerOf({ value: payload });
  if (answer === undefined) {
    return { refused: `${STEER_RISK_TITLE} printed an answer this console cannot read` };
  }
  return answer;
}

/**
 * Read the open steer notes, and have the voice cut in with the first one no call of this server has said.
 *
 * @param request the page's post: `{}`
 * @param context the call id
 * @returns the note said (or said already), none, or why not — a 409 when the floor refused it and a retry will do, a
 *   424 when the write failed, a 502 when the read failed
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse<TalkCallSteerRiskResult>> {
  const headers = { "cache-control": "no-store" };
  const { id } = await context.params;
  const read = await readCallRequest({ id, maxBytes: STEER_RISK_MAX_BYTES, request });
  if ("refused" in read) {
    return NextResponse.json({ ok: false, refused: read.refused }, { headers, status: read.status });
  }
  if (read.call.surface !== "voice") {
    const refused = "a typed conversation has no voice to say a steered deliverable is at risk";
    return NextResponse.json({ ok: false, refused }, { headers, status: 422 });
  }
  // The call's own ledger, read before the register's await: a test call claims in its own, never the owner's.
  const held = planCallContextById({ id: read.call.id });
  if (held === undefined) {
    return NextResponse.json({ ok: false, refused: "the call has ended" }, { headers, status: 404 });
  }
  const notes = await readSteerRisk();
  if ("refused" in notes) {
    return NextResponse.json({ ok: false, refused: notes.refused }, { headers, status: 502 });
  }
  const ledger = held.notices;
  const notice = notes.notices.find((one) => !ledger.has({ claimId: steerRiskClaimId({ stepId: one.stepId }) }));
  if (notice === undefined && notes.unreadLines > 0) {
    // A line that would not read may be the very note the voice is owed, so this is a failed read, never "none open".
    const refused = `${String(notes.unreadLines)} hand-register line(s) would not read, so a steer note may be unsaid`;
    return NextResponse.json({ ok: false, refused }, { headers, status: 502 });
  }
  if (notice === undefined) {
    return NextResponse.json({ already: false, ok: true, said: null }, { headers });
  }
  const told = await read.call.windowNotices.announceSteerRisk({ notice });
  if (told.kind === "refused") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 409 });
  }
  if (told.kind === "failed") {
    return NextResponse.json({ ok: false, refused: told.reason }, { headers, status: 424 });
  }
  return NextResponse.json({ already: told.kind === "already", ok: true, said: notice }, { headers });
}
