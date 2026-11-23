/**
 * The closed shapes every other `src/claude/*` module reads and writes — split out so none of them needs to
 * import another purely to reach a type, the same arrangement `src/codex/quotaTypes.ts` uses for the Codex
 * side of the same problem.
 *
 * Two properties of this file are load-bearing rather than incidental:
 *
 * - **No renderable type carries a credential value.** An alias, a store directory and a window's
 *   utilization are all safe to print into an event, a log line or a transcript; an access token is not, and
 *   there is deliberately no field here that could hold one. That is what keeps "a secret never enters a
 *   transcript" a property of the types rather than a rule reviewers have to remember.
 * - **The account list is N-long, never three.** Adding another
 *   plan must be trivial, so nothing here — and nothing in `select.ts` — may assume a count.
 */
import {
  decodePlanAllowance,
  decodeUsageLimitPercent,
  type PlanAllowance,
  type UsageLimitPercent,
} from "../plans/usageLimit.js";
import type { ClaudeSpendVerdict } from "./spendPolicy.js";

/**
 * A plan's neutral local label, chosen by the owner when they configure a store. Never an email address, an
 * organisation name or a UUID: those are private identifiers this repository may not carry, and an alias is
 * what appears in every event, gauge row and error message instead.
 */
export type ClaudeAccountAlias = string;

/**
 * The four rate-limit claims the Claude Code CLI's own HTTP responses name. `five_hour` and `seven_day` are PLAN-WIDE —
 * they are the only two that may move the fleet to another plan. The two model-scoped claims exhaust one
 * model on a plan that is otherwise healthy, so the correct response to them is a model downgrade
 * (doctrine rule 5's tiering), never a rotation.
 */
export type ClaudeRateClaim = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet";

/**
 * Every label the `-representative-claim` header may carry: the refusal claims, plus a label that names no
 * refusal and no window of its own.
 *
 * Split from {@link ClaudeRateClaim} on purpose. `seven_day_overage_included` was MEASURED on a
 * plan whose Fable week read `allowed_warning` at 85% (`slopweaver claude gauge --json`); what it means beyond
 * that is not established, so it is recognised as a representative label and nothing more. Putting it in the
 * refusal vocabulary would make `claimResponse.ts` treat it as an actionable wall.
 */
export type ClaudeRepresentativeClaim = ClaudeRateClaim | "seven_day_overage_included";

/**
 * The subset of {@link ClaudeRateClaim} that is plan-wide, and therefore visible in advance.
 *
 * @internal — the element type of {@link CLAUDE_PLAN_CLAIMS}, which is what callers iterate. Note this is
 *   NOT "the claims that may rotate": a model-scoped claim rotates too when the supervisor chair hits it.
 */
export type ClaudePlanClaim = Extract<ClaudeRateClaim, "five_hour" | "seven_day">;

/** Every plan-wide claim, in the order a gauge reports them. Iterate this rather than restating the pair. */
export const CLAUDE_PLAN_CLAIMS: readonly ClaudePlanClaim[] = ["five_hour", "seven_day"] as const;

/**
 * A window's health as the `anthropic-ratelimit-unified-*-status` header reports it. `allowed_warning` is
 * the approaching-limit signal — the one value that lets rotation be proactive rather than reactive.
 */
export type ClaudeWindowStatus = "allowed" | "allowed_warning" | "rejected";

/** One rate-limit window's reading: how much of it is spent, when it resets, and how the provider grades it. */
export interface ClaudeWindowReading {
  /**
   * Fraction spent as the header carries it — NOT a percentage. `0.34` means 34% used. Finite and never
   * negative; NOT capped at 1, because `usage.ts` refuses only what fails unsafe, and a reading past 1 is
   * already excluded by every spend cap.
   */
  readonly utilization: number;
  /** When this window resets, ISO-8601, converted from the header's absolute epoch-second value. */
  readonly resetAtIso: string;
  readonly status: ClaudeWindowStatus;
}

/**
 * One account's plan-wide gauge at one instant. The seven-day window is REQUIRED: a reading missing it is a
 * shape change rather than a partial reading, and `usage.ts` refuses it.
 */
