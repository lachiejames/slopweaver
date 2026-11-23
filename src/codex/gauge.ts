/**
 * Codex's own budget, read off the same `rate_limits` object `./quotaLog.ts` reads for exhaustion — but
 * kept as a full reading rather than collapsed to "exhausted or not".
 *
 * ## Why this is not a probe, and cannot be
 *
 * The Claude gauge (`src/claude/gaugeProbe.ts`) spends one output token whenever it wants a number, because
 * the budget rides on the headers of any ordinary response. Codex has no equivalent: `codex doctor --json`
 * reports auth/config/network health and no usage, and no top-level subcommand exposes one. A `rate_limits`
 * object is written only when a turn actually runs, so a Codex reading is **event-driven and irregular** —
 * there is no way to ask for a fresh one without spending a real pass. Every consequence below follows from
 * that one difference, and none of them is a limitation of this module:
 *
 *  - a reading always carries the instant it was OBSERVED, and a caller that cares must judge staleness;
 *  - there is no "take a sample now" verb, so the drawdown series is whatever the log happens to hold;
 *  - an absent reading is genuinely "nobody has run a Codex turn recently", never "the account is fine".
 *
 * ## Two scales, kept in the provider's own units
 *
 * `used_percent` is a PERCENTAGE (`18.0` is 18%), where Claude's `utilization` is a FRACTION (`0.34` is
 * 34%). Both are carried here exactly as their provider writes them, and {@link CodexWindowReading} says so
 * on the field. Normalising one to the other would put a silent factor of 100 between a value and the log
 * line it came from — the Claude header records that exact mistake being made twice while this family of
 * parsers was reverse-engineered.
 *
 * ## Which window is which is NOT fixed
 *
 * MEASURED across 80,935 `token_count` events: `primary.window_minutes` is 10,080 on 77,563 of
 * them and 300 on 3,270, and on every one of those 3,270 the 10,080-minute window is in `secondary`. So
 * "primary" names a slot, not a window, and a caller asking for the weekly budget asks
 * {@link codexWindowByLabel} rather than reading `primary`. Reproduce:
 *
 * ```bash
 * grep -roh '"primary":{"used_percent":[0-9.]*,"window_minutes":[0-9]*' \
 *   "${CODEX_HOME:-$HOME/.codex}/sessions" | sed 's/.*window_minutes"://' | sort -n | uniq -c
 * ```
 *
 * Pure. The rollout-file walk lives in `./gaugeScan.ts`.
 */
import { epochSecondsToIso } from "../lib/date.js";
import { isRecord } from "../lib/parsers.js";
import type { CodexQuotaKind } from "./quotaTypes.js";

/** Whether a slot holds a window this parser would actually produce a reading from. */
function slotIsReadable({ slot }: { slot: unknown }): boolean {
  return isRecord(slot) && typeof slot["used_percent"] === "number";
}

/**
 * Whether a `rate_limits` object carries anything a reading is made of.
 *
 * A bare `{"limit_id":"codex"}` is an object and says nothing about spend. So is `{"primary":{}}`, and that
 * second shape is a correction: this asked only whether a slot was an OBJECT, and a Codex review supplied a
 * line whose sibling held an empty `primary` while the nested position held one at 100% — the empty slot won,
 * `windowOf` then dropped it for having no percentage, and the line parsed as HEALTHY, clearing a live cap.
 * The test is therefore the same one `windowOf` applies: a numeric `used_percent`, or a reached type.
 *
 * @param rateLimits a candidate rate-limit object
 * @returns true when it carries a readable window slot or a reached type
 */
function carriesReading({ rateLimits }: { rateLimits: Record<string, unknown> }): boolean {
  return (
    slotIsReadable({ slot: rateLimits["primary"] }) ||
    slotIsReadable({ slot: rateLimits["secondary"] }) ||
    typeof rateLimits["rate_limit_reached_type"] === "string"
  );
}

/**
 * The `rate_limits` object on a `token_count` payload, wherever the writing Codex put it.
 *
 * The sibling position is preferred because it is the one every line on this machine uses; the nested
 * position is kept rather than deleted because nothing here can see which Codex version wrote a given file
 * and a reader that refuses an older layout would re-introduce the same silence in the other direction. It
 * lives HERE rather than in `./quotaLog.ts` because this module is the parser and that one is the evidence
 * policy over it: quotaLog imports this, not the reverse.
 *
 * **A sibling that carries no reading does not win, and that is a correction.** It returned the sibling
 * whenever it was an OBJECT, and a Codex review supplied a line where the sibling was `{"limit_id":"codex"}`
 * and the nested one held `primary: {used_percent: 100}`: the empty shell masked the exhausted window, the
 * line parsed as a HEALTHY observation, and a healthy observation of that scope CLEARS a standing cap. A
 * position only answers when it actually holds a reading — {@link carriesReading} — and the search falls
 * through to the other position when it does not.
 *
 * @param payload one rollout event's `payload` object
 * @returns the rate-limit object, or undefined when the payload is not a `token_count` event or carries none
 */
