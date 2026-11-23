/**
 * What `codex route` concludes about the whole Codex fleet — one derived report, from one snapshot.
 *
 * Pure: a snapshot and a requested model in, a report out. It replaces the single-account answer
 * `./loadBalance.ts` used to give, whose `balance: "not-applicable"` was true only while this machine had
 * exactly one Codex home and became a confident falsehood the moment the register could hold several.
 *
 * ## Every field is DERIVED, and nothing is omitted
 *
 * A row the ranking excluded still appears, with the reason. A destination with no reading still appears,
 * saying it has none. A field a source could not supply is an explicit `null` in the JSON rather than a
 * missing key, because `JSON.stringify` drops an `undefined` and a reader cannot tell a dropped key from a
 * field that was never asked for. The bar this is written to is trust: a status surface that omits the
 * awkward row is one nobody can act on.
 *
 * ## What an unread destination is allowed to SAY
 *
 * "No usable weekly observation; no standing refusal found; deferred behind measured destinations." It may
 * not say `0%`, `healthy` or `full capacity`. Nothing on this path reads `auth.json`: "signed in as" is said
 * only when the store's OWN app-server answered `account/read` in this read (`./accountLive.ts`), and every
 * row names which source its percentages came from — `live`, `rollout` or `none` — so a days-old log line
 * is never presented as the account's state now.
 *
 * ## Two percentages are not two capacities
 *
 * A spread is reported in PERCENTAGE POINTS between destinations, with its sample count, and never summed.
 * Two registered homes may be signed into the same account (`../plans/types.ts` says so outright), and two
 * different `limitId`s or plan types are different allowances entirely — so the `limitId` and `planType` of
 * every row are carried beside the number rather than folded into it, and no threshold here calls a spread
 * "balanced".
 *
 * ## A monthly allowance is NOT MEASURED, never `0%`
 *
 * A `monthly-spend` row (`../plans/usageLimit.ts`) is spend nothing here reads, so whatever window its store
 * reports is no measure of it: its two percentages are `null`, it counts toward no measured total or spread, and
 * the renderer says NOT MEASURED where a weekly row prints its percentage.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { parseIsoMs } from "#lib/date.js";

import type { PlanDiagnostic } from "../plans/types.js";
import type { PlanAllowanceKind, UsageLimitPercent } from "../plans/usageLimit.js";
import type { CodexDestination } from "./destinations.js";
import { codexFleetAdvisories } from "./fleetCap.js";
import type { CodexFleetSnapshot, CodexGaugeSource, CodexPlanObservation, CodexPlanRanking } from "./fleetTypes.js";
import type { CodexGauge, CodexWindowLabel } from "./gauge.js";
import { codexWindowByLabel } from "./gauge.js";
import { rankCodexPlans } from "./rank.js";

/** Milliseconds in a second, for turning an observation's own instant into an age a reader can judge. */
const MS_PER_SECOND = 1000;

/** How the fleet's usage compares across destinations, or exactly why it cannot be compared. */
export type CodexSpread =
  /** Two or more destinations carried a usable reading of the same window. */
  | { readonly kind: "spread"; readonly points: number; readonly samples: number; readonly ofDestinations: number }
  /** Fewer than two comparable readings exist, so there is nothing to compare — not a balanced fleet. */
  | { readonly kind: "not-applicable"; readonly reason: string };

/**
 * Which destination new work would take, or why none would.
 *
 * @internal — a field of {@link CodexFleetAssessment}; a caller reads it off the assessment.
 */
export type CodexSelection =
  | { readonly kind: "selected"; readonly destination: CodexDestination }
  | { readonly kind: "none"; readonly reason: string };