export interface ClaudeAccountGauge {
  readonly alias: ClaudeAccountAlias;
  /** When this reading was taken, ISO-8601 — a gauge is only ever as good as its own timestamp. */
  readonly observedAtIso: string;
  /**
   * The five-hour window, when the plan still has one.
   *
   * Optional by measurement: Anthropic removed the five-hour limit from the Ultra plan (the plan formerly
   * called Max 20x) in stages, and once removed every plan the owner holds answered with
   * NO `anthropic-ratelimit-unified-5h-*` trio at all while the `7d` trio stayed. Absent means the plan has no
   * five-hour limit — nothing to gate on — never that the window went unread. {@link fiveHourRankKey} is
   * the one reading of that absence a ranking may use.
   */
  readonly fiveHour?: ClaudeWindowReading;
  /** The plan-wide seven-day window — the primary reading on every plan since the five-hour limit went. */
  readonly sevenDay: ClaudeWindowReading;
  /**
   * The FABLE-only seven-day window, when the probe that produced this reading asked for it.
   *
   * Optional by measurement rather than by caution: the `anthropic-ratelimit-unified-7d_oi-*` trio appears
   * only on a response to a request that NAMED a Fable model, so a gauge taken with any other model
   * legitimately carries none. {@link ClaudeModelClass} is what a caller uses to decide whether the absence
   * matters.
   */
  readonly sevenDayFable?: ClaudeWindowReading;
  /** Which claim the provider considers representative right now, when it named one. */
  readonly representativeClaim?: ClaudeRepresentativeClaim;
}

/**
 * A plan's five-hour window as a ranking key: presence first, then how much of it is spent.
 *
 * A plan with no five-hour window has no five-hour limit to approach (see {@link ClaudeAccountGauge.fiveHour}),
 * so it sorts AHEAD of every plan that still has one — `[0, 0]` — and plans that do have one sort among
 * themselves on utilization — `[1, utilization]`. The leading element is the discriminator, so absence is
 * never spelled as a utilization of zero: a present window at 0% and no window at all are different facts,
 * and both ranking modules ask this one function rather than restating the choice.
 *
 * @param gauge the plan's reading
 * @returns the two-element key, absent-first
 */
export function fiveHourRankKey({ gauge }: { gauge: ClaudeAccountGauge }): readonly [number, number] {
  if (gauge.fiveHour === undefined) {
    return [0, 0];
  }
  return [1, gauge.fiveHour.utilization];
}

/**
 * Which budget a spawn will actually draw down, which is the only thing routing needs to know about a model.
 *
 * `all-models` is every non-Fable model — Opus, Sonnet and Haiku alike all spend the plan-wide seven-day
 * window and nothing else. `fable` spends that window AND the Fable-only one, which is why a Fable spawn has
 * two windows to satisfy and every other spawn has one.
 */
export type ClaudeModelClass = "fable" | "all-models";

/**
 * Why a plan is deliberately out of the fleet, and since when.
 *
 * A BARE BOOLEAN was rejected: a plan paused six weeks ago is indistinguishable from a typo or an abandoned
 * experiment unless the row says what it is waiting on. The case this shape exists for — `plan-one`'s
 * claude.ai subscription paused on a bounced Airwallex charge — is waiting on another person's
 * approval with no known return date, so there is no `eligibleAtIso` to carry and inventing one would be a
 * countdown on somebody else's decision.
 */
export interface ClaudePausedPlan {
  /** What the plan is out for, printed by every surface that would otherwise print a provider refusal. */
  readonly reason: string;
  /** When the pause was recorded, ISO-8601 — what makes a forgotten pause visible rather than permanent. */
  readonly sinceIso: string;
}

/**
 * One configured plan: its alias, and the credential store directory that selects it.
 *
 * The directory becomes `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which makes Claude Code derive its own keychain
 * service name from that path — measured against v2.1.259, the service is
 * `Claude Code-credentials-<first 8 hex of sha256 of the NFC-normalised path>`. So a store is selected by
 * naming a directory and nothing else; no token is ever read, copied or held by this repository.
 */
