import { NextResponse } from "next/server";
import { consoleHome } from "../../../lib/consoleHome";
import { refuseUnlessConsoleRead } from "../../../lib/consoleRead";
import type { PrivateTermProposalsAnswer } from "../../../lib/privateTermProposal";
import { privateTermProposalRequest } from "../../../lib/privateTermProposalIds";
import { readPrivateTermProposals } from "../../../lib/privateTermProposalRead";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Never kept by the browser, a proxy or Next itself: the body is the owner's private words. */
const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The private-word proposals one open Queue card names, read off this machine's store as they are now:
 * `?id=pp-…&id=pp-…`. Only the console's own window gets an answer (`refuseUnlessConsoleRead`: a loopback Host, the
 * console's header, a same-origin fetch). A refusal is one fixed word, and nothing here logs, spawns or writes.
 *
 * @returns every asked proposal in order, or why the request was refused
 */
export function GET(request: Request): NextResponse<PrivateTermProposalsAnswer> {
  if (refuseUnlessConsoleRead({ request }) !== undefined) {
    return NextResponse.json({ kind: "refused", reason: "not-the-console" }, { headers: NO_STORE, status: 403 });
  }
  const proposalIds = privateTermProposalRequest({ params: new URL(request.url).searchParams });
  if (proposalIds === undefined) {
    return NextResponse.json({ kind: "refused", reason: "bad-request" }, { headers: NO_STORE, status: 400 });
  }
  const items = readPrivateTermProposals({ home: consoleHome(), proposalIds });
  return NextResponse.json({ items, kind: "read" }, { headers: NO_STORE });
}