/** One destination's row in the report: the register's view, the evidence, and the routing disposition. */
export interface CodexFleetRow {
  readonly alias: string;
  readonly codexHome: string;
  /** The address the owner CALLS this destination, cached for display. Never its identity, never checked. */
  readonly emailCached: string | null;
  readonly pausedReason: string | null;
  readonly pausedSinceIso: string | null;
  /** What the register says this plan's allowance is measured in; `monthly-spend` is NOT MEASURED here. */
  readonly allowance: PlanAllowanceKind;
  /** The share of that allowance the owner lets Slopweaver take, from the register row. */
  readonly usageLimitPercent: UsageLimitPercent;
  /** `ranked` with its position, `excluded` with its kind, so no row is silently missing from the order. */
  readonly disposition: string;
  readonly dispositionReason: string;
  /** What the store's own app-server said in this read: `signed-in`, `signed-out`, `store-missing`, `unreadable`. */
  readonly liveState: CodexPlanObservation["live"]["kind"];
  /** The address the provider reported live, or null when the live read established none. */
  readonly liveEmail: string | null;
  /** Why the live read could not answer, or null when it did. */
  readonly liveUnreadableReason: string | null;
  /** Free usage-limit resets the account holds, or null when no signed-in live read counted them. */
  readonly resetCreditsAvailable: number | null;
  /** The reading the ranking used — live, else rollout when the live read failed — or null for none. */
  readonly gauge: CodexGauge | null;
  /** Where {@link gauge} came from. */
  readonly gaugeSource: CodexGaugeSource;
  /** How old that reading is at `readAtIso`, or null when there is no reading or no usable instant. */
  readonly observationAgeSeconds: number | null;
  /** The week's used percentage, or null when unread — and always null on a `monthly-spend` row. */
  readonly weeklyUsedPercent: number | null;
  /** The five hours' used percentage, or null when unread — and always null on a `monthly-spend` row. */
  readonly fiveHourUsedPercent: number | null;
  readonly filesRead: number;
  /** Candidates the bound excluded WITHIN the day directories it looked at — not a census of every file. */
  readonly filesSkipped: number;
  /**
   * Why this row's rollout scan never ran — the two file counts mean nothing then. ABSENT when it ran, so a read
   * with no deadline serialises exactly the row it always did.
   */
  readonly scanSkippedReason?: string;
  readonly refusing: boolean;
  readonly refusalReason: string | null;
}

/** The whole derived answer `codex route` prints, in either shape. */
export interface CodexFleetAssessment {
  readonly readAtIso: string;
  readonly requestedModel: string;
  readonly registerDiagnostics: readonly PlanDiagnostic[];
  readonly destinations: number;
  readonly unpaused: number;
  readonly refusing: number;
  readonly weeklyMeasured: number;
  readonly fiveHourMeasured: number;
  readonly rows: readonly CodexFleetRow[];
  readonly ranking: CodexPlanRanking;
  readonly selection: CodexSelection;
  readonly weeklySpread: CodexSpread;
  /** What to do when nothing can take the work, or null when something can. */
  readonly insteadDo: string | null;
  /** What only the owner can do — a login, an unused reset, two homes on one account (`./fleetCap.ts`). */
  readonly advisories: readonly string[];
}

/**
 * One window's percentage for a row, or null — the REPORT's view, which is deliberately more generous than
 * the ranker's.
 *
 * The ranker refuses a reading it cannot order on; this prints whatever the log actually said, so a reader
 * can see the number the ranker declined to believe rather than being shown a blank where an odd value is.
 * The one number it will not print is a window whose reset is at or before `readAtIso`: that window has
 * reopened, so its old percentage is no reading of the account now (a Codex review) — the same test
 * `./rank.ts`'s `windowPercent` applies before ranking.
 *
 * @param gauge the destination's reading, or null
 * @param label which window — by label, never by slot
 * @param readAtIso the snapshot's one instant, which a window's reset is judged against
 * @returns the percentage the log carried, or null when that window is absent or has reset since
 */
function reportedPercent({
  gauge,
  label,
  readAtIso,
}: {
  gauge: CodexGauge | null;
  label: CodexWindowLabel;
  readAtIso: string;
}): number | null {
  if (gauge === null) {
    return null;
  }
  const window = codexWindowByLabel({ gauge, label });
  if (window === undefined) {
    return null;
  }
  const resetMs = window.resetAtIso === undefined ? undefined : parseIsoMs({ tsIso: window.resetAtIso });
  const readMs = parseIsoMs({ tsIso: readAtIso });
  if (resetMs !== undefined && readMs !== undefined && resetMs <= readMs) {
    return null;
  }
  return window.usedPercent;
}

