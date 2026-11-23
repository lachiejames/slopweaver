/**
 * What the owner said on a call that the supervisor has not read yet, as a typed steer's relay line carries it — the spoken
 * half of one conversation across the console's typed and spoken surfaces.
 *
 * A typed turn after a call should continue from what the owner said. The
 * chair already reads the owner's call words through `talk unread`, but only when it next looks; a typed steer landing in
 * its chat first would read as a fresh conversation. So the line names the call the owner was just on, how many of their stretches
 * the chair has not read, and the newest of them — read against the supervisor's own unread cursor, never advancing
 * it, so marking them read stays the chair's act.
 *
 * Pure: the read is taken by the caller.
 */
import type { UnreadSelection } from "./unreadWords.js";

/** How many of the owner's newest unread stretches on that call the line quotes. */
const CALL_CONTEXT_QUOTES = 2;

/** What a typed steer's line says about the calls the owner was on. */
export type SteerCallContext =
  | { readonly kind: "none" }
  | {
      readonly kind: "unread";
      /** The call the owner's newest unread stretch was said on. */
      readonly callId: string;
      /** Every stretch of the owner's the chair has not read, across every call. */
      readonly stretches: number;
      /** The owner's newest unread stretches on that call, oldest first, at most {@link CALL_CONTEXT_QUOTES}. */
      readonly newest: readonly string[];
    }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * The call context a typed steer's line carries.
 *
 * @param selection the owner's words past the supervisor's unread cursor
 * @returns none when the chair has read every word the owner said, else the call and its newest words
 */
export function steerCallContextOf({ selection }: { selection: UnreadSelection }): SteerCallContext {
  const spoken = selection.words.filter((word) => word.text.trim() !== "");
  const last = spoken.at(-1);
  if (last === undefined) {
    return { kind: "none" };
  }
  return {
    callId: last.callId,
    kind: "unread",
    newest: spoken
      .filter((word) => word.callId === last.callId)
      .slice(-CALL_CONTEXT_QUOTES)
      .map((word) => word.text.replaceAll(/\s+/gu, " ").trim()),
    stretches: spoken.length,
  };
}
