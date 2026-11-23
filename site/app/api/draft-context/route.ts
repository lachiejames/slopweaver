import { NextResponse } from "next/server";
import { DRAFT_CONTEXT_TIMEOUT_MS, draftContextArgv } from "../../../lib/draftContextVerb";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: the conversation as `slack draft context` printed it, or why not. */
export type DraftContextResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly context: unknown }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Read the conversation one parked draft lands in, live: `?id=sd-…`.
 *
 * @returns the conversation, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<DraftContextResult>> {
  const observedAtIso = new Date().toISOString();
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return NextResponse.json({ notMeasured: "no id: ?id=<sd-…>", observedAtIso, ok: false });
  }
  const built = draftContextArgv({ id });
  if (built.kind === "refused") {
    return NextResponse.json({ notMeasured: built.why, observedAtIso, ok: false });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: DRAFT_CONTEXT_TIMEOUT_MS, title: built.title });
  if (!ran.ok) {
    return NextResponse.json({ notMeasured: ran.notMeasured, observedAtIso, ok: false });
  }
  try {
    const context: unknown = JSON.parse(ran.out);
    return NextResponse.json({ context, observedAtIso, ok: true });
  } catch {
    return NextResponse.json({
      notMeasured: `${built.title} printed something that is not JSON`,
      observedAtIso,
      ok: false,
    });
  }
}
