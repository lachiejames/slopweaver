/**
 * The shapes ONE register of plans is written in — a row per destination a session can be seated on,
 * whichever provider serves it.
 *
 * ## Why a register at all, and what it is NOT
 *
 * Claude routing read `claude-accounts/accounts.json` and Codex read one ambient `$CODEX_HOME`, so the two
 * providers had two mechanisms, no shared list, and a plan number the owner had to hold in their head to say
 * which account a seat would land on. The register makes it very clear which plan is bound to which account, or
 * abstracts that away from the owner entirely. This file is the register's vocabulary; the source is the store's singleton `plan_register` row
 * (`src/store/schema/planRegister.ts`), and `$SLOPWEAVER_HOME/plans.json` and `claude-accounts/accounts.json`
 * are one-way projections of it for checkouts that predate the store.
 *
 * It is a register of DESTINATIONS, not of accounts. A row names a store directory a provider's own CLI is
 * signed into, and nothing here can tell two directories signed into the same account apart from two
 * directories signed into two: **two homes signed into the same account add no capacity**, and no field in
 * this file claims otherwise. {@link RegisteredPlan.email} is the same display cache
 * `src/claude/accountBinding.ts` already governs — printable, labelled as unverified, never a selector.
 *
 * **No field here can hold a credential.** A row carries a path and a label; the token behind that path is
 * the provider CLI's business and is never read, copied or rendered by this repository.
 *
 * Pure types. Decoding is {@link ../plans/register.parsePlanRegister}, the file edge is `store.ts`.
 */
import type { PlanThresholds, ThresholdMutation } from "./thresholds.js";
import type { PlanAllowance, UsageLimitPercent } from "./usageLimit.js";

/** Which provider serves a registered destination. A CLOSED union — see this module's header. */
export type PlanProvider = "claude" | "codex";

/**
 * Why a plan is deliberately out of the fleet, and since when — the same contract
 * `src/claude/contracts.ts`'s `ClaudePausedPlan` carries, widened to every provider.
 *
 * A pause is a STATE, not a countdown: there is deliberately no return date, because the thing a pause
 * usually waits on is another person's decision.
 */
export interface PlanPause {
  /** What the plan is out for, printed by every surface that would otherwise print a provider refusal. */
  readonly reason: string;
  /** When the pause was recorded, ISO-8601 — what makes a forgotten pause visible rather than permanent. */
  readonly sinceIso: string;
}

/** One registered destination: which provider serves it, what it is called, and where its store lives. */
export interface RegisteredPlan {
  readonly provider: PlanProvider;
  /**
   * A NEUTRAL LOCAL LABEL, unique within its provider. Never derived from an email address: an alias names
   * a store directory, and a store outlives whichever account is signed into it.
   */
  readonly alias: string;
  /**
   * The directory the provider's own CLI is signed into — `CLAUDE_SECURESTORAGE_CONFIG_DIR` for Claude,
   * `CODEX_HOME` for Codex. The string is preserved EXACTLY: Claude derives its keychain service by hashing
   * this path, so a rewritten spelling addresses a different, empty credential.
   */
  readonly storeDir: string;
  /** A display CACHE of the address the owner calls this destination's account — never its identity. */
  readonly email?: string;
  /** Present when this plan is deliberately out of the fleet. ABSENT is the normal case. */
  readonly paused?: PlanPause;
  /**
   * Whether pinned CLAUDE seats boot against this destination. At most one Claude row, never a paused one. Codex has no
   * pinned seat and ranks every destination in one pool (`codex/rank.ts`), so `plans pin` and `plans add
   * --pinned` refuse a Codex row; a Codex pin already on disk still parses and decides nothing.
   */
  readonly pinned?: boolean;
  /**
   * What this plan's allowance is measured in — a share of a week, or of a month's spend limit. A row that names
   * none is a `weekly-window` subscription, decided once at decode (`./usageLimit.ts`).
   */
  readonly allowance: PlanAllowance;
  /**
   * The share of {@link allowance} the owner lets Slopweaver take — a CEILING every routing gate stops at and no
   * override crosses. A row that names none is 100, decided once at decode.
   */
  readonly usageLimitPercent: UsageLimitPercent;
  /**
   * When the PAID SUBSCRIPTION behind this destination ends, ISO-8601 — never a credential's expiry and never a
   * rate window's reset. Recorded by hand with `plans lapse`, because no provider boundary this repository holds
   * returns it. It decides no ROUTE: a past date is printed conspicuously and a lapsed plan leaves routing by
   * `plans pause`, the one exclusion. It does decide its provider's LANE (`./laneShape.ts`): a lapse at or before
   * now stops the plan standing, so the supervisor's chair model, timer sweep and idle-capacity gate follow it.
   * ABSENT reads `lapse UNRECORDED` and stands, never a guess.
   */
  readonly lapsesAtIso?: string;
}

/**
 * The register document as it is stored, raw fields and all.
 *
 * The raw rows are kept beside the typed ones because a write must not silently drop a field this version
 * does not read — an older or newer writer's key survives a pause performed here.
 */
