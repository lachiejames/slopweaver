import { NextResponse } from "next/server";
import { CARD_MAIL_TIMEOUT_MS, cardMailArgv, cardMailReadOf } from "../../../lib/cardMailVerb";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: what `gmail card-mail` printed, or why not. */
export type CardMailResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly read: unknown }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Read one inbox-triage card's stored mail off this machine: `?slug=<card slug>` for every pinned message's headers,
 * plus `&message=<16 hex>` for that one message's sanitised body.
 *
 * @returns the reading, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<CardMailResult>> {
  const observedAtIso = new Date().toISOString();
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug");
  if (slug === null) {
    return NextResponse.json({ notMeasured: "no slug: ?slug=<card slug>", observedAtIso, ok: false });
  }
  const built = cardMailArgv({ message: params.get("message"), slug });
  if (built.kind === "refused") {
    return NextResponse.json({ notMeasured: built.why, observedAtIso, ok: false });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: CARD_MAIL_TIMEOUT_MS, title: built.title });
  return NextResponse.json({ ...cardMailReadOf({ ran, title: built.title }), observedAtIso });
}