export function rateLimitsOf({ payload }: { payload: Record<string, unknown> }): Record<string, unknown> | undefined {
  return rateLimitsAll({ payload })[0];
}

/**
 * EVERY `rate_limits` object a `token_count` payload carries, the ones holding a reading first.
 *
 * **Both positions are returned, and that is the correction two review rounds converged on.** Picking ONE
 * was the mistake in every form it took: preferring the sibling let an empty shell mask a nested window at
 * 100%, and then preferring whichever "carried a reading" let a HEALTHY sibling at 1% mask the same nested
 * window. There is no precedence rule that is safe, because the two positions are written by different Codex
 * versions and nothing in the line says which one is authoritative. So a consumer that judges exhaustion
 * reads all of them and takes the worst — `./quotaLog.ts`'s `parseRolloutObservation` does — and a line can
 * never read healthy while any position it carries says otherwise.
 *
 * {@link rateLimitsOf} keeps returning the single best one, for the display path where a gauge shows one
 * reading and the worst-case merge would be misleading rather than safe.
 *
 * @param payload one rollout event's `payload` object
 * @returns each present rate-limit object, those carrying a reading first; empty for a non-`token_count`
 *   event or one carrying none
 */
function rateLimitsAll({ payload }: { payload: Record<string, unknown> }): readonly Record<string, unknown>[] {
  if (payload["type"] !== "token_count") {
    return [];
  }
  const info = payload["info"];
  const present = [
    isRecord(payload["rate_limits"]) ? payload["rate_limits"] : undefined,
    isRecord(info) && isRecord(info["rate_limits"]) ? info["rate_limits"] : undefined,
  ].filter((candidate): candidate is Record<string, unknown> => candidate !== undefined);
  // Ordered rather than filtered: an object carrying no reading still holds real credits and plan fields, so
  // it stays available to a consumer that wants them — it simply never comes first.
  return [
    ...present.filter((candidate) => carriesReading({ rateLimits: candidate })),
    ...present.filter((candidate) => !carriesReading({ rateLimits: candidate })),
  ];
}

/** The five-hour window's width in minutes, as Codex writes it. */
const CODEX_FIVE_HOUR_WINDOW_MINUTES = 300;

/** The weekly window's width in minutes, as Codex writes it. */
const CODEX_WEEKLY_WINDOW_MINUTES = 10_080;

/**
 * Which named window a reading describes, decided by its own width rather than by which slot held it.
 *
 * `other` is a real answer, not a failure: a width this module has never seen is a window Codex has started
 * reporting, and calling it weekly because it happened to arrive in `primary` is exactly the substitution
 * this module's header exists to refuse.
 */
export type CodexWindowLabel = "five-hour" | "weekly" | "other";

/** One rate-limit window, exactly as Codex reported it. */
export interface CodexWindowReading {
  /** Which slot carried it — `primary` or `secondary`. Kept so a reading can be traced back to its line. */
  readonly slot: "primary" | "secondary";
  readonly label: CodexWindowLabel;
  /**
   * The window's width in minutes, or undefined when the event reported a percentage and no width.
   *
   * Optional, and that is a correction with a real cost behind it. A window missing `window_minutes` used to
   * be DROPPED, so a reading of `used_percent: 100` with no width parsed as a gauge carrying no exhausted
   * window at all — which reads as HEALTHY, and a healthy reading CLEARS a standing cap in its own scope. A
   * Codex review supplied that exact sequence: a live 300-minute cap lifted, two minutes after it was
   * recorded, by a reading that itself said 100%. The width is what a refusal is NAMED after; the percentage
   * is what makes it a refusal, so only the percentage may be required.
   */
  readonly windowMinutes: number | undefined;
  /** 0..100 on the provider's own scale, NOT a 0..1 fraction. See this module's header. */
  readonly usedPercent: number;
  /** When the window resets, ISO-8601 — or undefined when the event carried no `resets_at`. */
  readonly resetAtIso: string | undefined;
}

/**
 * Codex's credit state, when the event carried one. `credits: null` is a legitimate older shape.
 *
 * @internal — the type of {@link CodexGauge.credits}; callers read that field rather than naming this.
 */
