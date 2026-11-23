/**
 * The shapes the Codex fleet's reader, ranker and renderers all pass between them — split out so none of
 * the three needs to import another purely to reach a type, the same seam `./quotaTypes.ts` cuts for the
 * quota modules.
 *
 * A Codex destination is the PAIR `{ alias, codexHome }` (`./destinations.ts`), and everything here is
 * built around observations OF one: what the register says about it, what its own rollout log last read,
 * and whether its cap record is currently refusing. Nothing here reads a credential, and no field can hold
 * one — an alias is a neutral local label and a home is a directory.
 */
import type { CodexThresholds } from "../plans/thresholds.js";
import type { PlanRegisterSnapshot, RegisteredPlan } from "../plans/types.js";
import type { CodexAccountLive } from "./accountLiveParse.js";
import type { CodexDestination } from "./destinations.js";
import type { CodexGauge } from "./gauge.js";
import type { CodexGaugeScan } from "./gaugeScan.js";
import type { CodexQuotaDecision } from "./quotaGate.js";

/** One registered Codex destination, and every piece of evidence gathered about it in one read. */
export interface CodexPlanObservation {
  /** The register row, kept WHOLE — `paused` decides routing, the cached `email` is shown beside the live one. */
  readonly plan: RegisteredPlan;
  /** The pair a spender addresses: the alias its cap record is keyed by, and the home its log lives in. */
  readonly destination: CodexDestination;
  /** That home's own freshest reading, plus what the bounded scan had to leave out. */
  readonly scan: CodexGaugeScan;
  /** Why the scan never ran — the read was under a caller's deadline — so an empty {@link scan} is not an empty log. */
  readonly scanSkippedReason?: string;
  /** What that store's own app-server answered in this read: signed in as whom, or why there is no answer. */
  readonly live: CodexAccountLive;
  /**
   * The reading every POLICY decision ranks on — never `scan.gauge` directly. A live `codex` bucket wins over
   * a rollout line of any age; a store the live read proved signed out, missing, or metered under no `codex`
   * bucket has NONE, because a days-old rollout percentage describes an account nobody can spend now. Only an
   * `unreadable` live read falls back to the rollout scan, which is exactly what this read did before it
   * could ask the app-server.
   */
  readonly gauge: CodexGauge | undefined;
  /** Where {@link gauge} came from, so every surface prints it rather than letting a reader guess. */
  readonly gaugeSource: CodexGaugeSource;
  /** Whether that destination is refusing right now, merged across its cache, its log and its live answer. */
  readonly quota: CodexQuotaDecision;
}

/** Which source an observation's effective gauge was taken from. */
export type CodexGaugeSource = "live" | "rollout" | "none";

/** One read of the whole Codex fleet: the register it came from, and an observation per Codex row. */
export interface CodexFleetSnapshot {
  /** The single instant the whole read was judged against, so two rows cannot be dated differently. */
  readonly readAtIso: string;
  /** The register as decoded, diagnostics included — a reader needs to know it was DERIVED, not adopted. */
  readonly register: PlanRegisterSnapshot;
  /** Every Codex row, in register order, which survives as the ranking's final tie-break. */
  readonly observations: readonly CodexPlanObservation[];
  /** The register's Codex bars, read with the rows, so every judgement over this read uses the same ones. */
  readonly thresholds: CodexThresholds;
}

/**
 * Which key schema produced an ordering, so a caller PRINTS the degradation rather than hiding it.
 *
 * The distinction that matters is `weekly-partial`: some destinations carried a usable weekly reading and
 * others did not, so the unmeasured ones are deferred behind the measured ones rather than ranked among
 * them. Reporting that as plain `weekly` would let a reader believe an unread account had been compared.
 */
export type CodexRankBasis =
  /** Every eligible destination carried a usable weekly reading. */
  | "weekly"
  /** Some did; the rest are DEFERRED behind them, never sorted as if they read zero. */
  | "weekly-partial"
  /** None did, so the order is the remaining keys and, in the end, register order. */
  | "weekly-unmeasured"
  /** Nothing was eligible at all — every row was excluded, or the register carries no Codex row. */
  | "no-eligible-destination";

/** Why a destination took no part in the ordering. Paused and refusing are NOT the same fact. */
export interface CodexRouteExclusion {
  readonly destination: CodexDestination;
  /**
   * `paused` is the owner's own standing decision, recorded on the register row. `quota-refused` is
   * positive evidence, observed from that destination's own log or cap record, that work cannot proceed
   * there now. `near-cap` is a reading at or past `./routingCapacity.ts`'s 99% bar — a routing guard, NOT
   * provider evidence, so it never counts as a cap by itself (a 100% window still does, through `./gaugeAlert.ts`'s
   * `codexHeadroom`); a fleet held out by it is the fleet's `routingPause`, which licenses the Claude fallback
   * verbs and nothing else (`./fleetCap.ts`). `signed-out` is the store's own app-server saying nothing
   * is signed in there (or the store directory does not exist) — a 401 waiting to happen, and NOT a cap: its
   * reason names the login that fixes it.
   *
   * `usage-limit` and `not-measured` are the owner's own register settings (`../plans/usageLimit.ts`), and like
   * `paused` neither is provider evidence nor crossed by `--force`: `usage-limit` is a weekly window at or past the
   * row's own usage limit, `not-measured` a `monthly-spend` allowance nothing here can read, which takes no
   * autonomous work at all.
   */
  readonly kind: "paused" | "not-measured" | "signed-out" | "usage-limit" | "near-cap" | "quota-refused";
  readonly reason: string;
}

/** What one ranking pass concluded. `ranked[0]` is the destination a new seat or pass should take. */
export interface CodexPlanRanking {
  /** Every eligible destination, best first. Empty when none can take the work. */
  readonly ranked: readonly CodexDestination[];
  readonly excluded: readonly CodexRouteExclusion[];
  /** Eligible destinations held behind the measured ones because no usable weekly reading was found. */
  readonly deferredUnmeasured: readonly string[];
  readonly basis: CodexRankBasis;
}
