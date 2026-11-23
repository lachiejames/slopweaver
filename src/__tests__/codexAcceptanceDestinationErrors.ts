/**
 * Why the paid Codex acceptance run has no registered plan to spend — the refusals
 * `./codexAcceptanceDestination.ts`'s picker distinguishes, each a different thing for the person running it to fix.
 */

/** The environment variable naming the registered Codex alias a paid acceptance run spends. */
export const CODEX_ACCEPTANCE_PLAN_ENV = "CODEX_ACCEPTANCE_PLAN";

/** The store holds no register row: the install never adopted one, so nothing it chose exists to spend. */
export interface AcceptanceRegisterNotAdoptedError {
  readonly code: "REGISTER_NOT_ADOPTED";
  readonly message: string;
}

/** The named alias is not a Codex row on the register. */
export interface AcceptancePlanNotRegisteredError {
  readonly code: "PLAN_NOT_REGISTERED";
  readonly message: string;
  readonly alias: string;
  /** Every registered Codex alias, paused ones included, in register order. */
  readonly registeredAliases: readonly string[];
}

/** The named Codex row is paused, so the owner has withheld paid traffic from it. */
export interface AcceptancePlanPausedError {
  readonly code: "PLAN_PAUSED";
  readonly message: string;
  readonly alias: string;
  readonly reason: string;
  readonly sinceIso: string;
}

/**
 * The plan carries a usage ceiling below its whole allowance, or a monthly-spend allowance. Either is a limit no
 * route crosses, and checking headroom against it takes a fleet read that writes the home — so the run refuses.
 */
export interface AcceptancePlanUsageLimitedError {
  readonly code: "PLAN_USAGE_LIMITED";
  readonly message: string;
  readonly alias: string;
}

/**
 * The plan's `storeDir` is relative. The browser door's probes resolve it against the thread's scratch working
 * directory while the SDK spawn resolves it against this process's, so the door would vet one `CODEX_HOME` and the
 * paid turn would spend another.
 */
export interface AcceptancePlanHomeRelativeError {
  readonly code: "PLAN_HOME_RELATIVE";
  readonly message: string;
  readonly alias: string;
  readonly storeDir: string;
}

/** No alias was named and the register holds no unpaused Codex row. */
export interface AcceptanceNoCodexPlanError {
  readonly code: "NO_CODEX_PLAN";
  readonly message: string;
  readonly registeredAliases: readonly string[];
}

/** No alias was named and more than one Codex row is unpaused, so the run will not pick one. */
export interface AcceptancePlanAmbiguousError {
  readonly code: "PLAN_AMBIGUOUS";
  readonly message: string;
  readonly aliases: readonly string[];
}

/** Why the paid acceptance run has no registered Codex plan to spend. */
export type AcceptancePlanError =
  | AcceptanceNoCodexPlanError
  | AcceptancePlanAmbiguousError
  | AcceptancePlanHomeRelativeError
  | AcceptancePlanNotRegisteredError
  | AcceptancePlanPausedError
  | AcceptancePlanUsageLimitedError
  | AcceptanceRegisterNotAdoptedError;

/** Render a list of aliases for a refusal, naming the empty case rather than printing nothing. */
function aliasList({ aliases }: { aliases: readonly string[] }): string {
  if (aliases.length === 0) {
    return "none";
  }
  return aliases.join(", ");
}

/** Factories for {@link AcceptancePlanError}. */
export const AcceptancePlanErrors = {
  ambiguous: ({ aliases }: { aliases: readonly string[] }): AcceptancePlanAmbiguousError => ({
    aliases,
    code: "PLAN_AMBIGUOUS",
    message: `more than one Codex plan is unpaused (${aliasList({ aliases })}) — name one with ${CODEX_ACCEPTANCE_PLAN_ENV}=<alias>`,
  }),
  homeRelative: ({ alias, storeDir }: { alias: string; storeDir: string }): AcceptancePlanHomeRelativeError => ({
    alias,
    code: "PLAN_HOME_RELATIVE",
    message: `${alias}'s store directory "${storeDir}" is relative, so the browser door and the paid spawn would resolve different CODEX_HOMEs — register it by absolute path`,
    storeDir,
  }),
  noCodexPlan: ({ registeredAliases }: { registeredAliases: readonly string[] }): AcceptanceNoCodexPlanError => ({
    code: "NO_CODEX_PLAN",
    message: `the plan register holds no unpaused Codex plan (registered Codex plans: ${aliasList({ aliases: registeredAliases })})`,
    registeredAliases,
  }),
  notAdopted: (): AcceptanceRegisterNotAdoptedError => ({
    code: "REGISTER_NOT_ADOPTED",
    message:
      "the store holds no plan register, so no Codex plan is registered to pay — register one with `slopweaver plans add`; an unregistered ~/.codex login is never spent",
  }),
  notRegistered: ({
    alias,
    registeredAliases,
  }: {
    alias: string;
    registeredAliases: readonly string[];
  }): AcceptancePlanNotRegisteredError => ({
    alias,
    code: "PLAN_NOT_REGISTERED",
    message: `${CODEX_ACCEPTANCE_PLAN_ENV}=${alias} names no Codex plan on the register (registered: ${aliasList({ aliases: registeredAliases })})`,
    registeredAliases,
  }),
  paused: ({
    alias,
    reason,
    sinceIso,
  }: {
    alias: string;
    reason: string;
    sinceIso: string;
  }): AcceptancePlanPausedError => ({
    alias,
    code: "PLAN_PAUSED",
    message: `${alias} is paused since ${sinceIso} (${reason}) — a paid run never spends a plan taken out of the fleet`,
    reason,
    sinceIso,
  }),
  usageLimited: ({ alias }: { alias: string }): AcceptancePlanUsageLimitedError => ({
    alias,
    code: "PLAN_USAGE_LIMITED",
    message: `${alias} carries a usage ceiling (a usage limit below 100% or a monthly-spend allowance) this run cannot check without writing the home — name a plan with neither`,
  }),
} as const;