export interface ClaudeAccount {
  readonly alias: ClaudeAccountAlias;
  readonly storeDir: string;
  /**
   * Present when this plan is deliberately out of the fleet: not probed, not routed, not counted in the
   * acceptance denominator — but still listed, marked paused, wherever the fleet's plans are counted
   * (`../capacity/ceilings.ts`). ABSENT is the normal case.
   *
   * It is a DECLARED state, and that is what separates it from an unreadable plan. A plan the provider
   * refuses is a refusal the gate must fail closed on; a paused plan is a fact the operator wrote down, so
   * every surface reports it once as a fact rather than as an error on every spawn.
   */
  readonly paused?: ClaudePausedPlan;
  /**
   * Whether pinned seats boot against THIS account. Exactly one configured account may carry it.
   *
   * It is configuration rather than a heuristic because the right answer is a fact about the owner's
   * machine that this code cannot observe: which account the owner's browser is signed into, and therefore which
   * gallery the owner's react-now surface lives in.
   */
  readonly pinned?: boolean;
  /**
   * A DISPLAY CACHE of the address the owner calls this plan's account — never its identity.
   *
   * Per-install state from `accounts.json`, shown beside the alias wherever a plan is named (`plan-two`
   * alone leaves the owner guessing which account a sign-in means). Absent until
   * someone maps it.
   *
   * It is hand-typed and a `/login` does not touch it, so it drifts from the token in the store
   * independently and silently — which is what holds a launch on a drifted address. The address a surface may call
   * the account is `ClaudeIdentityAssertion.email`, bound to a live token by an enrollment; this one is
   * rendered only through a decided `ClaudeAccountCell` that says it is a cache, and
   * `claude-email-not-identity` in `yarn lint` refuses any verb that reasons about WHICH ACCOUNT from it.
   */
  readonly email?: string;
  /**
   * What this plan's allowance is measured in, off its register row (`../plans/usageLimit.ts`). Always present
   * on an account `parseClaudeAccounts` produced; a hand-built account without it is read by
   * {@link claudePlanGauge} through the register's own decoder, so absence means a weekly-window subscription.
   */
  readonly allowance?: PlanAllowance;
  /**
   * The share of {@link allowance} the owner lets Slopweaver take, off its register row — a CEILING every gate
   * stops at. Present on every parsed account; absence on a hand-built one decodes to 100, the same way.
   */
  readonly usageLimitPercent?: UsageLimitPercent;
  /**
   * When this plan's paid subscription ends, ISO-8601 — the register's `lapsesAtIso`, carried through the
   * projection. Informational: it never pauses, probes or routes a plan, and ABSENT prints `lapse UNRECORDED`
   * rather than nothing, because an unknown end date is what the owner wants to see.
   */
  readonly lapsesAtIso?: string;
}

/**
 * A plan's reading paired with its usage policy — what every gate that decides whether NEW work may land on a
 * plan reads. It is produced only where a configured account meets its own probe ({@link claudePlanGauge}), so
 * the provider's response parser stays a parser of the provider's response.
 */
export interface ClaudePlanGauge extends ClaudeAccountGauge {
  readonly allowance: PlanAllowance;
  readonly usageLimitPercent: UsageLimitPercent;
}

/**
 * A `monthly-spend` plan as routing reads it: its alias and what its newest recorded spend reading says under the
 * owner's usage limit (`./spendPolicy.ts` `claudeSpendVerdict`), judged at the instant the routing pass is for.
 *
 * A monthly plan is never probed — its allowance is dollars, which no rate-limit header reports — so this is the
 * monthly half of a routing input, beside the weekly plans' {@link ClaudePlanGauge}s. The verdict is computed by
 * the one effectful reader (`./spendBudgets.ts`) so every pure gate downstream judges the same evidence, and an
 * unreadable ledger arrives here as a `not-measured` verdict rather than as a missing plan.
 */
export interface ClaudePlanSpend {
  readonly alias: ClaudeAccountAlias;
  readonly verdict: ClaudeSpendVerdict;
}

/**
 * Pair one plan's reading with its account's usage policy.
 *
 * @param account the configured plan the reading was taken against
 * @param gauge the reading itself
 * @returns the reading, carrying the plan's allowance and usage limit
 */
export function claudePlanGauge({
  account,
  gauge,
}: {
  account: Pick<ClaudeAccount, "allowance" | "usageLimitPercent">;
  gauge: ClaudeAccountGauge;
}): ClaudePlanGauge {
  return {
    ...gauge,
    allowance: decodePlanAllowance({ allowance: account.allowance }),
    usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: account.usageLimitPercent }),
  };
}

/**
 * Pair every reading with the configured plan it was taken against, by alias.
 *
 * A reading no configured plan carries is DROPPED, never paired with a default: its usage limit is unknown, and a
 * reading with an unknown limit read as the whole plan is exactly the limit-erasing direction this pairing exists
 * to close.
 *
 * @param accounts the configured plans the readings were taken against
 * @param gauges the readings, in the order a caller ranks them
 * @returns each reading carrying its plan's allowance and usage limit, in the readings' own order
 */
