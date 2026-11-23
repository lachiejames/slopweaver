import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  BRIEFING_READ_TITLE,
  type BriefingRead,
  briefingReadArgv,
  briefingReadOf,
} from "../../../../../lib/briefingRead";
import { consoleHomePaths } from "../../../../../lib/consoleHome";
import { refuseUnlessConsolePress } from "../../../../../lib/consolePress";
import { isPageSlug } from "../../../../../lib/localPageHref";
import { spawnVerb } from "../../../../../lib/spawnVerb";

/** Never prerendered: the whole point of the request is that it reads the page as it is now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** How long one read may take before it is reported as not measured. */
const READ_TIMEOUT_MS = 20_000;

/**
 * Read one published briefing for the console voice, its credentials masked (`../../../../../lib/briefingRead.ts`):
 * what `read_card` and `open_card` attach to a card before the voice says a word on it. A read that failed is a
 * RESULT, never an HTTP error: the voice is handed the page's file to read itself when the card names one, else the
 * reason and the sentence saying it could not open the briefing (`../../../../../lib/cardBriefings.ts` `cardBriefingOf`).
 *
 * @param request the press, held to the console's own origin
 * @param context the dynamic segment, which is the briefing's slug
 * @returns the briefing's words, or why they could not be read
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse<BriefingRead>> {
  const headers = { "cache-control": "no-store" };
  const refusedPress = refuseUnlessConsolePress({ request });
  if (refusedPress !== undefined) {
    // A fixed sentence, never the guard's own text, which quotes the request's headers.
    return NextResponse.json({ ok: false, why: "not a press from this console" }, { headers, status: 403 });
  }
  const { slug } = await context.params;
  if (!isPageSlug({ slug })) {
    return NextResponse.json({ ok: false, why: "the briefing's name is not a page name" }, { headers, status: 400 });
  }
  // The page's address, never a file: `talk file read` reads the store's current document for it (`src/talk/heldPage.ts`).
  const expectedPath = join(consoleHomePaths().pages, slug, "index.html");
  const outcome = await spawnVerb({
    argv: briefingReadArgv({ file: expectedPath }),
    timeoutMs: READ_TIMEOUT_MS,
    title: BRIEFING_READ_TITLE,
  });
  return NextResponse.json(briefingReadOf({ expectedPath, outcome }), { headers });
}
