/**
 * Who the offboarding evidence counts as a leaver, read off each person's own CURRENT record and never off a run.
 *
 * A person is a current leaver when Trelica records them `Terminated`, or flags them a leaver with a removal or
 * leaving date due as of the generation. An offboarding run is not that evidence: one names a rehire, a test or a
 * reversed leave as readily as a leaver. MEASURED: the live offboarding runs named people whose current
 * record read `Active` with `leaver: false`, and others flagged a leaver with no date at all.
 *
 * Pure over the held people `heldDetails.ts` reads.
 */
import type { HeldTrelicaPerson } from "./heldDetails.js";
import { trelicaIdentityAccountState } from "./offboardingVerdicts.js";

/** What a person's own current record says about their leaving, the first two making them a current leaver. */
export type TrelicaLeaverStanding =
  | "terminated"
  | "leaving-date-due"
  | "not-a-leaver"
  | "leaver-without-date"
  | "leaving-date-not-due"
  | "no-current-record";

/** The standings that make a person a current leaver. */
const CURRENT_LEAVER: ReadonlySet<TrelicaLeaverStanding> = new Set(["terminated", "leaving-date-due"]);

/** Where a person with no offboarding run falls. */
export type TrelicaUnrunCohort = "named" | "no-date" | "before-first-run" | "not-due";

/** The day a person left or leaves, removal first, or `null` when their record carries neither date. */
function leftDay({ person }: { person: HeldTrelicaPerson }): string | null {
  if (person.removedDate !== null) {
    return person.removedDate.slice(0, 10);
  }
  return person.leavingDate === null ? null : person.leavingDate.slice(0, 10);
}

/**
 * What a person's own current record says about their leaving, as of the generation.
 *
 * @param person the held person, or `undefined` when a run names someone the held people do not include
 * @param asOf the generation's own instant, which a leaving date being due is judged against
 * @returns the standing
 */
export function trelicaLeaverStanding({
  person,
  asOf,
}: {
  person: HeldTrelicaPerson | undefined;
  asOf: string;
}): TrelicaLeaverStanding {
  if (person === undefined) {
    return "no-current-record";
  }
  if (person.status === "Terminated") {
    return "terminated";
  }
  if (!person.leaver) {
    return "not-a-leaver";
  }
  const day = leftDay({ person });
  if (day === null) {
    return "leaver-without-date";
  }
  return day > asOf.slice(0, 10) ? "leaving-date-not-due" : "leaving-date-due";
}

/**
 * Whether a standing makes a person a current leaver.
 *
 * @returns `true` for a Terminated person and a flagged leaver whose date is due
 */
export function isCurrentTrelicaLeaver({ standing }: { standing: TrelicaLeaverStanding }): boolean {
  return CURRENT_LEAVER.has(standing);
}

/**
 * Where a person with no offboarding run falls: named, one of the two counted cohorts, or not a leaver owed a run.
 * A current leaver still holding a live Identity account is named whatever their date; otherwise a run was owed
 * only when they left on or after the first offboarding run.
 *
 * @param firstRunAt the oldest held offboarding run's instant, or `null` when there is none
 * @param asOf the generation's own instant
 * @returns the cohort
 */
export function trelicaUnrunCohort({
  person,
  firstRunAt,
  asOf,
}: {
  person: HeldTrelicaPerson;
  firstRunAt: string | null;
  asOf: string;
}): TrelicaUnrunCohort {
  const standing = trelicaLeaverStanding({ asOf, person });
  if (standing === "leaver-without-date") {
    return "no-date";
  }
  if (!CURRENT_LEAVER.has(standing)) {
    return "not-due";
  }
  if (trelicaIdentityAccountState({ person }).live.length > 0) {
    return "named";
  }
  const day = leftDay({ person });
  if (day === null) {
    return "no-date";
  }
  if (day > asOf.slice(0, 10)) {
    return "not-due";
  }
  return firstRunAt !== null && day >= firstRunAt.slice(0, 10) ? "named" : "before-first-run";
}
