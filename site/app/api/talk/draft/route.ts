/**
 * The console voice's draft write: the parked Slack draft on the card the owner has open, rewritten or put back to an earlier
 * version, through `slopweaver slack draft revise|restore`. The voice edits live — body only, Slack only, never sent.
 *
 * The page aims it (`site/lib/draftEdit.ts`): the id is the card open on the owner's Queue, `heard` their latest turn off the
 * call's transcript, `anchor` that call and turn. The model supplies only the new words, its reading, or the version.
 * This route owns the body's bounds and the argv; the verb owns everything else — it keeps every version, refuses an
 * approved row, re-admits the words exactly as a recording would, and fixes the destination, the identity, the
 * thread, the files and whom it tags (`src/cli/commands/slack/draftReviseRun.ts`). Nothing here sends: the one way a
 * parked draft reaches Slack is still `slack draft release` on the owner's yes.
 */
import { NextResponse } from "next/server";

import { refuseUnlessConsolePress } from "../../../../lib/consolePress";
import { parseTalkDraftRequest, TALK_DRAFT_ARGV_TITLE, talkDraftArgv } from "../../../../lib/draftEdit";
import { spawnVerb } from "../../../../lib/spawnVerb";

/** Never prerendered: it writes the drafts register. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * Forty-five seconds: a revise re-admits the words as a recording does, which reads the conversation and the owner's identity
 * off Slack before the register lock is taken.
 */
const DRAFT_TIMEOUT_MS = 45_000;

/**
 * What the edit came to. `unknown` is a verb killed on its timeout, which may have appended first, so the page reads
 * the drafts again rather than saying it failed.
 */
export type TalkDraftResult =
  | { readonly outcome: "done"; readonly out: string }
  | { readonly outcome: "refused"; readonly why: string }
  | { readonly outcome: "unknown"; readonly why: string };

/**
 * Rewrite or restore one parked draft.
 *
 * @param request the edit, whose JSON body is `site/lib/draftEdit.ts`'s `TalkDraftWire`
 * @returns what the verb did
 */
export async function POST(request: Request): Promise<NextResponse<TalkDraftResult>> {
  const headers = { "cache-control": "no-store" };
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    return NextResponse.json({ outcome: "refused", why: refusedPress }, { headers, status: 403 });
  }
  const wire = parseTalkDraftRequest({ raw: await request.text() });
  if ("why" in wire) {
    return NextResponse.json({ outcome: "refused", why: wire.why }, { headers, status: 400 });
  }
  const { argv, stdin } = talkDraftArgv({ wire });
  const ran = await spawnVerb({
    argv,
    timeoutMs: DRAFT_TIMEOUT_MS,
    title: TALK_DRAFT_ARGV_TITLE,
    ...(stdin === undefined ? {} : { stdin }),
  });
  if (ran.ok) {
    return NextResponse.json({ out: ran.out.trim(), outcome: "done" }, { headers });
  }
  if (ran.exitCode === undefined) {
    return NextResponse.json({ outcome: "unknown", why: ran.notMeasured }, { headers, status: 504 });
  }
  return NextResponse.json({ outcome: "refused", why: ran.notMeasured }, { headers, status: 422 });
}
