import { NextResponse } from "next/server";

import { actVerbFor, buildActArgv } from "../../../../lib/actVerbs";
import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { forgetFlights } from "../../../../lib/liveFlights";
import { LIVE_FLIGHTS } from "../../../../lib/liveFlightsServer";
import { spawnVerb } from "../../../../lib/spawnVerb";

/** Never prerendered: the whole point of the request is that it runs a verb now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * What the panel receives from a press. Four outcomes, and the fourth is the one a two-armed shape would
 * have hidden: a verb killed on its timeout MAY have written its row before it died, so the panel is told
 * to re-read the register rather than told the act failed.
 */
export type ActResult =
  | { readonly outcome: "done"; readonly out: string; readonly tookMs: number; readonly startedAtIso: string }
  | { readonly outcome: "refused"; readonly why: string; readonly out: string; readonly startedAtIso: string }
  | { readonly outcome: "unknown"; readonly why: string; readonly startedAtIso: string };

/** The largest body a press may carry — two slots of two thousand characters, with room for the JSON. */
const BODY_MAX_BYTES = 16 * 1024;

/**
 * Take one act.
 *
 * POST, same-origin, JSON, a slug the closed list holds, and every slot checked against its declared
 * shape before anything is launched. A refusal from any of those is answered as `refused` with the
 * reason — the console's own four-line habit, applied to its one door that writes.
 *
 * @param request the press, whose JSON body carries exactly the row's declared slots
 * @param context the dynamic segment, which is the act slug
 * @returns the press's outcome, or a 404 for a slug the list does not hold — a page bug, not a refusal
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ verb: string }> },
): Promise<NextResponse<ActResult | { readonly error: string }>> {
  const { verb: slug } = await context.params;
  const verb = actVerbFor({ slug });
  if (verb === undefined) {
    return NextResponse.json({ error: `no act named ${slug}` }, { status: 404 });
  }
  const headers = { "cache-control": "no-store" };
  const startedAtIso = new Date().toISOString();
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return NextResponse.json({ out: "", outcome: "refused", startedAtIso, why: refused }, { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return NextResponse.json(
      {
        out: "",
        outcome: "refused",
        startedAtIso,
        why: `the body is ${String(raw.length)} bytes; the console carries up to ${String(BODY_MAX_BYTES)}`,
      },
      { headers, status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { out: "", outcome: "refused", startedAtIso, why: "the body is not JSON" },
      { headers, status: 400 },
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { out: "", outcome: "refused", startedAtIso, why: "the body is not an object of slots" },
      { headers, status: 400 },
    );
  }
  const built = buildActArgv({ slots: Object.fromEntries(Object.entries(body)), verb });
  if (built.kind === "refused") {
    return NextResponse.json({ out: "", outcome: "refused", startedAtIso, why: built.why }, { headers, status: 400 });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: verb.timeoutMs, title: verb.title });
  // Whatever it answered, it may have written: no read that left before now answers a reader who asks after it.
  forgetFlights({ flights: LIVE_FLIGHTS });
  if (ran.ok) {
    return NextResponse.json({ out: ran.out, outcome: "done", startedAtIso, tookMs: ran.tookMs }, { headers });
  }
  if (ran.exitCode === undefined) {
    // Killed on the timeout or never launched: the row may or may not be there. The panel re-reads.
    return NextResponse.json({ outcome: "unknown", startedAtIso, why: ran.notMeasured }, { headers, status: 504 });
  }
  return NextResponse.json(
    { out: ran.out, outcome: "refused", startedAtIso, why: ran.notMeasured },
    { headers, status: 422 },
  );
}
