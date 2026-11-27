/**
 * What a console's call registry holds, as `site/app/api/talk/held/route.ts` answers it, parsed — and the call leg's
 * preflight decision over that beside the machine's call leases. Pure; the read is
 * `src/cli/commands/desktop/e2eHeldConversationsRead.ts`.
 *
 * **A lease is not the registry.** Only a live voice call beats a lease (`site/components/voice/useCallHold.ts`), so an
 * idle typed conversation of the owner's holds none, and a voice call whose page stopped beating holds none either. The
 * console places a test call beside nothing but a typed conversation at rest (`site/lib/talkArbiter.ts`), so the
 * preflight asks the registry too, and an answer it cannot read is never "none held".
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "./e2eCallErrors.js";
import type { E2eCallStepId } from "./e2eCallPlan.js";

/** One conversation the registry holds. */
export interface HeldConversation {
  readonly id: string;
  readonly surface: "voice" | "typed";
  /** Whether it is a typed conversation at rest, which a test call may run beside without touching. */
  readonly atRest: boolean;
}

/**
 * The route's answer, exactly, declared as the one boundary its read goes through. `atRest` is absent from a console
 * built before it was answered, whose own arbiter refuses a test call beside any conversation — so absent reads as
 * not at rest, and both build orders wait rather than place a call.
 */
const HELD_BOUNDARY = defineBoundary({
  endpoint: "GET /api/talk/held",
  schema: z.strictObject({
    held: z.array(
      z.strictObject({
        atRest: z.boolean().optional(),
        id: z.string().min(1),
        surface: z.enum(["voice", "typed"]),
      }),
    ),
  }),
});

/**
 * Parse the route's body text. Text that is not JSON, or anything other than its exact shape, is unreadable, never
 * read as none held; a row with no `atRest` is a console that predates it, read as not at rest.
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
  return ok(parsed.value.held.map((row) => ({ atRest: row.atRest === true, id: row.id, surface: row.surface })));
}

/** What the preflight does after one read of both. */
export type E2eCallPreflightDecision =
  | { readonly kind: "clear"; readonly atRestTyped: number }
  | { readonly kind: "wait"; readonly error: E2eCallError }
  | { readonly kind: "refuse"; readonly error: E2eCallError };

/**
 * Decide one preflight read. Unreadable leases refuse at once, as they always have: they are this machine's own
 * files. A live lease refuses at once too, and outranks anything the registry says: the leg proves its own calls'
 * leases gone before the next scenario, so a live one is a call it did not place — the owner's, by the owner's ruling, and
 * never waited out. An unreachable console is waited on — a rebuild swaps it out for seconds at
 * a time — and refuses only at the wait's end. A held voice call, or a typed conversation not at rest, with no live
 * lease waits, named alone; nothing held, or only typed conversations at rest, is clear, counting those it runs beside.
 * A scenario that OPENS a typed conversation runs beside none ({@link besideAtRestFor}): a newer typed conversation
 * replaces every older one, at rest or not, so for it every held conversation waits.
 *
 * @param besideAtRest whether the scenario about to run may sit beside a typed conversation at rest
 * @param leases the live lease ids, or why they could not be read
 * @param conversations the conversations the target console holds, or why its registry could not be read
 * @returns the decision, carrying the reason a wait or a refusal reports
 */
export function preflightDecision({
  besideAtRest,
  leases,
  conversations,
}: {
  besideAtRest: "allowed" | "refused";
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
  if (besideAtRest === "refused" && conversations.value.length > 0) {
    return { error: E2eCallErrors.conversationHeldForTypedOpen({ held: conversations.value }), kind: "wait" };
  }
  const holding = conversations.value.filter((one) => !(one.surface === "typed" && one.atRest));
  if (holding.length > 0) {
    return { error: E2eCallErrors.conversationHeld({ held: holding }), kind: "wait" };
  }
  return { atRestTyped: conversations.value.length, kind: "clear" };
}

/**
 * Whether a scenario may run beside a typed conversation at rest. Never one that types into the messenger: with no call
 * up at the press — `queue-search` and `card-read-typed` by design, `card-read` and `typing-after-drop` if their call
 * dropped between finding "send to the call" and pressing it — the box opens a typed conversation, and a newer one
 * replaces every older one (`site/lib/talkArbiter.ts`). Exhaustive, so a new scenario has to say.
 *
 * @param id the scenario about to run
 * @returns `refused` for a scenario that types into the messenger, else `allowed`
 */
export function besideAtRestFor({ id }: { id: E2eCallStepId }): "allowed" | "refused" {
  switch (id) {
    case "queue-search":
    case "card-read":
    case "card-read-typed":
    case "typing-after-drop":
      return "refused";
    case "call-live":
    case "launcher-voice":
    case "call-holds":
    case "long-task-mid-call":
    case "card-reading-hold":
    case "card-next":
    case "fleet-ask":
    case "draft-read-back":
    case "renderer-killed":
    case "relaunch":
    case "update-swap-resume":
    case "renderer-killed-twice":
    case "renderer-killed-connecting":
    case "call-reopen":
    case "transcription-fidelity":
      return "allowed";
    default: {
      const unhandled: never = id;
      return unhandled;
    }
  }
}

/**
 * The line the leg prints once every preflight read is clear beside typed conversations at rest, or none beside none.
 *
 * @param atRestTyped how many typed conversations at rest the test call will run beside
 * @returns the line, or `undefined` when there are none
 */
export function besideAtRestLine({ atRestTyped }: { atRestTyped: number }): string | undefined {
  if (atRestTyped === 0) {
    return undefined;
  }
  return (
    `PREFLIGHT  running beside ${String(atRestTyped)} typed conversation(s) at rest — each stays open and untouched, ` +
    "and the test call is kept apart from it"
  );
}
