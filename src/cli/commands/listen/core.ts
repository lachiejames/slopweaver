/**
 * `slopweaver listen`'s PURE half: its flag surface, its parse, and the acknowledgement text the stub
 * handler posts. No socket, no token read, no clock — everything here is unit-tested directly.
 *
 * The flag set is deliberately tiny. A listener has one job and is driven by being addressed, so the address
 * decides where it answers — within its scope: `--channels` and `--dm-only` NARROW the conversations it acts
 * on, so a demo can be proved in a DM without going live everywhere (`../../../live/listen/scope.ts`), and
 * `--thread-replies` opts ONE channel at a time into answering replies under the bot's own posts
 * (`../../../live/listen/threadReply.ts`). `--check` exists so the whole
 * credential story can be proved without opening anything, and `--once` so a live test is bounded — the
 * listener handles exactly one tag and exits, instead of being left running by a script.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type ListenError, ListenErrors } from "./errors.js";

/**
 * The verb's flag spec. Exported so a canon binding can read which flags are declared BOOLEAN — a MODE a
 * validator can branch on — rather than re-declaring that list beside it (`src/canon/listenDeadline.ts`),
 * the same reason `listen recover` exports `LISTEN_RECOVER_FLAG_SPEC`.
 */
export const LISTEN_FLAG_SPEC: FlagSpec = {
  boolean: ["check", "dm-only", "emit", "follow", "json", "once"],
  string: ["channels", "deadline-ms", "heartbeat", "home", "queue", "thread-replies"],
};

/** `--`-prefixed flag names, for the help-truth ratchet. */
export const LISTEN_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LISTEN_FLAG_SPEC }),
  ...booleanFlagsOf({ spec: LISTEN_FLAG_SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** What the verb was asked to do. */
export interface ListenOptions {
  /** Report the credentials and exit — never opens a socket. */
  readonly check: boolean;
  /**
   * Print the captured mention and answer nothing.
   *
   * Implies {@link ListenOptions.once} — UNLESS {@link ListenOptions.follow} is set, and that override is
   * folded in here too. The mention IS the output, so a second one would print into a stream whose reader
   * has already moved on to doing the turn — that is what makes `--emit` without `--once` or `--follow`
   * incoherent. `--follow` is the one thing that makes printing a SECOND mention coherent: the caller is
   * staying connected on purpose, so `once` is folded to `false` regardless of what `--emit` would otherwise
   * imply.
   */
  readonly emit: boolean;
  /**
   * Stay connected indefinitely instead of stopping after one mention: the continuous alternative to
   * `--once`. `--follow` and a literal `--once` are refused together by {@link validateListenModes} before
   * this is ever built, so by the time `once` is folded below, `--once` was never typed when this is true.
   */
  readonly follow: boolean;
  /** Handle one mention, then stop. Folded to `false` whenever {@link ListenOptions.follow} is set. */
  readonly once: boolean;
  /** Render the `--check` report as JSON. */
  readonly json: boolean;
  /** The state home to resolve secrets and record door decisions under. */
  readonly home: string | undefined;
  /** Where to ALSO append every captured tag as a durable JSONL line, or `undefined` for nowhere. */
  readonly queuePath: string | undefined;
  /**
   * The arm id to stamp every supervision heartbeat with, or `undefined` to write none. Set by
   * `listen arm`; see `live/listen/supervise/heartbeat.ts` for what the beat carries and why.
   */
  readonly heartbeatArmId: string | undefined;
}

/**
 * Refuse `--follow` together with `--once`: they are opposite instructions for when the listener stops, and
 * silently preferring one over the other would silently drop half of what the caller typed.
 *
 * Takes the RAW `--once` flag as typed — before `--emit`'s fold-in (see {@link listenOptions}) — so a caller
 * combining `--follow` with `--emit` alone (no literal `--once`) is not caught by a conflict that exists only
 * because of what `--emit` implies.
 *
 * @param follow whether `--follow` was passed
 * @param once whether the literal `--once` flag was passed
 * @returns ok, or the one rejection naming both flags
 */
export function validateListenModes({ follow, once }: { follow: boolean; once: boolean }): Result<void, ListenError> {
  if (follow && once) {
    return err(ListenErrors.followWithOnce());
  }
  return ok(undefined);
}

/**
 * Refuse `--heartbeat` outside `--follow`.
 *
 * A heartbeat exists so a SUPERVISOR can tell a live listener from a dead one, and there is nothing to
 * supervise about a listener that handles one tag and exits — a one-shot's beat would go stale within
 * seconds of a perfectly successful run, and a supervisor reading it would re-arm a listener that was never
 * meant to still be there.
 *
 * @param follow whether `--follow` was passed
 * @param heartbeatArmId the `--heartbeat` value, or `undefined` when the flag was not given
 * @returns ok, or the one rejection naming both flags
 */
export function validateHeartbeatMode({
  follow,
  heartbeatArmId,
}: {
  follow: boolean;
  heartbeatArmId: string | undefined;
}): Result<void, ListenError> {
  if (heartbeatArmId !== undefined && !follow) {
    return err(ListenErrors.heartbeatWithoutFollow());
  }
  return ok(undefined);
}

/**
 * Parse `listen`'s flags.
 *
 * Exported so the help-truth ratchet pushes every advertised flag through the REAL parser rather than
 * comparing two declarations with each other.
 *
 * @param rest the argv after the noun (and after a literal `run`, which the shell strips)
 * @returns the parsed flags, or every rejection
 */
export function parseListenArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: LISTEN_FLAG_SPEC });
}

