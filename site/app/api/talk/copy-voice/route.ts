/**
 * The running list's voice check: judge one message the voice is about to offer the owner against their exact voice rules, by
 * running `slopweaver slack voice-rules --check-stdin --json` (`../../../../lib/copyVoiceCheck.ts` is the caller),
 * with `--slack-draft` when its `destination` is `slack`, so a Slack message as the owner keeps the parked-draft shape too
 * and no one dense paragraph.
 * A body naming no destination is refused, never read as either.
 *
 * The message travels on the child's STDIN, never argv, so it never appears in `ps`; nothing here writes it to a
 * file, a ledger or a log, and the verb prints only the rules it broke. A refusal is an answer, not an HTTP error,
 * so the page can hand it to the model; only the shape checks in front of the verb answer with a status of their own.
 */
import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import type { CopyVoiceRouteResult } from "../../../../lib/copyVoiceCheck";
import {
  COPY_OFFER_TEXT_MAX_CODE_POINTS,
  type CopyDestination,
  copyDestinationOf,
} from "../../../../lib/runningListCopy";
import { spawnVerb } from "../../../../lib/spawnVerb";

/** Never prerendered: it reads the owner's profile now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** A cold CLI start reads the owner's profile and matches one message; ten seconds is well past that. */
const COPY_VOICE_TIMEOUT_MS = 10_000;

/**
 * The largest body, in the UTF-16 units `request.text()` counts: the tray's own cap at six a code point, the most
 * `JSON.stringify` writes for one (a control character or a lone surrogate as `\uXXXX`; an astral one stays two raw
 * units), plus the JSON around it. So every offer the tray accepts is checked, never refused by size.
 */
const BODY_MAX_UNITS = COPY_OFFER_TEXT_MAX_CODE_POINTS * 6 + 1024;

/**
 * The verb's argv for each destination: a Slack message as the owner meets the parked-draft shape and the per-paragraph word
 * cap as well (`--slack-draft`), anything else the owner's exact rules alone.
 */
const ARGV_FOR: Readonly<Record<CopyDestination, readonly string[]>> = {
  other: ["slack", "voice-rules", "--check-stdin", "--json"],
  slack: ["slack", "voice-rules", "--check-stdin", "--slack-draft", "--json"],
};

/**
 * Check one message.
 *
 * @param request the call, whose JSON body is `{ text, destination }`
 * @returns the verb's verdict, or the stated refusal
 */
export async function POST(request: Request): Promise<NextResponse<CopyVoiceRouteResult>> {
  const headers = { "cache-control": "no-store" };
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    return NextResponse.json({ ok: false, refused: refusedPress }, { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_UNITS) {
    return NextResponse.json(
      { ok: false, refused: `the check is ${String(raw.length)} units; it carries up to ${String(BODY_MAX_UNITS)}` },
      { headers, status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, refused: "the check is not JSON" }, { headers, status: 400 });
  }
  const fields: Record<string, unknown> =
    typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : {};
  const text = fields["text"];
  if (typeof text !== "string") {
    return NextResponse.json({ ok: false, refused: "the check carries no text" }, { headers, status: 400 });
  }
  const destination = copyDestinationOf({ args: fields });
  if (destination.kind === "refused") {
    return NextResponse.json({ ok: false, refused: destination.why }, { headers, status: 400 });
  }
  const argv = ARGV_FOR[destination.destination];
  const title = `slopweaver ${argv.join(" ")}`;
  const ran = await spawnVerb({ argv: [...argv], stdin: text, timeoutMs: COPY_VOICE_TIMEOUT_MS, title });
  if (!ran.ok) {
    return NextResponse.json({ ok: false, refused: ran.notMeasured }, { headers, status: 200 });
  }
  let verdict: unknown;
  try {
    verdict = JSON.parse(ran.out);
  } catch {
    return NextResponse.json({ ok: false, refused: `${title} printed something that is not JSON` }, { headers });
  }
  return NextResponse.json({ ok: true, verdict }, { headers });
}
