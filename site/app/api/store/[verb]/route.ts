import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { spawnVerb } from "../../../../lib/spawnVerb";
import { type StoreReadResponse, storeReadOutcomeOf, storeReadVerbFor } from "../../../../lib/storeReadVerbs";

/** Never prerendered: every request reads the store now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** The largest body a store read may carry: a page, a sort, a filter of up to two thousand characters, a locator. */
const BODY_MAX_BYTES = 16 * 1024;

/**
 * Run one read the Store page asked for.
 *
 * POST rather than GET although nothing here writes, so a filter value or a row locator never lands in a URL, the
 * browser's history, an access log or a prefetch; and behind the same same-origin guard the act route uses
 * (`consolePress.ts`), so a page on another origin cannot read the store through this server. The body is exactly the
 * fields the slug's row declares (`storeReadVerbs.ts`), the argv is built there and nowhere else, and the child is the
 * serving checkout's `bin/slopweaver` (`spawnVerb.ts`). Neither a body, a value nor the child's output is ever logged.
 *
 * @param request the read, whose JSON body carries exactly the row's declared fields
 * @param context the dynamic segment, which is the read's slug
 * @returns the verb's one JSON document, or why there is none; a 404 for a slug the list does not hold
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ verb: string }> },
): Promise<NextResponse<StoreReadResponse | { readonly error: string }>> {
  const { verb: slug } = await context.params;
  const verb = storeReadVerbFor({ slug });
  if (verb === undefined) {
    return NextResponse.json({ error: `no store read named ${slug}` }, { status: 404 });
  }
  const headers = { "cache-control": "no-store" };
  const refuse = ({ why, status }: { why: string; status: number }): NextResponse<StoreReadResponse> =>
    NextResponse.json({ code: null, outcome: "refused", why }, { headers, status });
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return refuse({ status: 403, why: refused });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return refuse({
      status: 413,
      why: `the body is ${String(raw.length)} bytes; the console carries up to ${String(BODY_MAX_BYTES)}`,
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse({ status: 400, why: "the body is not JSON" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse({ status: 400, why: "the body is not an object of fields" });
  }
  const built = verb.build({ request: Object.fromEntries(Object.entries(body)) });
  if (built.kind === "refused") {
    return refuse({ status: 400, why: built.why });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: verb.timeoutMs, title: verb.title });
  const answer = storeReadOutcomeOf({ ran, title: verb.title });
  if (answer.outcome === "read") {
    return NextResponse.json(answer, { headers });
  }
  // Killed on the timeout or never launched has no exit code; a verb that refused does.
  const status = !ran.ok && ran.exitCode === undefined ? 504 : 422;
  return NextResponse.json(answer, { headers, status });
}
