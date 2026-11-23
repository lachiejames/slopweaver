/**
 * What a console's call registry holds, as `site/app/api/talk/held/route.ts` answers it, parsed — and the call leg's
 * preflight decision over that beside the machine's call leases. Pure; the read is
 * `src/cli/commands/desktop/e2eHeldConversationsRead.ts`.
 *
 * **A lease is not the registry.** Only a live voice call beats a lease (`site/components/voice/useCallHold.ts`), so an
 * idle typed conversation of the owner's holds none, and a voice call whose page stopped beating holds none either. A test
 * call's offer ends an idle typed conversation (`site/lib/talkArbiter.ts`), so the preflight asks the registry too,
 * and an answer it cannot read is never "none held".
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "./e2eCallErrors.js";

/** One conversation the registry holds. */
export interface HeldConversation {
  readonly id: string;
  readonly surface: "voice" | "typed";
}

/** The route's answer, exactly, declared as the one boundary its read goes through. */
const HELD_BOUNDARY = defineBoundary({
  endpoint: "GET /api/talk/held",
  schema: z.strictObject({
    held: z.array(z.strictObject({ id: z.string().min(1), surface: z.enum(["voice", "typed"]) })),
  }),
});

/**
 * Parse the route's body text. Text that is not JSON, or anything other than its exact shape, is unreadable, never
 * read as none held.
 *
 * @param text the response body as the route sent it
 * @param url where it was read, for the error
 * @returns the held conversations, or why the answer could not be read
 */
export function parseHeldConversations({
  text,
  url,
}: {
  text: string;
  url: string;
}): Result<readonly HeldConversation[], E2eCallError> {
  const parsed = HELD_BOUNDARY.parseJson({ text });
  if (parsed.isErr()) {
    const why =
      parsed.error.code === "BOUNDARY_NOT_JSON" ? "something that is not JSON" : "a shape this build does not read";
    return err(E2eCallErrors.conversationsUnreadable({ detail: `${url} answered ${why}` }));
  }
  return ok(parsed.value.held);
}

/** What the preflight does after one read of both. */
export type E2eCallPreflightDecision =
  | { readonly kind: "clear" }
  | { readonly kind: "wait"; readonly error: E2eCallError }
  | { readonly kind: "refuse"; readonly error: E2eCallError };

/**
 * Decide one preflight read. Unreadable leases refuse at once, as they always have: they are this machine's own
 * files. A live lease refuses at once too, and outranks anything the registry says: the leg proves its own calls'
 * leases gone before the next scenario, so a live one is a call it did not place — the owner's, by the owner's ruling, and
 * never waited out. An unreachable console is waited on — a rebuild swaps it out for seconds at
 * a time — and refuses only at the wait's end. A held conversation with no live lease waits; all empty is clear.
 *
 * @param leases the live lease ids, or why they could not be read
 * @param conversations the conversations the target console holds, or why its registry could not be read
 * @returns the decision, carrying the reason a wait or a refusal reports
 */
export function preflightDecision({
  leases,
  conversations,
}: {
  leases: Result<readonly string[], E2eCallError>;
  conversations: Result<readonly HeldConversation[], E2eCallError>;
}): E2eCallPreflightDecision {
  if (leases.isErr()) {
    return { error: leases.error, kind: "refuse" };
  }
  if (leases.value.length > 0) {
    return { error: E2eCallErrors.callAlreadyLive({ live: leases.value.length }), kind: "refuse" };
  }
  if (conversations.isErr()) {
    return { error: conversations.error, kind: "wait" };
  }
  if (conversations.value.length > 0) {
    return { error: E2eCallErrors.conversationHeld({ held: conversations.value }), kind: "wait" };
  }
  return { kind: "clear" };
}
