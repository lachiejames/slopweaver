import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../../lib/consolePress";
import { spawnVerb } from "../../../../../lib/spawnVerb";
import { talkToolFailureDetail } from "../../../../../lib/talkToolFailure";
import { talkArgvFor, talkToolFor } from "../../../../../lib/talkTools";

/** Never prerendered: the whole point of the request is that it reads the checkout now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * What one tool call came to, as the tab hands it back to the model.
 *
 * A refusal is a RESULT rather than an HTTP error, all the way down, because the model has to be able to
 * read it: a tool call that comes back as a transport failure leaves it guessing, while one that comes
 * back saying "that path is not tracked" is something it can act on and say out loud. Only the shape
 * checks in front of the verb answer with a status of their own, and those cannot reach the model at all.
 */
export type TalkToolResult =
  | { readonly ok: true; readonly payload: unknown; readonly tookMs: number }
  | { readonly ok: false; readonly refused: string };

/** The largest tool call a model may send — one literal search string and a couple of numbers. */
const BODY_MAX_BYTES = 8 * 1024;

/**
 * Run one read tool.
 *
 * Every guard the act route applies applies here too, and one more that matters more: a name the closed
 * list does not hold is a 404 before anything is parsed, and a `page` tool is refused here rather than
 * silently handled, because a `page` tool reaching the server at all means the tab dispatched something
 * it should have answered itself.
 *
 * @param request the call, whose JSON body is the model's `arguments` object
 * @param context the dynamic segment, which is the tool name
 * @returns what the verb printed, or the stated refusal
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<NextResponse<TalkToolResult | { readonly error: string }>> {
  const { name } = await context.params;
  const tool = talkToolFor({ name });
  if (tool === undefined) {
    return NextResponse.json({ error: `no talk tool named ${name}` }, { status: 404 });
  }
  const headers = { "cache-control": "no-store" };
  if (tool.where === "page") {
    return NextResponse.json(
      { error: `${name} is answered by the page out of what it is already showing, not by this route` },
      { headers, status: 404 },
    );
  }
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    return NextResponse.json({ ok: false, refused: refusedPress }, { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        refused: `the call is ${String(raw.length)} bytes; a tool call carries up to ${String(BODY_MAX_BYTES)}`,
      },
      { headers, status: 413 },
    );
  }
  let args: unknown;
  try {
    args = JSON.parse(raw === "" ? "{}" : raw);
  } catch {
    return NextResponse.json({ ok: false, refused: "the arguments are not JSON" }, { headers, status: 400 });
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return NextResponse.json({ ok: false, refused: "the arguments are not an object" }, { headers, status: 400 });
  }
  const built = talkArgvFor({ args: Object.fromEntries(Object.entries(args)), tool });
  if (built.kind === "refused") {
    return NextResponse.json({ ok: false, refused: built.why }, { headers, status: 400 });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: tool.timeoutMs, title: tool.title });
  if (!ran.ok) {
    // The model is told in words rather than left with a failed fetch, and a refusal reaches it WHOLE —
    // `talkToolFailure.ts` says why the three-line tail every other route reports is not enough here.
    return NextResponse.json(
      { ok: false, refused: talkToolFailureDetail({ outcome: ran, title: tool.title }) },
      { headers, status: 200 },
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(ran.out);
  } catch {
    const head = ran.out.trim().slice(0, 120);
    return NextResponse.json(
      { ok: false, refused: `${tool.title} printed something that is not JSON, beginning \`${head}\`` },
      { headers, status: 200 },
    );
  }
  return NextResponse.json({ ok: true, payload, tookMs: ran.tookMs }, { headers });
}
