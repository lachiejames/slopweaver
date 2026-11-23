/**
 * The `recheck` field's SHAPE — what a register line must carry for a step's precondition to read at all.
 *
 * Apart from `./recheck.ts` on purpose. `./row.ts` re-validates every register line through `./step.ts` on READ, and a
 * read that consulted the probe registry would turn every old line into an unreadable one the day a platform's row
 * left it. So reading checks only the shape; whether the fleet can still READ that origin is `hand post`'s refusal
 * (`./recheck.ts`'s `parseRecheckFlag`) and `hand recheck`'s `unread`, never a corrupt line. Pure.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/** The precondition one step waits for, which a sweep can read for itself (`./recheck.ts`). */
export type HandRecheck =
  | { readonly kind: "browser-session"; readonly origin: string }
  | { readonly kind: "slack-member"; readonly channel: string };

/** A Slack conversation id — a public `C…` or a private `G…` channel. Never a name: a name moves, an id does not. */
const CHANNEL_ID = /^[CG][A-Z0-9]{8,}$/;

/** What a recheck is, said in every refusal of one. */
export const RECHECK_SHAPE =
  "is `browser-session:<https origin>` for a sign-in the fleet can read, or `slack-member:<C… or G… channel id>` for a channel the owner joins";

/**
 * The refusal for a recheck outside the shape.
 *
 * @param why what was wrong with it
 * @returns the error, on the `recheck` field
 */
export function invalidRecheck({ why }: { why: string }): HandStepError {
  return HandStepErrors.invalidField({ field: "recheck", why });
}

/**
 * The bare origin a value names, when it is an `https` origin and nothing more.
 *
 * @param value the candidate origin
 * @returns the origin, or `undefined` when it carries a path, a query or another scheme
 */
export function bareHttpsOrigin({ value }: { value: string }): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && value.replace(/\/$/, "") === url.origin ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a value is a Slack channel id a membership read can take.
 *
 * @param channel the candidate
 * @returns true for a `C…` or `G…` id
 */
export function isChannelId({ channel }: { channel: string }): boolean {
  return CHANNEL_ID.test(channel);
}

/**
 * A register line's `recheck`, checked as a shape — or honestly absent. A present value of the wrong shape is a corrupt
 * line, never a step that names nothing: reading it as absent would quietly switch its recheck off.
 *
 * @param value whatever the caller or the register line carried
 * @returns the recheck, `undefined` when absent, or the refusal
 */
export function checkedRecheck({ value }: { value: unknown }): Result<HandRecheck | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return err(invalidRecheck({ why: RECHECK_SHAPE }));
  }
  const { kind, origin, channel } = value;
  if (kind === "browser-session" && typeof origin === "string") {
    const bare = bareHttpsOrigin({ value: origin });
    return bare === origin ? ok({ kind, origin }) : err(invalidRecheck({ why: RECHECK_SHAPE }));
  }
  if (kind === "slack-member" && typeof channel === "string" && isChannelId({ channel })) {
    return ok({ channel, kind });
  }
  return err(invalidRecheck({ why: RECHECK_SHAPE }));
}
