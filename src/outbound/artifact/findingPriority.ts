/**
 * The finding matrix: how bad an issue is for the person it reaches, against how many unique people it reached,
 * resolved to a priority — and the bar a priority clears to be worth a post at all.
 *
 * ## The ruling
 *
 * A regression-hunt reply bundled five leads with no ranking. A priority matrix ranks an issue by impact against
 * blast radius and resolves to a priority; how many people it reached, counted by unique user id, is the best
 * blast-radius measure, because one user in a hundred sessions matters less than a hundred users in one session.
 * Priority is the metric that decides what is worth surfacing, for something the team is not yet talking about
 * or tracking. The judgement test for every cell is how the owner would grade impact and priority.
 *
 * ## Why this is not `./priority.ts`
 *
 * That matrix ranks an ALERT by severity against a share of a service's telemetry volume, and its own header
 * says that share is not a user count and cannot become one. This matrix's blast-radius axis IS a count of
 * unique users, so the two cannot share cells. They share only the P0–P4 vocabulary.
 *
 * ## The cells that carry the argument
 *
 * - **P0 is `high` × `many` alone** — a hundred or more people who cannot do the thing they came to do.
 * - **`high` × `one` is P3**, below the bar: one customer is a small blast radius, probably
 *   not worth raising.
 * - **`low` × `many` is P2**, the one `low` cell that clears the bar. An occasional popup is the example of
 *   `low`; reaching a hundred people with it is still worth a post, once.
 * - **`unknown` reads the `few` cell exactly.** An unmeasured count is evidence of neither a wide blast radius
 *   nor a narrow one, and a finding whose telemetry carries no user id still has to be rankable.
 *
 * ## Staging is capped, not excluded
 *
 * A staging fault has reached no customer, so it never outranks {@link STAGING_PRIORITY_CEILING}. The ceiling
 * sits AT the bar rather than below it, and that is a judgement made here rather than a stated rule: every finding
 * must say staging or prod, which only means something if a staging finding can be posted. So
 * a staging regression surfaces when its cell would be P0–P2 in production, and always as P2.
 */
import { PRIORITIES, type Priority } from "./priority.js";

/** How badly the issue hurts the person it reaches, worst first. Judged, never counted. */
export const FINDING_IMPACT_GRADES = ["high", "medium", "low"] as const;

/** One finding's impact grade. */
export type FindingImpactGrade = (typeof FINDING_IMPACT_GRADES)[number];

/** Where the issue was seen. */
export const FINDING_ENVS = ["production", "staging"] as const;

/** One finding's environment. */
export type FindingEnv = (typeof FINDING_ENVS)[number];

/** The blast-radius bands, widest first, as {@link findingUserBandOf} cuts them from a unique-user count. */
export const FINDING_USER_BANDS = ["many", "some", "few", "one", "unknown"] as const;

/** A finding's blast radius as a band. */
export type FindingUserBand = (typeof FINDING_USER_BANDS)[number];

/** At or above this many unique users the blast radius is `many`. */
const MANY_USERS = 100;

/** At or above this many unique users the blast radius is `some`. */
const SOME_USERS = 10;

/** At or above this many unique users the blast radius is `few`; exactly one is `one`. */
const FEW_USERS = 2;

/** The finding matrix: impact down, blast radius across. See this module's header for the cells that argue. */
export const FINDING_PRIORITY_MATRIX: Readonly<
  Record<FindingImpactGrade, Readonly<Record<FindingUserBand, Priority>>>
> = {
  high: { few: "P2", many: "P0", one: "P3", some: "P1", unknown: "P2" },
  low: { few: "P4", many: "P2", one: "P4", some: "P3", unknown: "P4" },
  medium: { few: "P3", many: "P1", one: "P3", some: "P2", unknown: "P3" },
};

/** The most urgent priority a STAGING finding can hold: no customer has hit it yet. */
export const STAGING_PRIORITY_CEILING: Priority = "P2";

/** The priorities worth a post: a finding deriving anything else is refused by the form. */
const SURFACEABLE_FINDING_PRIORITIES: ReadonlySet<Priority> = new Set<Priority>(["P0", "P1", "P2"]);

/**
 * The band one unique-user count falls in.
 *
 * @param users the measured count of unique users, at least one, or undefined when nothing could count it
 * @returns the band, `unknown` when there is no count to band
 */
export function findingUserBandOf({ users }: { users: number | undefined }): FindingUserBand {
  if (users === undefined) {
    return "unknown";
  }
  if (users >= MANY_USERS) {
    return "many";
  }
  if (users >= SOME_USERS) {
    return "some";
  }
  if (users >= FEW_USERS) {
    return "few";
  }
  return "one";
}

/**
 * The priority one finding derives: its matrix cell, held to {@link STAGING_PRIORITY_CEILING} in staging.
 *
 * @param env where the issue was seen
 * @param grade how badly it hurts the person it reaches
 * @param users the unique-user count, or undefined when unmeasured
 * @returns the derived priority
 */
export function findingPriorityOf({
  env,
  grade,
  users,
}: {
  env: FindingEnv;
  grade: FindingImpactGrade;
  users: number | undefined;
}): Priority {
  const cell = FINDING_PRIORITY_MATRIX[grade][findingUserBandOf({ users })];
  if (env === "staging" && PRIORITIES.indexOf(cell) < PRIORITIES.indexOf(STAGING_PRIORITY_CEILING)) {
    return STAGING_PRIORITY_CEILING;
  }
  return cell;
}

/** How each band reads in a priority's reason, so a reader sees the count the cell was cut from. */
const USER_BAND_PHRASES: Readonly<Record<FindingUserBand, string>> = {
  few: "2 to 9 users",
  many: "100 or more users",
  one: "1 user",
  some: "10 to 99 users",
  unknown: "an uncounted blast radius, ranked as 2 to 9 users",
};

/**
 * Why one finding holds the priority it derives, in words a team channel reads: the impact grade, the blast
 * radius band it was ranked on, and the staging ceiling when that is what set it. Any post
 * about these Datadog findings includes blast radius, impact and priority clearly — a bare P-level says how urgent and not why, so the card carries the cell it was read from.
 *
 * Commas only: `../voice/aboveFold.ts` refuses a colon-introduced list and a second parenthetical above the fold.
 *
 * @param env where the issue was seen, which decides whether the staging ceiling applied
 * @param grade how badly it hurts the person it reaches
 * @param users the unique-user count, or undefined when unmeasured
 * @returns the reason, such as `high impact on 2 to 9 users, capped from P0 in staging`
 */
export function findingPriorityReason({
  env,
  grade,
  users,
}: {
  env: FindingEnv;
  grade: FindingImpactGrade;
  users: number | undefined;
}): string {
  const band = findingUserBandOf({ users });
  const cell = FINDING_PRIORITY_MATRIX[grade][band];
  const reason = `${grade} impact on ${USER_BAND_PHRASES[band]}`;
  if (findingPriorityOf({ env, grade, users }) === cell) {
    return reason;
  }
  return `${reason}, capped from ${cell} in staging`;
}

/**
 * Whether a derived priority clears the surfacing bar.
 *
 * @param priority the derived priority
 * @returns true for P0, P1 and P2
 */
export function isSurfaceableFindingPriority({ priority }: { priority: Priority }): boolean {
  return SURFACEABLE_FINDING_PRIORITIES.has(priority);
}