export interface PlanRegisterDocument {
  readonly version: 1;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

/** Something a reader must be TOLD about the configuration it just read, short of a failure. */
export interface PlanDiagnostic {
  readonly code:
    | "DERIVED_REGISTER"
    | "PROJECTION_DIVERGED"
    | "UNKEYED_QUOTA_UNATTRIBUTED"
    | "UNKNOWN_CAPACITY"
    | "AMBIENT_PASS_UNREGISTERED";
  readonly message: string;
}

/** The configuration one read produced, and whether it came from a real register or was derived. */
export interface PlanRegisterSnapshot {
  /** `derived` means nothing has been adopted yet and this picture was computed, not read. */
  readonly source: "derived" | "registered";
  readonly document: PlanRegisterDocument;
  readonly plans: readonly RegisteredPlan[];
  /**
   * The install's routing, alert and grading thresholds, decoded from {@link document}'s `thresholds` with absent
   * fields at their defaults (`./thresholds.ts`). Decoded only: the document keeps exactly what was written.
   */
  readonly thresholds: PlanThresholds;
  readonly diagnostics: readonly PlanDiagnostic[];
  /**
   * The store row's revision this picture was read at — what a write's compare-and-set pins to. `null` for
   * a picture no row backs: a derived, unadopted install, or a document decoded but not yet stored.
   *
   * Storage concurrency metadata, deliberately OUTSIDE {@link document}: the document is register format
   * version 1, and a counter inside it would be a field an older reader of the `plans.json` projection
   * carries back as configuration.
   */
  readonly revision: number | null;
}

/** The two fields that name one row: the provider serving it and its alias, unique within that provider. */
interface PlanRowAddress {
  readonly provider: PlanProvider;
  readonly alias: string;
}

/** One change to the register. One row is one change — there is no shape here for a standing grant. */
export type PlanMutation =
  | { readonly kind: "adopt" }
  | { readonly kind: "add"; readonly row: RegisteredPlan }
  | {
      readonly kind: "pause";
      readonly provider: PlanProvider;
      readonly alias: string;
      readonly paused: PlanPause;
    }
  | { readonly kind: "resume"; readonly provider: PlanProvider; readonly alias: string }
  | { readonly kind: "pin"; readonly provider: PlanProvider; readonly alias: string }
  | {
      /**
       * Take one destination off the register entirely — a subscription dropped, an account replaced. The store
       * directory it named is left on disk untouched: its sign-in is the provider CLI's, never this repository's.
       */
      readonly kind: "remove";
      readonly provider: PlanProvider;
      readonly alias: string;
      /** When it was removed — the register keeps the alias and its store so the alias never names another (`./removed.ts`). */
      readonly removedAtIso: string;
    }
  | {
      /** Take a Claude row's pin away without moving it, so the last plan can be paused. */
      readonly kind: "unpin";
      readonly provider: PlanProvider;
      readonly alias: string;
    }
  | {
      /** Forget a recorded lapse: one recorded by mistake, or a subscription renewed with no end date. */
      readonly kind: "clear-lapse";
      readonly provider: PlanProvider;
      readonly alias: string;
    }
  | ({
      /**
       * Correct the address a row is called by, as the owner states it — the Claude counterpart of `record-email`,
       * which only a live Codex read writes.
       */
      readonly kind: "set-email";
      readonly email: string;
    } & PlanRowAddress)
  | ({
      /**
       * Re-home one destination at a new store path — the same account moved, a machine move say — keeping its
       * alias and everything keyed on it. A Codex row's recorded address described the old directory, so it goes.
       */
      readonly kind: "set-store-dir";
      readonly storeDir: string;
    } & PlanRowAddress)
  | {
      /** Record when one destination's paid subscription ends. Replaces any date already recorded: a renewal moves it. */
      readonly kind: "set-lapse";
      readonly provider: PlanProvider;
      readonly alias: string;
      readonly lapsesAtIso: string;
    }
  | {
      /**
       * Record the address a store's own provider reported it signed into. `storeDir` is the row's store AS
       * READ, so a row re-pointed between the read and the write refuses rather than taking another store's
       * address — the address describes a directory, not an alias.
       */
      readonly kind: "record-email";
      readonly provider: PlanProvider;
      readonly alias: string;
      readonly storeDir: string;
      readonly email: string;
    }
  | {
      /** Record the usage limit the owner chose for one plan, and the allowance it is a share of. */
      readonly kind: "set-usage-limit";
      readonly provider: PlanProvider;
      readonly alias: string;
      readonly allowance: PlanAllowance;
      readonly usageLimitPercent: UsageLimitPercent;
      /**
       * The limit the change was read as moving FROM (`--from`), absent when the caller named none. When present the
       * change refuses unless the row still carries it, so a press on a page drawn from an older reading cannot move a
       * limit off a value nobody saw — the Fleet page's raise button always names it.
       */
      readonly fromUsageLimitPercent?: UsageLimitPercent;
    }
  | {
      /** Set or reset some of one provider's install-wide thresholds (`./thresholds.ts`). Addresses no row. */
      readonly kind: "set-thresholds";
      readonly change: ThresholdMutation;
    }
  | { readonly kind: "repair-projection" };