export interface CodexCreditsReading {
  readonly hasCredits: boolean;
  readonly unlimited: boolean;
  /** The provider's own `balance`, which has been `null` on every event this machine has written. */
  readonly balance: number | null;
}

/** One complete reading of Codex's account budget, from one `token_count` event. */
export interface CodexGauge {
  /** The rollout event's own timestamp — when this was OBSERVED, never when it was read. */
  readonly observedAtIso: string;
  /** `codex` on ordinary readings, `premium` on every exhaustion event this machine has recorded. */
  readonly limitId: string | undefined;
  /** `team`, `self_serve_business_prolite` and `unknown` have all been seen here. */
  readonly planType: string | undefined;
  /** Every window the event reported, in slot order. Empty on an exhaustion event, which nulls both. */
  readonly windows: readonly CodexWindowReading[];
  readonly credits: CodexCreditsReading | undefined;
  /**
   * `rate_limit_reached_type` VERBATIM, or undefined when it was null.
   *
   * Carried alongside {@link reached} rather than replaced by it, so a wording this machine has never seen
   * is visible as itself instead of vanishing into an unclassified `undefined`.
   */
  readonly reachedType: string | undefined;
  /** What {@link reachedType} classifies to, or undefined when it named nothing this module recognises. */
  readonly reached: CodexQuotaKind | undefined;
}

/**
 * Which label a window width carries. Pure, and total — an unknown or absent width is `other`, never a guess.
 *
 * @param windowMinutes the reported width, or undefined when the event carried none
 * @returns the label
 */
function labelOf({ windowMinutes }: { windowMinutes: number | undefined }): CodexWindowLabel {
  if (windowMinutes === CODEX_FIVE_HOUR_WINDOW_MINUTES) {
    return "five-hour";
  }
  if (windowMinutes === CODEX_WEEKLY_WINDOW_MINUTES) {
    return "weekly";
  }
  return "other";
}

/** One slot of a `rate_limits` object as a window reading, or undefined when that slot is null or malformed. */
function windowOf({
  rateLimits,
  slot,
}: {
  rateLimits: Record<string, unknown>;
  slot: "primary" | "secondary";
}): CodexWindowReading | undefined {
  const raw = rateLimits[slot];
  if (!isRecord(raw)) {
    return undefined;
  }
  const usedPercent = raw["used_percent"];
  if (typeof usedPercent !== "number") {
    return undefined;
  }
  // The PERCENTAGE alone makes a window a reading; the width only names it. Requiring both dropped an
  // exhausted window whose width Codex omitted, and a dropped exhausted window reads as healthy — see
  // {@link CodexWindowReading.windowMinutes} for the cap that lifted because of it.
  const rawMinutes = raw["window_minutes"];
  const windowMinutes = typeof rawMinutes === "number" ? rawMinutes : undefined;
  const resetsAt = raw["resets_at"];
  return {
    label: labelOf({ windowMinutes }),
    resetAtIso: typeof resetsAt === "number" ? epochSecondsToIso({ seconds: resetsAt }) : undefined,
    slot,
    usedPercent,
    windowMinutes,
  };
}

/** A `rate_limits.credits` object as a reading, or undefined when it is null or malformed. */
function creditsOf({ rateLimits }: { rateLimits: Record<string, unknown> }): CodexCreditsReading | undefined {
  const raw = rateLimits["credits"];
  if (!isRecord(raw) || typeof raw["has_credits"] !== "boolean") {
    return undefined;
  }
  const balance = raw["balance"];
  return {
    balance: typeof balance === "number" ? balance : null,
    hasCredits: raw["has_credits"],
    unlimited: raw["unlimited"] === true,
  };
}

