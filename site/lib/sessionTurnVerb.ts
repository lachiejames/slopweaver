/**
 * The second read the console takes BY ID: one Claude session's latest turn, for the read-only session view
 * (`app/(console)/fleet/session/[id]`).
 *
 * The same door as `threadVerb.ts`: a literal argv, one slot, and the slot's value checked against a strict
 * shape before it becomes an argv element. A session id is a UUID and nothing else, so it can never be a
 * flag or a path. `transcripts last-turn` reads a local transcript's tail and reaches no provider.
 */

/** A Claude Code session id, as the transcript's filename carries it. */
const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reading the turn is one stat and an 8 MiB tail read, but the child is a cold CLI start sharing the machine
 * with the page's own polls, the same budget the live lane gives a fast verb.
 */
export const SESSION_TURN_TIMEOUT_MS = 20_000;

/** The most turns one read asks for: `transcripts last-turn`'s own `MAX_TURNS`, which refuses more. */
export const MAX_SESSION_TURNS = 40;

/** A `?turns=` value: digits only, so it can never be a flag or carry anything but a count. */
const TURNS_SHAPE = /^\d{1,2}$/;

/** What building the session-turn argv came to. */
export type SessionTurnArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The `transcripts last-turn` argv for one session, or the refusal.
 *
 * @param id the session id off the request
 * @param turns the `?turns=` value off the request, `null` when absent — one turn, the latest
 * @returns the literal argv, or why the id or the count was refused
 */
export function sessionTurnArgv({ id, turns }: { id: string; turns: string | null }): SessionTurnArgv {
  if (!SESSION_ID_SHAPE.test(id)) {
    return { kind: "refused", why: "the session id is not a Claude session id; the console reads a turn only by one" };
  }
  let count = 1;
  if (turns !== null) {
    count = TURNS_SHAPE.test(turns) ? Number(turns) : 0;
  }
  if (count < 1 || count > MAX_SESSION_TURNS) {
    return { kind: "refused", why: `turns must be a whole number from 1 to ${String(MAX_SESSION_TURNS)}` };
  }
  const argv = ["transcripts", "last-turn", "--session", id, "--turns", String(count), "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}
