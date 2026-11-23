import { NextResponse } from "next/server";
import { MAIL_THREAD_TIMEOUT_MS, mailThreadArgv } from "../../../lib/mailThreadVerb";
import { spawnVerb } from "../../../lib/spawnVerb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The wire shape this route answers with: the thread as `gmail read --thread` printed it, or why not. */
export type MailThreadResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly read: unknown }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Read one mail thread live, by its id or the id of any message in it: `?id=<16 hex>`.
 *
 * @returns the thread, or the one reason it was not measured
 */
export async function GET(request: Request): Promise<NextResponse<MailThreadResult>> {
  const observedAtIso = new Date().toISOString();
  const id = new URL(request.url).searchParams.get("id");
  if (id === null) {
    return NextResponse.json({ notMeasured: "no id: ?id=<gmail id>", observedAtIso, ok: false });
  }
  const built = mailThreadArgv({ id });
  if (built.kind === "refused") {
    return NextResponse.json({ notMeasured: built.why, observedAtIso, ok: false });
  }
  const ran = await spawnVerb({ argv: built.argv, timeoutMs: MAIL_THREAD_TIMEOUT_MS, title: built.title });
  if (!ran.ok) {
    return NextResponse.json({ notMeasured: ran.notMeasured, observedAtIso, ok: false });
  }
  try {
    const read: unknown = JSON.parse(ran.out);
    return NextResponse.json({ observedAtIso, ok: true, read });
  } catch {
    return NextResponse.json({
      notMeasured: `${built.title} printed something that is not JSON`,
      observedAtIso,
      ok: false,
    });
  }
}