/** A string field of `rate_limits`, or undefined when it is absent, null or not a string. */
function stringField({ name, rateLimits }: { name: string; rateLimits: Record<string, unknown> }): string | undefined {
  const value = rateLimits[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Which exhaustion a `rate_limit_reached_type` names.
 *
 * Duplicates nothing: `./quotaLog.ts`'s own map is keyed to producing EVIDENCE, and this one answers what a
 * gauge should display. They agree today and are allowed to diverge — a new reached type could be worth
 * showing on a gauge before anyone decides whether it should refuse a spawn.
 */
const REACHED_TYPE_KINDS: ReadonlyMap<string, CodexQuotaKind> = new Map<string, CodexQuotaKind>([
  ["workspace_member_credits_depleted", "credits-out"],
  ["workspace_member_usage_limit_reached", "usage-limit"],
]);

/**
 * Read one `rate_limits` object into a gauge.
 *
 * @param observedAtIso the rollout event's own timestamp
 * @param rateLimits the object {@link ../codex/quotaLog.rateLimitsOf} found, in either layout
 * @returns the gauge — never undefined, because an object with every field null is still a real reading
 */
export function gaugeFromRateLimits({
  observedAtIso,
  rateLimits,
}: {
  observedAtIso: string;
  rateLimits: Record<string, unknown>;
}): CodexGauge {
  const reachedType = stringField({ name: "rate_limit_reached_type", rateLimits });
  const classified = reachedType === undefined ? undefined : REACHED_TYPE_KINDS.get(reachedType);
  return {
    credits: creditsOf({ rateLimits }),
    limitId: stringField({ name: "limit_id", rateLimits }),
    observedAtIso,
    planType: stringField({ name: "plan_type", rateLimits }),
    reached: classified,
    reachedType,
    windows: [windowOf({ rateLimits, slot: "primary" }), windowOf({ rateLimits, slot: "secondary" })].filter(
      (window): window is CodexWindowReading => window !== undefined,
    ),
  };
}

/**
 * Read one rollout JSONL line into a gauge. Pure — a line fixture is a complete test.
 *
 * @param line one raw line from a rollout file
 * @returns the gauge the line carries, or undefined when it is not a `token_count` event with `rate_limits`
 */
export function parseGaugeLine({ line }: { line: string }): CodexGauge | undefined {
  // See {@link parseGaugeLineAll} for why a line is marker-tested before it is parsed.
  if (!line.includes('"token_count"')) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value["timestamp"] !== "string" || !isRecord(value["payload"])) {
    return undefined;
  }
  const rateLimits = rateLimitsOf({ payload: value["payload"] });
  if (rateLimits === undefined) {
    return undefined;
  }
  return gaugeFromRateLimits({ observedAtIso: value["timestamp"], rateLimits });
}

/**
 * EVERY reading a rollout line carries, one per `rate_limits` position it holds.
 *
 * The exhaustion path's entry point, as {@link parseGaugeLine} is the display path's: a consumer deciding
 * whether an account is capped has to see both positions, because neither one is authoritative (see
 * {@link rateLimitsAll}).
 *
 * @param line one raw line from a rollout file
 * @returns each reading the line carries, readings-bearing positions first; empty when it carries none
 */
export function parseGaugeLineAll({ line }: { line: string }): readonly CodexGauge[] {
  // A cheap PREFILTER before any parse. `JSON.parse` on an arbitrary line assembles every value in it, and a
  // Codex review reached a credential that way through a file placed inside the sessions tree. Requiring the
  // event marker first means a document that is not a rollout event is never parsed at all. It is a
  // narrowing, not a boundary — the real boundary is `rolloutFilesIn`'s own checks — and it costs one
  // substring test per line.
  if (!line.includes('"token_count"')) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(value) || typeof value["timestamp"] !== "string" || !isRecord(value["payload"])) {
    return [];
  }
  const observedAtIso = value["timestamp"];
  return rateLimitsAll({ payload: value["payload"] }).map((rateLimits) =>
    gaugeFromRateLimits({ observedAtIso, rateLimits }),
  );
}

/**
 * A reading with only the windows `keep` accepts — and, when it drops ANY window, without its reached type.
 *
 * A reached type rides the same reading as the windows it was reported beside, so once one of those windows is
 * known to have reset, that refusal is the same stale report. Kept, it would turn a filtered reading into what
 * looks like Codex's own windowless exhaustion event, a current refusal invented from an expired one (a Codex
 * review). A reading that loses no window keeps its reached type untouched.
 *
 * @param gauge the reading to filter
 * @param keep whether one window still describes the budget
 * @returns the filtered reading
 */
export function gaugeKeepingWindows({
  gauge,
  keep,
}: {
  gauge: CodexGauge;
  keep: (window: CodexWindowReading) => boolean;
}): CodexGauge {
  const windows = gauge.windows.filter((window) => keep(window));
  if (windows.length === gauge.windows.length) {
    return gauge;
  }
  return { ...gauge, reached: undefined, reachedType: undefined, windows };
}

/**
 * The window carrying a given label, whichever slot it arrived in.
 *
 * This is the accessor a caller wanting "the weekly budget" uses — never `windows[0]`. See this module's
 * header for the measurement that makes slot position unreliable.
 *
 * @param gauge the reading to search
 * @param label which named window is wanted
 * @returns that window, or undefined when this reading carried none
 */
export function codexWindowByLabel({
  gauge,
  label,
}: {
  gauge: CodexGauge;
  label: CodexWindowLabel;
}): CodexWindowReading | undefined {
  return gauge.windows.find((window) => window.label === label);
}
