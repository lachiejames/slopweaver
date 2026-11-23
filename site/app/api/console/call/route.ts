/**
 * The console voice's call lease: while a call is live the widget beats here, and a rebuild holds its swap
 * until the lease lapses (`site/lib/consoleHold.ts` says why).
 *
 * The lease is a FILE, not a verb: `scripts/docs-site.sh` reads it from bash under its refresh lock, and a beat
 * every fifteen seconds is not worth a spawned CLI beside a live call (`site/lib/liveQuiet.ts` measured what
 * polls cost one). Where the files live is the hold directory the production server was STARTED with
 * (`SLOPWEAVER_CONSOLE_HOLD_DIR`, beside the run record under the cache root's `docs-site/` — state outside the checkout).
 * A server started without one — `yarn dev`, a build CI runs — has no rebuild to hold, so it records nothing
 * and says so.
 *
 * The answer carries the build the refresh round is holding, when it is holding one, so the widget can say a
 * new build is waiting. `waiting.json` is believed only while the pid that wrote it is still a refresh round: a
 * round killed mid-hold leaves the file behind, its pid can be reused by anything, and a note naming a build nothing
 * is holding would be a confident lie.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { consoleHoldDir, HOLD_DIR_ENV, removeCallLease, writeCallLease } from "../../../../lib/callLeaseFile";
import {
  type CallBeatAnswer,
  isRefreshRoundArgs,
  leaseOf,
  parseCallBeat,
  parseWaiting,
  type WaitingBuild,
} from "../../../../lib/consoleHold";
import { refuseUnlessConsolePress } from "../../../../lib/consolePress";

/** Never prerendered: it writes a lease. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** How long a `ps` of one pid may take, well inside a beat. */
const PS_TIMEOUT_MS = 5_000;

/** `ps` by its absolute path, never off whatever PATH the long-lived server inherited (`console-verb-binary`). */
const PS_BINARY = "/bin/ps";

/**
 * Whether a pid is still a refresh round — not merely a running process, since a pid a killed round left behind can
 * be reused by anything (`isRefreshRoundArgs`).
 *
 * Synchronous on purpose — rule 2's `no-headless` gate refuses the async child-process capabilities in any source —
 * and cheap: one `ps` of one pid, only while a `waiting.json` stands.
 *
 * @returns true while that pid runs `docs-site.sh --refresh-round`
 */
function roundAlive({ pid }: { pid: number }): boolean {
  try {
    const args = execFileSync(PS_BINARY, ["-o", "args=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PS_TIMEOUT_MS,
    });
    return isRefreshRoundArgs({ args });
  } catch {
    return false;
  }
}

/**
 * The build a refresh round is holding for a call, if one is and its round is still alive.
 *
 * @param dir the hold directory
 * @returns the waiting build, or `undefined`
 */
async function waitingIn({ dir }: { dir: string }): Promise<WaitingBuild | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "waiting.json"), "utf8");
  } catch {
    return undefined;
  }
  const waiting = parseWaiting({ raw });
  if (waiting === undefined || !roundAlive({ pid: waiting.pid })) {
    return undefined;
  }
  return waiting;
}

/**
 * Record one beat: a live one writes the call's lease, a hang-up removes it.
 *
 * @param request the beat, whose JSON body is `{ callId, live }`
 * @returns whether anything was recorded, and the build waiting behind the call if there is one
 */
export async function POST(request: Request): Promise<NextResponse<CallBeatAnswer | { why: string }>> {
  const headers = { "cache-control": "no-store" };
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    return NextResponse.json({ why: refusedPress }, { headers, status: 403 });
  }
  const parsed = parseCallBeat({ raw: await request.text() });
  if (parsed.kind === "refused") {
    return NextResponse.json({ why: parsed.why }, { headers, status: 400 });
  }
  const dir = consoleHoldDir();
  if (dir === undefined) {
    return NextResponse.json(
      {
        recorded: false,
        waiting: undefined,
        why: `this server was started without ${HOLD_DIR_ENV}; only a production console a refresh rebuilds has a swap to hold`,
      },
      { headers },
    );
  }
  const { beat } = parsed;
  if (beat.live) {
    await writeCallLease({ dir, lease: leaseOf({ callId: beat.callId, nowMs: Date.now() }) });
  } else {
    await removeCallLease({ callId: beat.callId, dir });
  }
  return NextResponse.json({ recorded: true, waiting: await waitingIn({ dir }), why: undefined }, { headers });
}
