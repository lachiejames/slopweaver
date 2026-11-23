/**
 * Every conversation this console holds now, by id and surface alone — read by `slopweaver desktop e2e --call`'s
 * preflight, which must not place a test call beside one of the owner's. A call lease cannot answer that: an idle typed
 * conversation holds none, and a voice call whose page stopped beating holds none either, while the registry holds
 * both (`lib/talkCallRegistry.ts`). Read-only, so the write guard (`lib/consolePress.ts`) is not in front of it; the
 * server is bound to 127.0.0.1 by `scripts/docs-site.sh`, and the answer names opaque ids, never a word of either.
 */
import { NextResponse } from "next/server";

import { heldConversations } from "../../../../lib/talkCallRegistry";

/** Never prerendered: the registry is read now. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/** What the route answers. */
export interface HeldConversationsAnswer {
  readonly held: readonly { readonly id: string; readonly surface: "voice" | "typed" }[];
}

/**
 * The held conversations.
 *
 * @returns each one's id and surface, in the order they were held
 */
export function GET(): NextResponse<HeldConversationsAnswer> {
  return NextResponse.json({ held: heldConversations() }, { headers: { "cache-control": "no-store" } });
}
