/**
 * The console voice's one writer: a steer the owner talked through, registered as a board row in their words, with a
 * picture of their screen.
 *
 * A relayed steer lands as if the owner had given it directly to the supervisor, with their exact quotes and an
 * image of what they are looking at. So the widget posts here when the model calls `relay_steer` — after
 * `site/lib/relayGate.ts` has said the call carries their words, and in which mode: FULL, with the voice's
 * reading beside them, or HEARD-ONLY, with only their words because the voice read something after they spoke —
 * or WORDS-ALONE, the page's one retry after the verb refused a relay before writing anything, which the
 * refusal's `wordsAloneRetry` offers (`site/lib/relayRetry.ts`).
 * This route cannot re-check that; the record it is decided on lives in the page. What it owns is the body
 * (`site/lib/talkRelayRequestWire.ts`), and that the row it writes carries the owner's own transcribed words FIRST
 * (`heard`), the voice's reading second or the reads that dropped it (`say` / `readsAfter`), the item they
 * were looking at (`about`), the frame of their shared screen (`screen`), and the p1 priority a steer they type
 * into the Queue's steer box already gets (`actVerbs.ts`'s `STEER_PRIORITY`).
 *
 * ## Why the picture travels as a FILE
 *
 * A frame is hundreds of KiB, which is no argv value. So the route writes it to a `0600` file in a
 * per-request `mkdtemp` directory, hands the verb `--screen <path>`, and removes the directory once the verb
 * has returned — the verb keeps its own copy beside the turn (`src/talk/relayPicture.ts`). The same shape
 * `talk offer` uses for an SDP offer. The copy-tray offer the owner was reacting to, when the relay carries one, goes the same
 * way, as `offer.json` beside it (`--offered-file`): up to 8,192 code points is no argv value either.
 *
 * ## Why the turn id comes from the PAGE and not from this route
 *
 * `slopweaver talk relay` is idempotent on `--turn`: the turn file is created with `O_EXCL`, so it is both
 * the lock and the idempotency key, and a second call with the same turn, the same words and the same
 * picture reports "already relayed" rather than writing a second row (`src/talk/relayStore.ts`). That is
 * worth nothing if the id is minted per REQUEST — a retried post would be two turns and two rows. So the
 * widget mints one per window of the owner's speech and reuses it, with the same payload, until a relay lands. The
 * model never sees it and cannot supply one: `relay_steer` takes `say`, on a check-in which one and how far
 * the owner's verdict reaches (`check_in`, `covers`), on a workstream candidate which one and their word (`candidate`,
 * `reaction`), and nothing else.
 *
 * ## A verdict on a check-in is also a ruling
 *
 * The voice walks the owner's check-ins, and each reaction clears a batch. So a relay whose `about` is an `act:` key may
 * carry `covers`, and the verb records the owner's heard words as their word on every card it reaches — the same words, on
 * the acts the register says are still unsettled (`src/talk/checkInRuling.ts`).
 *
 * ## So is a word on a workstream candidate
 *
 * The voice must know which candidates the owner has already ruled on, so a spoken ruling reaches the
 * candidate. So a relay may carry `candidate` and `reaction`, and the verb writes the owner's heard words onto that candidate
 * the same turn (`src/talk/candidateRuling.ts`); the argv is `site/lib/talkRelayArgv.ts`'s.
 *
 * ## The desktop test instance relays nothing
 *
 * A relay the desktop TEST instance sent (`instance: "e2e"`, `slopweaver desktop e2e --call`) is refused by the parse,
 * a 403, before this route stages a file, reads its origin or spawns the verb: the walk's speech is never the owner's steer.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { originArgvOfServer } from "../../../../lib/consoleOrigin";
import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { relayOutcomeUnknown, relayRetryable } from "../../../../lib/relayRetry";
import { spawnVerb } from "../../../../lib/spawnVerb";
import { TALK_RELAY_ARGV_TITLE, talkRelayArgv } from "../../../../lib/talkRelayArgv";
import { parseTalkRelayRequest } from "../../../../lib/talkRelayRequest";

/** Never prerendered: it writes a board row. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** Thirty seconds, matching the act route's `handover register`: this writes a doc, not a log line. */
const RELAY_TIMEOUT_MS = 30_000;

/**
 * What the relay came to. `unknown` is its own arm for the same reason the act route has one: a verb
 * killed on its timeout may have written its row first, so the widget is told to re-read rather than told it
 * failed.
 */
export type TalkRelayResult =
  | { readonly outcome: "done"; readonly out: string }
  /** `wordsAloneRetry`: the verb refused before writing anything, so the page may retry with the owner's words alone. */
  | { readonly outcome: "refused"; readonly why: string; readonly wordsAloneRetry: boolean }
  | { readonly outcome: "unknown"; readonly why: string };

/**
 * Relay one steer to the board.
 *
 * @param request the relay, whose JSON body is `site/lib/talkRelayRequestWire.ts`'s `TalkRelayWire`
 * @returns what the verb did, in the three shapes a relay can come to
 */
export async function POST(request: Request): Promise<NextResponse<TalkRelayResult>> {
  const headers = { "cache-control": "no-store" };
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    return NextResponse.json(
      { outcome: "refused", why: refusedPress, wordsAloneRetry: false },
      { headers, status: 403 },
    );
  }
  const parsed = parseTalkRelayRequest({ raw: await request.text() });
  if (parsed.kind === "refused") {
    return NextResponse.json(
      { outcome: "refused", why: parsed.why, wordsAloneRetry: parsed.wordsAloneRetry },
      { headers, status: parsed.status },
    );
  }
  // Where this server serves from, so the verb refuses a console that is not the owner's before it writes a row or types into
  // their chat (`site/lib/consoleOrigin.ts`). Refused before anything is staged, so no retry with their words alone helps.
  const origin = originArgvOfServer();
  if ("refused" in origin) {
    return NextResponse.json(
      { outcome: "refused", why: origin.refused, wordsAloneRetry: false },
      { headers, status: 503 },
    );
  }
  const { relay } = parsed;
  const dir = await mkdtemp(join(tmpdir(), "slopweaver-relay-"));
  try {
    let screenPath: string | undefined;
    if (relay.screen.kind === "attached") {
      screenPath = join(dir, "screen.webp");
      await writeFile(screenPath, relay.screen.bytes, { mode: 0o600 });
    }
    let offeredPath: string | undefined;
    if (relay.offered !== undefined) {
      offeredPath = join(dir, "offer.json");
      await writeFile(offeredPath, JSON.stringify(relay.offered), { encoding: "utf8", mode: 0o600 });
    }
    const ran = await spawnVerb({
      argv: talkRelayArgv({ offeredPath, originArgv: origin.argv, relay, screenPath }),
      stdin: relay.heard,
      timeoutMs: RELAY_TIMEOUT_MS,
      title: TALK_RELAY_ARGV_TITLE,
    });
    if (ran.ok) {
      return NextResponse.json({ out: ran.out.trim(), outcome: "done" }, { headers });
    }
    if (relayOutcomeUnknown({ exitCode: ran.exitCode })) {
      return NextResponse.json({ outcome: "unknown", why: ran.notMeasured }, { headers, status: 504 });
    }
    const wordsAloneRetry = relayRetryable({ exitCode: ran.exitCode, wordsAlone: relay.wordsAlone });
    return NextResponse.json({ outcome: "refused", why: ran.notMeasured, wordsAloneRetry }, { headers, status: 422 });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
