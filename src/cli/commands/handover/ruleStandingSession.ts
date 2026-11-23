/**
 * The STANDING-SESSION half of `handover rule`: reading `--standing-session` / `--standing-until` into the shape a
 * ruling carries, and the line the verb prints once one is recorded.
 *
 * A dedicated session the owner talks to stays open
 * between their turns. What reads it is `../../../handover/standingSession.ts`. Its own module so `./ruleRun.ts` stays
 * one ruling's verb, the shape `./ruleSteer.ts` set.
 */
import { isCanonicalInstant } from "../../../handover/ruling.js";
import type { StandingSession } from "../../../handover/standingSessionTypes.js";

/**
 * The standing session one invocation declares, `undefined` when it declares none, or the refusal to print.
 *
 * @param values the parsed flags, read for `standing-session` and `standing-until`
 * @returns the standing session, `undefined` for a ruling that makes none, or why the flags are refused
 */
export function standingSessionPlan({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly refusal: string } | { readonly standingSession: StandingSession | undefined } {
  const until = typeof values["standing-until"] === "string" ? values["standing-until"].trim() : "";
  if (values["standing-session"] !== true) {
    if (until.length > 0) {
      return { refusal: "--standing-until names when a STANDING SESSION ends — pass --standing-session with it" };
    }
    return { standingSession: undefined };
  }
  if (until.length === 0) {
    return { standingSession: {} };
  }
  if (!isCanonicalInstant({ iso: until })) {
    return {
      refusal:
        `--standing-until "${until}" is not a canonical UTC instant (YYYY-MM-DDTHH:MM:SS.sssZ, as toISOString() ` +
        "writes it) — close-done and the chair compare it to decide whether the owner's seat may close",
    };
  }
  return { standingSession: { untilIso: until } };
}

/**
 * Say what a recorded standing-session ruling now does.
 *
 * @param atIso the instant the ruling was recorded, to say whether its bound ends the session at once
 * @param standingSession the standing session just recorded
 * @returns the line
 */
export function standingSessionAnnouncement({
  atIso,
  standingSession,
}: {
  atIso: string;
  standingSession: StandingSession;
}): string {
  const { untilIso } = standingSession;
  if (untilIso !== undefined && Date.parse(untilIso) <= Date.parse(atIso)) {
    return `  it ENDS this row's standing session as of ${untilIso}: close-done may park the seat again`;
  }
  const until = untilIso === undefined ? "until a later --standing-session ruling ends it" : `until ${untilIso}`;
  return (
    `  it makes this row's seat a STANDING SESSION ${until}: close-done never parks it, \`handover park\` refuses it, ` +
    "and the chair's reconcile reads it ready to seat again if it is found parked"
  );
}
