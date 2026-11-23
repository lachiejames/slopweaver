import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import {
  RUNNING_LIST_READ_ARGV,
  type RunningListAddResult,
  type RunningListRead,
  runningListAddArgv,
  runningListAddOf,
  runningListReceiptOf,
  runningListSnapshotOf,
} from "../../../../lib/runningList";
import { notifyRunningListChanged } from "../../../../lib/runningListNotify";
import { spawnVerb } from "../../../../lib/spawnVerb";

/** Never prerendered: the list is read, and written, now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** How long one verb run may take: each reads or rewrites one small file under a lock. */
const VERB_TIMEOUT_MS = 15_000;

/**
 * How long one read answers every poller. Each read is a `slopweaver` child, measured at about 1.5 s of CPU, and the
 * overlay and every console window poll; one child in flight and a short shared answer keep that to one per window
 * of this length, and an add drops it so the adder's next read is fresh.
 */
const READ_SHARED_MS = 5000;

/** The largest body an add may carry: the text's cap at four bytes a code point, with room for the rest. */
const BODY_MAX_BYTES = 8192 * 4 + 2048;

/** The read in flight or last answered, shared by every poller. */
let shared: { readonly at: number; readonly read: Promise<RunningListRead> } | undefined;

/** Read the list through the verb, once. */
async function readList(): Promise<RunningListRead> {
  const ran = await spawnVerb({
    argv: RUNNING_LIST_READ_ARGV,
    timeoutMs: VERB_TIMEOUT_MS,
    title: "slopweaver talk list --json",
  });
  if (!ran.ok) {
    return { outcome: "unread", why: ran.notMeasured };
  }
  let value: unknown;
  try {
    value = JSON.parse(ran.out);
  } catch {
    return { outcome: "unread", why: "talk list printed something other than JSON" };
  }
  const snapshot = runningListSnapshotOf({ value });
  if (snapshot === undefined) {
    return { outcome: "unread", why: "talk list printed a list this console does not read" };
  }
  return { outcome: "read", snapshot };
}

/**
 * The running list, newest first, for the overlay's tray and its dot.
 *
 * @returns the list, or why it could not be read
 */
export async function GET(): Promise<NextResponse<RunningListRead>> {
  const headers = { "cache-control": "no-store" };
  const now = Date.now();
  if (shared === undefined || now - shared.at > READ_SHARED_MS) {
    shared = { at: now, read: readList() };
  }
  const read = await shared.read;
  return NextResponse.json(read, { headers, status: read.outcome === "read" ? 200 : 502 });
}

/**
 * Add one item to the running list: the owner's, typed into the tray, or the voice's, from `offer_copy`. The fleet adds with
 * the CLI and never through here.
 *
 * The same door every console write takes (`refuseUnlessConsolePress`). The text goes to the child's stdin, never
 * its argv. When the owner adds during a call or a typed conversation, that conversation is told the list changed in one
 * fixed line carrying none of what they added (`../../../../lib/runningListNotify.ts`); its own `running_list` read
 * is how the words reach the voice.
 *
 * @param request the add, whose JSON body is `{ origin, id, text, label?, foldLine?, callId? }`
 * @returns the receipt, or why it was not added
 */
export async function POST(request: Request): Promise<NextResponse<RunningListAddResult>> {
  const headers = { "cache-control": "no-store" };
  const refused = refuseUnlessConsolePress({ request });
  if (refused !== undefined) {
    return NextResponse.json({ outcome: "refused", why: refused }, { headers, status: 403 });
  }
  const raw = await request.text();
  if (raw.length > BODY_MAX_BYTES) {
    return NextResponse.json(
      { outcome: "refused", why: `the add is ${String(raw.length)} bytes, over the list's cap` },
      { headers, status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ outcome: "refused", why: "the body is not JSON" }, { headers, status: 400 });
  }
  const read = runningListAddOf({ body });
  if (read.kind === "refused") {
    return NextResponse.json({ outcome: "refused", why: read.why }, { headers, status: 400 });
  }
  const { add } = read;
  shared = undefined;
  const ran = await spawnVerb({
    argv: runningListAddArgv({ add }),
    stdin: add.text,
    timeoutMs: VERB_TIMEOUT_MS,
    title: "slopweaver talk list-add",
  });
  if (!ran.ok) {
    if (ran.exitCode === undefined) {
      return NextResponse.json({ outcome: "unknown", why: ran.notMeasured }, { headers, status: 504 });
    }
    return NextResponse.json({ outcome: "refused", why: ran.notMeasured }, { headers, status: 422 });
  }
  let value: unknown;
  try {
    value = JSON.parse(ran.out);
  } catch {
    return NextResponse.json(
      { outcome: "unknown", why: "talk list-add printed something other than JSON" },
      { headers, status: 502 },
    );
  }
  const receipt = runningListReceiptOf({ value });
  if (receipt === undefined) {
    return NextResponse.json(
      { outcome: "unknown", why: "talk list-add printed a receipt this console does not read" },
      { headers, status: 502 },
    );
  }
  let untold: string | undefined;
  if (receipt.appended && add.origin === "owner" && add.callId !== undefined) {
    untold = await notifyRunningListChanged({ callId: add.callId });
  }
  return NextResponse.json({ outcome: "added", receipt, untold }, { headers });
}
