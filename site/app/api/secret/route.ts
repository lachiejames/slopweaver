import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../lib/consolePress";
import {
  SECRET_VALUE_MAX,
  secretPasteRequest,
  secretReceipt,
  secretSetArgv,
  secretStdin,
} from "../../../lib/secretPaste";
import { spawnVerb } from "../../../lib/spawnVerb";

/** Never prerendered: the request writes a file now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * What the field receives. Like the act route's, the third arm is the one a two-armed shape would hide: a verb killed
 * on its timeout may have written the file, so the field re-reads `secrets status` rather than calling it failed.
 * No arm carries the value.
 */
export type SecretPasteResult =
  | {
      readonly outcome: "set";
      readonly name: string;
      readonly path: string | undefined;
      readonly atIso: string;
    }
  | { readonly outcome: "refused"; readonly why: string }
  | { readonly outcome: "unknown"; readonly why: string };

/** The largest body a paste may carry: the value's cap with room for the name and the JSON around it. */
const BODY_MAX_BYTES = SECRET_VALUE_MAX + 1024;

/** How long `secrets set` may take — it writes one small file, so anything near this is a hung child. */
const SET_TIMEOUT_MS = 20_000;

/** The verb line a failure is named by — deliberately the name only, never what was piped. */
const TITLE = "slopweaver secrets set --stdin";

/**
 * Store one pasted secret, 0600 under `$SLOPWEAVER_HOME/secrets/`, through `slopweaver secrets set`.
 *
 * The same door every console write takes (`refuseUnlessConsolePress`): same-origin, loopback, JSON. The value goes
 * to the child's stdin and nowhere else — not its argv, not a log line, not the response. This route is deliberately
 * NOT a tool the console voice can call (`site/lib/talkToolsList.ts`): a model that reads third-party text never holds a
 * path to a credential write.
 *
 * @param request the paste, whose JSON body is exactly `{ name, value }`
 * @returns the receipt naming the key, or why it was not stored
 */
export async function POST(request: Request): Promise<NextResponse<SecretPasteResult>> {
  const headers = { "cache-control": "no-store" };
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return NextResponse.json({ outcome: "refused", why: refused }, { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return NextResponse.json(
      { outcome: "refused", why: `the paste is ${String(raw.length)} bytes; a secret here is a single line` },
      { headers, status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ outcome: "refused", why: "the body is not JSON" }, { headers, status: 400 });
  }
  const paste = secretPasteRequest({ body });
  if (paste.kind === "refused") {
    return NextResponse.json({ outcome: "refused", why: paste.why }, { headers, status: 400 });
  }
  const ran = await spawnVerb({
    argv: secretSetArgv({ name: paste.name }),
    stdin: secretStdin({ value: paste.value }),
    timeoutMs: SET_TIMEOUT_MS,
    title: TITLE,
  });
  if (ran.ok) {
    const receipt = secretReceipt({ name: paste.name, out: ran.out });
    return NextResponse.json(
      { atIso: new Date().toISOString(), name: paste.name, outcome: "set", path: receipt?.path },
      { headers },
    );
  }
  if (ran.exitCode === undefined) {
    return NextResponse.json({ outcome: "unknown", why: ran.notMeasured }, { headers, status: 504 });
  }
  return NextResponse.json({ outcome: "refused", why: ran.notMeasured }, { headers, status: 422 });
}
