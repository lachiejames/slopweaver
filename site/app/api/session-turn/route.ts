import { NextResponse } from "next/server";

import { SESSION_TURN_TIMEOUT_MS, sessionTurnArgv } from "../../../lib/sessionTurnVerb";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: the turn as `transcripts last-turn` printed it, or why not. */
export type SessionTurnResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly payload: unknown }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Read one session's latest turn by id: `?id=<session uuid>`, and with `&turns=<1-40>` the turns before it.
 *
 * @returns the verb's JSON, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<SessionTurnResult>> {
  const observedAtIso = new Date().toISOString();
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return NextResponse.json({ notMeasured: "no id: ?id=<session uuid>", observedAtIso, ok: false });
  }
  const built = sessionTurnArgv({ id, turns: new URL(request.url).searchParams.get("turns") });
  if (built.kind === "refused") {
    return NextResponse.json({ notMeasured: built.why, observedAtIso, ok: false });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: SESSION_TURN_TIMEOUT_MS, title: built.title });
  if (!ran.ok) {
    return NextResponse.json({ notMeasured: ran.notMeasured, observedAtIso, ok: false });
  }
  try {
    const payload: unknown = JSON.parse(ran.out);
    return NextResponse.json({ observedAtIso, ok: true, payload });
  } catch {
    return NextResponse.json({
      notMeasured: `${built.title} printed something that is not JSON`,
      observedAtIso,
      ok: false,
    });
  }
}
