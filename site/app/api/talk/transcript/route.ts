/**
 * The console voice's call transcript, appended to disk as the call runs: one batch of lines per request, piped on
 * the stdin of `slopweaver talk transcript`, which masks every secret in it and appends it to
 * `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl` — with where this server serves from, so a console that is not
 * the owner's is refused the live home and every call it opens is stamped (`site/lib/consoleOrigin.ts`). The relay route's shape (`../relay/route.ts`), for the same
 * reason: the verb is the one writer, and the console reaches the machine only through a verb.
 *
 * A dropped call must not lose the steers given on it. What a line says and how
 * the page batches them is `site/lib/talkTranscript.ts`; the file and who reads it, `src/talk/callStore.ts`.
 *
 * A batch that finishes a stretch of the owner's then wakes the pinned chair to read it, unawaited (`wakeChairInBackground`):
 * the page's answer is the append's, never the wake's. A batch the desktop test instance marked (`instance: "e2e"`)
 * goes to the verb with `--console-instance e2e` and wakes nobody: the walk's speech is never the owner's.
 */
import { NextResponse } from "next/server";

import { originArgvOfServer } from "../../../../lib/consoleOrigin";
import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { appendCallBatch, wakeChairInBackground } from "../../../../lib/talkCallAppend";
import { parseTalkTranscriptRequest, unappendedStatus } from "../../../../lib/talkTranscript";

/** Never prerendered: it writes the owner's words to disk. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** What the append came to. The page re-queues a batch that was not `done`. */
export type TalkTranscriptResult =
  { readonly outcome: "done"; readonly appended: number } | { readonly outcome: "refused"; readonly why: string };

/**
 * Append one batch of a call's lines.
 *
 * @param request the batch, whose JSON body is `site/lib/talkTranscript.ts`'s `TalkTranscriptWire`
 * @returns how many lines went in, or why none did
 */
export async function POST(request: Request): Promise<NextResponse<TalkTranscriptResult>> {
  const headers = { "cache-control": "no-store" };
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    return NextResponse.json({ outcome: "refused", why: refusedPress }, { headers, status: 403 });
  }
  // Where this server serves from, so the verb refuses a console that is not the owner's and stamps the call: never the page's.
  // A 503 when it cannot be read keeps the batch on the page, so a misconfigured console never drops the owner's words.
  const origin = originArgvOfServer();
  if ("refused" in origin) {
    return NextResponse.json({ outcome: "refused", why: origin.refused }, { headers, status: 503 });
  }
  const parsed = parseTalkTranscriptRequest({ raw: await request.text() });
  if (parsed.kind === "refused") {
    return NextResponse.json({ outcome: "refused", why: parsed.why }, { headers, status: parsed.status });
  }
  const failed = await appendCallBatch({
    callId: parsed.callId,
    instance: parsed.instance,
    jsonl: parsed.jsonl,
    originArgv: origin.argv,
  });
  if (failed === undefined) {
    // The desktop test instance's speech is never the owner's, so its batch wakes nobody. An unmarked batch on a call the
    // instance opened earlier still reaches the verb, which wakes only for words `talk unread` reads as the owner's — and it
    // reads a marked call's later stretches as the instance's (`src/talk/callOrigin.ts`'s `originAfterOpen`).
    if (parsed.finishesOwnerStretch && parsed.instance === undefined) {
      wakeChairInBackground({ originArgv: origin.argv });
    }
    return NextResponse.json({ appended: parsed.count, outcome: "done" }, { headers });
  }
  return NextResponse.json(
    { outcome: "refused", why: failed.why },
    { headers, status: unappendedStatus({ exitCode: failed.exitCode }) },
  );
}