/**
 * A value absent from a source as an explicit `null`, so the JSON document carries the KEY either way.
 *
 * An `if` that RETURNS rather than `??`: `JSON.stringify` drops an `undefined` value entirely, and a reader
 * cannot tell a dropped key from a field that was never asked for — which is the whole reason this report
 * spells its absences. `.claude/rules/typescript-patterns.md` § No silent fallback is why it is not an
 * operator, and `cli/commands/codex/quotaRun.ts` carries the same helper for the same reason.
 *
 * @param value the value a source supplied, or undefined when it supplied none
 * @returns the value, or an explicit null
 */
function orNull<T>({ value }: { value: T | undefined }): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/** How old a reading is at the instant the fleet was read, in seconds, or null when that cannot be derived. */
function ageSeconds({ gauge, readAtIso }: { gauge: CodexGauge | null; readAtIso: string }): number | null {
  if (gauge === null) {
    return null;
  }
  const observedMs = parseIsoMs({ tsIso: gauge.observedAtIso });
  const readMs = parseIsoMs({ tsIso: readAtIso });
  if (observedMs === undefined || readMs === undefined) {
    return null;
  }
  return Math.round((readMs - observedMs) / MS_PER_SECOND);
}

/**
 * How a row fared in the ranking, as a phrase and a reason a reader can act on.
 *
 * @param observation the destination's evidence
 * @param ranking what the ranker concluded
 * @returns the disposition and the reason behind it
 */
function dispositionOf({ observation, ranking }: { observation: CodexPlanObservation; ranking: CodexPlanRanking }): {
  disposition: string;
  dispositionReason: string;
} {
  const excluded = ranking.excluded.find((entry) => entry.destination.alias === observation.destination.alias);
  if (excluded !== undefined) {
    return { disposition: `excluded (${excluded.kind})`, dispositionReason: excluded.reason };
  }
  const position = ranking.ranked.findIndex((entry) => entry.alias === observation.destination.alias);
  const deferred = ranking.deferredUnmeasured.includes(observation.destination.alias);
  if (deferred) {
    return {
      disposition: `ranked #${String(position + 1)}`,
      dispositionReason:
        "no usable weekly observation; no standing refusal found; deferred behind measured destinations",
    };
  }
  return {
    disposition: `ranked #${String(position + 1)}`,
    dispositionReason: "eligible, ordered by how far its week sits behind its level line",
  };
}

/**
 * One destination's row in the report.
 *
 * @param observation the destination's evidence
 * @param ranking what the ranker concluded
 * @param readAtIso the instant the whole fleet was read
 * @returns the row
 */
function rowFor({
  observation,
  ranking,
  readAtIso,
}: {
  observation: CodexPlanObservation;
  ranking: CodexPlanRanking;
  readAtIso: string;
}): CodexFleetRow {
  const { destination, live, plan, quota, scan } = observation;
  const gauge = orNull({ value: observation.gauge });
  const { disposition, dispositionReason } = dispositionOf({ observation, ranking });
  // § A monthly allowance is NOT MEASURED: no percentage of a window stands for it.
  const measured = plan.allowance.kind === "weekly-window";
  return {
    alias: destination.alias,
    allowance: plan.allowance.kind,
    codexHome: destination.codexHome,
    disposition,
    dispositionReason,
    emailCached: unsetFieldAsNull({ record: plan, key: "email" }),
    filesRead: scan.filesRead,
    filesSkipped: scan.filesSkipped,
    fiveHourUsedPercent: measured ? reportedPercent({ gauge, label: "five-hour", readAtIso }) : null,
    gauge,
    gaugeSource: observation.gaugeSource,
    liveEmail: live.kind === "signed-in" ? orNull({ value: live.email }) : null,
    liveState: live.kind,
    liveUnreadableReason: live.kind === "unreadable" ? live.reason : null,
    observationAgeSeconds: ageSeconds({ gauge, readAtIso }),
    pausedReason: orNull({ value: plan.paused?.reason }),
    pausedSinceIso: orNull({ value: plan.paused?.sinceIso }),
    refusalReason: quota.refuse ? quota.reason : null,
    refusing: quota.refuse,
    resetCreditsAvailable: live.kind === "signed-in" ? live.resetCreditsAvailable : null,
    usageLimitPercent: plan.usageLimitPercent,
    weeklyUsedPercent: measured ? reportedPercent({ gauge, label: "weekly", readAtIso }) : null,
    ...(observation.scanSkippedReason === undefined ? {} : { scanSkippedReason: observation.scanSkippedReason }),
  };
}