/**
 * Validate `--deadline-ms` against the rest of the parsed flags: a positive safe integer, given only
 * alongside `--emit --json` and never `--check`/`--follow`, or omitted entirely.
 *
 * Deliberately separate from {@link listenOptions} — which never fails and must keep not failing, so an
 * existing pre-diff caller stays source-compatible — the same shape {@link validateListenModes} already
 * established for `--follow`/`--once`. Call this BEFORE {@link listenOptions}, refuse on its own rejection,
 * and thread its resolved value through as its own parameter rather than folding it into `ListenOptions`.
 *
 * @param parsed the parsed flags
 * @returns `ok(undefined)` when the flag was not given, `ok(value)` for a valid one, or every rejection
 */
export function validateDeadlineMode({ parsed }: { parsed: ParsedFlags }): Result<number | undefined, ListenError> {
  const raw = parsed.values["deadline-ms"];
  if (raw === undefined) {
    return ok(undefined);
  }
  if (typeof raw !== "string" || raw.length === 0) {
    return err(ListenErrors.deadlineValueMissing());
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return err(ListenErrors.deadlineNotPositive({ got: raw }));
  }
  const emit = parsed.values["emit"] === true;
  const json = parsed.values["json"] === true;
  const check = parsed.values["check"] === true;
  const follow = parsed.values["follow"] === true;
  if (!emit || !json || check || follow) {
    return err(ListenErrors.deadlineOutsideEmitJson());
  }
  return ok(value);
}

/**
 * Fold parsed flags into the verb's options.
 *
 * @param parsed the parsed flags
 * @returns what the verb was asked to do
 */
export function listenOptions({ parsed }: { parsed: ParsedFlags }): ListenOptions {
  const home = parsed.values["home"];
  const queue = parsed.values["queue"];
  const heartbeat = parsed.values["heartbeat"];
  const emit = parsed.values["emit"] === true;
  const follow = parsed.values["follow"] === true;
  return {
    check: parsed.values["check"] === true,
    emit,
    follow,
    heartbeatArmId: typeof heartbeat === "string" && heartbeat.length > 0 ? heartbeat : undefined,
    home: typeof home === "string" && home.length > 0 ? home : undefined,
    json: parsed.values["json"] === true,
    // `--emit` implies `--once` — UNLESS `--follow` is set, in which case `once` folds to `false`
    // regardless. See the field's comment: emitting a second mention would print into a stream whose
    // reader has already left to do the turn, EXCEPT that is exactly what `--follow` asks for.
    once: follow ? false : emit || parsed.values["once"] === true,
    queuePath: typeof queue === "string" && queue.length > 0 ? queue : undefined,
  };
}

/**
 * The stub acknowledgement — the ONE message this verb posts, and it says exactly what it is.
 *
 * It is not an answer and must never read like one. This half of the feature is transport: it proves a tag
 * reached this machine and that a reply can go back into the same thread. The turn that actually answers is
 * built separately and replaces this handler; until it lands, a message implying an answer is coming would
 * be the silent-failure shape this codebase keeps recording — a claim the system cannot yet honour.
 *
 * `userId` is echoed as a live `<@…>` Slack mention only when it is shaped like a real Slack user id
 * (`U…`/`W…`) — `Mention.userId` can also be a peer bot's `bot_id` (`B…`), for an event
 * that carried no `user` field at all, and `<@B…>` is not valid Slack mention syntax; a review pass found
 * this would have posted broken tag syntax for exactly that case.
 *
 * @param userId the identity that addressed the bot — a Slack user id, or a peer bot's `bot_id`
 * @returns the message text to post in the thread
 */
export function acknowledgementText({ userId }: { userId: string }): string {
  const who = userId.startsWith("U") || userId.startsWith("W") ? `<@${userId}>` : `\`${userId}\``;
  return (
    `${who} got your message — the listener is live and this thread reached my machine.\n` +
    "This is the transport acknowledgement, not an answer: the turn that reads the corpus and replies is a " +
    "separate piece of work."
  );
}
