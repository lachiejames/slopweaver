import { NextResponse } from "next/server";

import type { LiveMachineWire } from "../../../lib/liveMachineClient";
import { readLiveMachine } from "../../../lib/liveMachineRead";

/** Never prerendered: a build-time figure would be the frozen number this route exists to replace. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * The Fleet page's live machine reading, read inside this server (`site/lib/liveMachineRead.ts`), never through a
 * `slopweaver` child or the console's shared read slots. Always 200: a reading that could not be taken is a value the
 * page names, not a broken page. Nothing is saved for the next restart, because an old "live" figure drawn on first
 * load is the thing the owner rejected.
 *
 * @returns the reading, or why it could not be taken
 */
export async function GET(): Promise<NextResponse<LiveMachineWire>> {
  const read = await readLiveMachine();
  let body: LiveMachineWire;
  if (read.isOk()) {
    body = { kind: "read", reading: read.value };
  } else {
    body = { attemptedAtIso: new Date().toISOString(), kind: "not-measured", why: read.error.message };
  }
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
