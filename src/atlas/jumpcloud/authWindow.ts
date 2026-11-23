/**
 * The window a JumpCloud Directory Insights auth read asks for, and the provider's retention floor under it.
 *
 * Pure, like `./authEvents.ts` beside it: that module decides what one page of events means, this one decides
 * whether a pair of instants is a window any page could answer.
 */
import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type JumpcloudWindowError, JumpcloudWindowErrors } from "./errors.js";

/**
 * How far back Directory Insights holds an event at all, in days.
 *
 * @internal
 *
 * MEASURED, and it is the single most important thing to know about this whole read. A
 * `start_time` older than this answers HTTP 400 with the provider's own sentence, at every limit and with
 * or without an `end_time`:
 *
 * > `start_time is greater than Directory Insights' 90 day retention period. Please change your start_time`
 *
 * Reproduce with `slopweaver atlas jumpcloud auth-events --since <any instant 91+ days old>`.
 *
 * **What that means for an answer built on this read, stated rather than left to be worked out.**
 * JumpCloud can prove somebody WAS here inside ninety days. It can never prove somebody has been silent
 * for longer than ninety days, because there is nothing older to have looked at — so "no JumpCloud auth in
 * the window" and "dormant for a year" are different claims, and only the first is one this endpoint
 * supports. A dormancy answer that reported the second off this signal would be confidently wrong about
 * exactly the people it is most important to be right about.
 */
export const JUMPCLOUD_INSIGHTS_RETENTION_DAYS = 90;

/**
 * The provider's own refusal for a start older than retention, quoted so the window check can say it
 * without spending a request to be told.
 * @internal
 */
export const JUMPCLOUD_RETENTION_REFUSAL =
  "start_time is greater than Directory Insights' 90 day retention period. Please change your start_time";

/** The window one invocation asked for, once both ends are instants, in order, and inside retention. */
export interface AuthWindow {
  readonly startIso: string;
  readonly endIso: string;
}

/** Milliseconds in one day, so the retention floor reads as a window rather than as four factors. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve the two ends of a read's window, refusing a pair no read could answer.
 *
 * It lives HERE rather than in the verb that parses the flags, and that is not filing: it is the only part
 * of the argument handling that encodes something true about JumpCloud rather than about a command line.
 * The retention floor in particular is a measured property of the provider
 * ({@link JUMPCLOUD_INSIGHTS_RETENTION_DAYS}), so it is refused here — carrying the provider's own sentence
 * — rather than spending a request to be told, the same discipline `requestContracts.ts` keeps.
 *
 * The refusal names what the caller asked for AND what the boundary is, because the interesting case is
 * somebody asking for a year and needing to learn that no answer over that window exists at all.
 *
 * @param since the caller's start, required
 * @param until the caller's end, defaulting to this invocation's own clock
 * @param nowIso the current instant, injected so both the default end and the retention floor are testable
 * @returns the window, or every reason it is not one
 */
export function resolveAuthWindow({
  since,
  until,
  nowIso,
}: {
  since: string | undefined;
  until: string | undefined;
  nowIso: string;
}): Result<AuthWindow, JumpcloudWindowError> {
  if (since === undefined) {
    return err(JumpcloudWindowErrors.startMissing());
  }
  const startMs = parseIsoMs({ tsIso: since });
  if (startMs === undefined) {
    return err(JumpcloudWindowErrors.notAnInstant({ flag: "--since", raw: since }));
  }
  const { endIso, endMs } = windowEnd({ nowIso, until });
  if (endMs === undefined) {
    return err(JumpcloudWindowErrors.notAnInstant({ flag: "--until", raw: endIso }));
  }
  if (endMs <= startMs) {
    return err(JumpcloudWindowErrors.emptyWindow({ endIso, since }));
  }
  const tooOld = retentionRefusal({ nowIso, since, startMs });
  if (tooOld !== null) {
    return tooOld;
  }
  return ok({ endIso, startIso: since });
}

/**
 * The end of the window, parsed: the caller's, or — when `--until` was not passed, which is the documented
 * default rather than a missing value — this invocation's own clock.
 *
 * An `if` rather than a `??` or a ternary, for the reason {@link ./authEvents.lowercased} states.
 *
 * @param until the caller's end, absent when they took the default
 * @param nowIso this invocation's clock
 * @returns the instant the window ends at, and its epoch — `undefined` when that instant does not parse
 */
function windowEnd({ until, nowIso }: { until: string | undefined; nowIso: string }) {
  if (until === undefined) {
    return { endIso: nowIso, endMs: parseIsoMs({ tsIso: nowIso }) };
  }
  return { endIso: until, endMs: parseIsoMs({ tsIso: until }) };
}

/**
 * The refusal for a start older than Directory Insights keeps, or `null` when the window is inside it.
 *
 * @param startMs the window's start, already parsed
 * @param since the start as the caller wrote it, for the refusal
 * @param nowIso this invocation's clock
 * @returns the refusing `Result`, or `null` when there is nothing to refuse
 */
function retentionRefusal({
  startMs,
  since,
  nowIso,
}: {
  startMs: number;
  since: string;
  nowIso: string;
}): Result<AuthWindow, JumpcloudWindowError> | null {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (nowMs === undefined || nowMs - startMs <= JUMPCLOUD_INSIGHTS_RETENTION_DAYS * MS_PER_DAY) {
    return null;
  }
  const floor = new Date(nowMs - JUMPCLOUD_INSIGHTS_RETENTION_DAYS * MS_PER_DAY).toISOString();
  return err(
    JumpcloudWindowErrors.pastRetention({
      floorIso: floor,
      providerSaid: JUMPCLOUD_RETENTION_REFUSAL,
      retentionDays: JUMPCLOUD_INSIGHTS_RETENTION_DAYS,
      since,
    }),
  );
}