/**
 * The gap in percentage points between the fullest and emptiest usable reading of one window.
 *
 * Reported as a SPREAD rather than a verdict: no threshold here calls a fleet balanced, because the number
 * that would justify one has never been measured, and two percentages of two different allowances are not
 * comparable capacities in the first place.
 *
 * @param label which window
 * @param rows the report's rows
 * @returns the spread, or a stated reason there is nothing to compare
 */
function spreadOver({ label, rows }: { label: CodexWindowLabel; rows: readonly CodexFleetRow[] }): CodexSpread {
  const key = label === "weekly" ? "weeklyUsedPercent" : "fiveHourUsedPercent";
  const samples = rows.map((row) => row[key]).filter((percent): percent is number => percent !== null);
  if (samples.length < 2) {
    return {
      kind: "not-applicable",
      reason: `${String(samples.length)} of ${String(rows.length)} destination(s) carried a usable ${label} reading, so there is nothing to compare`,
    };
  }
  return {
    kind: "spread",
    ofDestinations: rows.length,
    points: Math.max(...samples) - Math.min(...samples),
    samples: samples.length,
  };
}

/**
 * What to do when the fleet can take no work, or null when it can.
 *
 * It recommends and never routes: nothing here probes Claude's own budget, and saying so is the point —
 * AGENTS.md rule 9's fallback is a visible Claude session taking the pass, which is a decision a reader
 * makes rather than one this module takes behind them.
 *
 * @param destinations how many Codex rows the register carries
 * @param selection what the ranking selected
 * @returns the recommendation, or null
 */
function insteadFor({ destinations, selection }: { destinations: number; selection: CodexSelection }): string | null {
  if (selection.kind === "selected") {
    return null;
  }
  if (destinations === 0) {
    return "no Codex destination is registered: `slopweaver plans add --provider codex` names one, and the sign-in is your own terminal";
  }
  return (
    "no Codex destination can take a pass: have a VISIBLE Claude session take it instead (AGENTS.md rule 9). " +
    "Nothing here has checked Claude's own budget."
  );
}

/**
 * Assess the whole Codex fleet from one snapshot.
 *
 * @param requestedModel the model a pass would request — the repository's pin, never the machine's default
 * @param snapshot one read of the register and every destination's evidence
 * @returns the derived report, every field present
 */
export function assessCodexFleet({
  requestedModel,
  snapshot,
}: {
  requestedModel: string;
  snapshot: CodexFleetSnapshot;
}): CodexFleetAssessment {
  const ranking = rankCodexPlans({
    nowIso: snapshot.readAtIso,
    observations: snapshot.observations,
    thresholds: snapshot.thresholds,
  });
  const rows = snapshot.observations.map((observation) =>
    rowFor({ observation, ranking, readAtIso: snapshot.readAtIso }),
  );
  const chosen = ranking.ranked[0];
  const selection: CodexSelection =
    chosen === undefined
      ? { kind: "none", reason: `nothing eligible: ${ranking.basis}` }
      : { destination: chosen, kind: "selected" };
  return {
    advisories: codexFleetAdvisories({ observations: snapshot.observations }),
    destinations: rows.length,
    fiveHourMeasured: rows.filter((row) => row.fiveHourUsedPercent !== null).length,
    insteadDo: insteadFor({ destinations: rows.length, selection }),
    ranking,
    readAtIso: snapshot.readAtIso,
    refusing: rows.filter((row) => row.refusing).length,
    registerDiagnostics: snapshot.register.diagnostics,
    requestedModel,
    rows,
    selection,
    unpaused: rows.filter((row) => row.pausedReason === null).length,
    weeklyMeasured: rows.filter((row) => row.weeklyUsedPercent !== null).length,
    weeklySpread: spreadOver({ label: "weekly", rows }),
  };
}