export function pairClaudePlanGauges({
  accounts,
  gauges,
}: {
  accounts: readonly Pick<ClaudeAccount, "alias" | "allowance" | "usageLimitPercent">[];
  gauges: readonly ClaudeAccountGauge[];
}): readonly ClaudePlanGauge[] {
  return gauges.flatMap((gauge) => {
    const account = accounts.find((candidate) => candidate.alias === gauge.alias);
    return account === undefined ? [] : [claudePlanGauge({ account, gauge })];
  });
}

/**
 * Whether a configured plan is one the one-token rate-limit probe reads — a weekly-window subscription. A
 * monthly-spend plan's allowance is dollars, which no rate-limit header reports, so it is never probed: it is read
 * from its recorded spend instead ({@link ClaudePlanSpend}), and a billed probe of it would measure nothing.
 *
 * @param account the configured plan
 * @returns true when the plan's allowance is a weekly window
 */
export function probedClaudeAccount({ account }: { account: Pick<ClaudeAccount, "allowance"> }): boolean {
  return decodePlanAllowance({ allowance: account.allowance }).kind === "weekly-window";
}

/** What a limit observation found in one transcript line. */
type ClaudeSignalKind =
  /** A plan-wide claim was refused — the only kind that may rotate. */
  | "plan-limit"
  /** A refusal that is NOT a plan limit: a 529, a spend cap, or a model-scoped claim. Recorded, never acted on. */
  | "ignored"
  /** The line carries no limit information at all. */
  | "none";

/** One classified transcript line. `claim` and `resetAtIso` are present only for a `plan-limit`. */
export interface ClaudeLimitSignal {
  readonly kind: ClaudeSignalKind;
  /** Why the line was classified this way — printed into the event, so it must never quote a credential. */
  readonly reason: string;
  /**
   * Which claim refused, when the line named one. Deliberately the FULL {@link ClaudeRateClaim} union and
   * not just the plan-wide pair: a model-scoped claim has to survive as far as the trigger, because the
   * supervisor chair answers one by rotating the plan while a worker answers it by changing model. Narrowing
   * this to plan claims made that rule unreachable — the classifier dropped the claim and the trigger saw
   * only "ignored", so the chair would have sat on a spent Fable budget.
   */
  readonly claim?: ClaudeRateClaim;
  readonly resetAtIso?: string;
}

/**
 * WHY a plan was excluded, named rather than read back out of `reason`'s wording.
 *
 * - `provider-refused` — the provider's own header reads `rejected`: a provider fact.
 * - `routing-bar` — the house bar (`select.ts`'s `spendCapFor`), which a spent-plan override may cross.
 * - `usage-limit` — the owner's own usage limit on this plan (`../plans/usageLimit.ts`): a ceiling no `--force`
 *   and no escape hatch crosses.
 * - `not-measured` — a monthly-spend plan with no fresh, readable spend reading (`./spendPolicy.ts`), so nothing shows
 *   it is under the owner's limit and it takes no autonomous work until `slopweaver claude spend` records one.
 *
 * The last two are LOCAL POLICY, never provider exhaustion, and a surface that reports one as the other has misread
 * the owner's limit as a provider wall.
 */
export type ClaudeExclusionKind = "provider-refused" | "routing-bar" | "usage-limit" | "not-measured";

/** An account excluded from selection, and the reason, so a decision can explain itself without re-deriving. */
export interface ClaudeExclusion {
  readonly alias: ClaudeAccountAlias;
  readonly kind: ClaudeExclusionKind;
  readonly reason: string;
  /** When this account becomes eligible again, ISO-8601, when that instant is known. */
  readonly eligibleAtIso?: string;
}

/**
 * What a selection pass concluded. `all-exhausted` is a first-class outcome rather than an error: every plan
 * being spent is a state the fleet must report and wait out, not a failure of the rotator.
 */
export type ClaudeRotationDecision =
  | {
      readonly kind: "rotate";
      readonly to: ClaudeAccountAlias;
      readonly from?: ClaudeAccountAlias;
      readonly excluded: readonly ClaudeExclusion[];
    }
  | {
      readonly kind: "stay";
      readonly on: ClaudeAccountAlias;
      readonly reason: string;
    }
  | {
      readonly kind: "all-exhausted";
      readonly excluded: readonly ClaudeExclusion[];
      /**
       * The earliest instant any plan-wide window resets, ISO-8601 — what the alert must carry so the owner
       * is told when the fleet comes back, not only that it is down. ABSENT when there were no gauges to
       * derive it from, which is a different state from "resets now" and must never be flattened into one.
       */
      readonly earliestResetIso?: string;
    };
