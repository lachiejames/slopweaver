/**
 * When a `slack status set` expires, and how an expiry reads back. Kept out of `./statusCore.ts` so the one
 * importer of the calendar zone arithmetic is a file only the shell loads, and the core stays light.
 */
import { epochSecondsToIso } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import { renderInZone } from "../../../live/calendar/wallClockText.js";
import { localMinuteToMs } from "../../../live/calendar/zoneClock.js";
import type { StatusExpiryRequest } from "./statusCore.js";
import { type SlackStatusError, SlackStatusErrors } from "./statusErrors.js";

/** Minutes from local midnight to the NEXT local midnight — which is what "end of day" is. */
const END_OF_DAY_MINUTE = 24 * 60;

/**
 * The instant a status should expire, from the request and the current instant.
 *
 * `end-of-day` is the next local midnight in the named zone, found by the calendar's DST-safe wall-clock
 * search, so a spring-forward or fall-back day still ends at its own midnight.
 *
 * @param request what the caller asked for
 * @param nowMs the current instant
 * @returns the expiry in epoch milliseconds, `undefined` for a status that never expires, or the refusal
 */
export function resolveStatusExpiry({
  request,
  nowMs,
}: {
  request: StatusExpiryRequest;
  nowMs: number;
}): Result<number | undefined, SlackStatusError> {
  if (request.kind === "never") {
    return ok(undefined);
  }
  if (request.kind === "end-of-day") {
    const atMs = localMinuteToMs({ dayMs: nowMs, minute: END_OF_DAY_MINUTE, zone: request.zone });
    return atMs === undefined ? err(SlackStatusErrors.zoneUnknown({ zone: request.zone })) : ok(atMs);
  }
  if (request.atMs <= nowMs) {
    return err(SlackStatusErrors.untilNotFuture({ untilIso: new Date(request.atMs).toISOString() }));
  }
  return ok(request.atMs);
}

/**
 * Read an expiry back as text: `never`, the local wall clock in a named zone, or the UTC instant.
 *
 * @param expirationSeconds Slack's `status_expiration`, where 0 is "never"
 * @param zone the zone to render in; absent renders the ISO instant and never a guessed zone
 * @returns the text
 */
export function renderExpiry({
  expirationSeconds,
  zone,
}: {
  expirationSeconds: number;
  zone: string | undefined;
}): string {
  const iso = epochSecondsToIso({ seconds: expirationSeconds });
  if (expirationSeconds === 0 || iso === undefined) {
    return "never";
  }
  if (zone === undefined) {
    return iso;
  }
  return `${renderInZone({ atMs: Date.parse(iso), zone })} ${zone} (${iso})`;
}
