/**
 * Why a plan Connect verb could not do what it was asked — the verb's own failures, never the sign-in's (a sign-in
 * that fails is a `failed` record with a {@link ./connection.ConnectionFailure}, which the console words).
 */
import type { PlanRegisterError } from "./errors.js";

/**
 * A register failure as a Connect message or record says it — a closed clause per code, never the register's own
 * message. Those are written for a CLI reader and several end in a terminal command (`plans validate`, `store status`,
 * `plans list`, `plans sync-accounts` inside a conflict), while the console shows these words to the owner, who is
 * never handed one. No pass-through, so a new code fails to compile here
 * rather than leaking its message.
 *
 * @param error the register's own failure
 * @returns the clause a Connect message or attempt record carries
 */
export function registerReason({ error }: { error: PlanRegisterError }): string {
  switch (error.code) {
    case "PROJECTION_WRITE_FAILED":
      return (
        "the plan is registered, but the generated copy older readers use was not rewritten, so they see the " +
        "previous plans until it is"
      );
    case "REGISTER_STORE_UNAVAILABLE":
      return "the store that holds the plan register could not be reached";
    case "REGISTER_UNREADABLE":
      return "the plan register file could not be read";
    case "REGISTER_INVALID":
      return "the plan register is not usable as it stands";
    case "UNKNOWN_DESTINATION":
      return `no registered ${error.provider} plan is called ${error.alias}`;
    case "MUTATION_CONFLICT":
      return "the plan register refused this plan as it stands";
    case "REGISTER_REVISION_CONFLICT":
      return "the plan register changed while this sign-in was being registered";
    case "SEAT_PASSES_NOT_CLEARED":
      return "the seats' cached passes could not be cleared";
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/** The attempt record could not be read. */
export interface ConnectionUnreadableError {
  readonly code: "CONNECTION_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The attempt record, or a marker beside it, could not be written. */
export interface ConnectionUnwritableError {
  readonly code: "CONNECTION_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** A Connect was asked for while the provider's last attempt is still in flight. */
export interface ConnectionInFlightError {
  readonly code: "CONNECTION_IN_FLIGHT";
  readonly message: string;
  readonly id: string;
}

/** Another Connect for the provider is being started this instant, between its checks and its first record. */
export interface ConnectionStartingError {
  readonly code: "CONNECTION_STARTING";
  readonly message: string;
}

/** No attempt carries the id a Cancel or the worker named. */
export interface ConnectionNotFoundError {
  readonly code: "CONNECTION_NOT_FOUND";
  readonly message: string;
  readonly id: string;
}

/** A worker's attempt is no longer the provider's record — a later Connect replaced it — so it writes nothing. */
export interface ConnectionSupersededError {
  readonly code: "CONNECTION_SUPERSEDED";
  readonly message: string;
  readonly id: string;
}

/**
 * An attempt that could not finish also could not remove the fresh store it reserved — a start whose record was never
 * written, or a worker whose sign-in may already sit in it — so a store stands that no plan names. No record carries
 * this, so the error does.
 */
export interface ConnectionStoreLeftError {
  readonly code: "CONNECTION_STORE_LEFT_BEHIND";
  readonly message: string;
  readonly storeDir: string;
  readonly cause: PlanConnectionError;
}

/**
 * A starting record whose store is not one a Connect would have reserved for its alias, or one a register row already
 * names — so the worker neither signs into it nor removes it.
 */
export interface ConnectionStoreForeignError {
  readonly code: "CONNECTION_STORE_FOREIGN";
  readonly message: string;
  readonly storeDir: string;
}

/** A provider whose Connect is not built yet. */
export interface ConnectionUnsupportedError {
  readonly code: "CONNECTION_UNSUPPORTED";
  readonly message: string;
  readonly host: string;
}

/** The register could not be read, so no store or alias could be chosen. */
export interface ConnectionRegisterError {
  readonly code: "CONNECTION_REGISTER_UNREADABLE";
  readonly message: string;
}

/** The background worker could not be launched. */
export interface ConnectionLaunchError {
  readonly code: "CONNECTION_LAUNCH_FAILED";
  readonly message: string;
}

/** Every way a Connect verb fails. */
export type PlanConnectionError =
  | ConnectionUnreadableError
  | ConnectionUnwritableError
  | ConnectionInFlightError
  | ConnectionStartingError
  | ConnectionNotFoundError
  | ConnectionSupersededError
  | ConnectionStoreLeftError
  | ConnectionStoreForeignError
  | ConnectionUnsupportedError
  | ConnectionRegisterError
  | ConnectionLaunchError;

/** The one factory each failure is built through. */
export const PlanConnectionErrors = {
  inFlight: ({ id }: { id: string }): ConnectionInFlightError => ({
    code: "CONNECTION_IN_FLIGHT",
    id,
    message: `a sign-in is already in progress (${id}) — finish or cancel it first`,
  }),
  foreignStore: ({ reason, storeDir }: { reason: string; storeDir: string }): ConnectionStoreForeignError => ({
    code: "CONNECTION_STORE_FOREIGN",
    message: `the sign-in attempt names ${storeDir}, which ${reason}, so it was neither signed into nor removed`,
    storeDir,
  }),
  launchFailed: ({ cause }: { cause: string }): ConnectionLaunchError => ({
    code: "CONNECTION_LAUNCH_FAILED",
    message: `the sign-in could not be started in the background: ${cause}`,
  }),
  notFound: ({ id }: { id: string }): ConnectionNotFoundError => ({
    code: "CONNECTION_NOT_FOUND",
    id,
    message: `no sign-in attempt has the id ${id}`,
  }),
  registerUnreadable: ({ error }: { error: PlanRegisterError }): ConnectionRegisterError => ({
    code: "CONNECTION_REGISTER_UNREADABLE",
    message: `the plan register could not be read: ${registerReason({ error })}`,
  }),
  starting: (): ConnectionStartingError => ({
    code: "CONNECTION_STARTING",
    message: "another sign-in is being started right now — try again in a moment",
  }),
  storeLeft: ({
    cause,
    removal,
    storeDir,
  }: {
    cause: PlanConnectionError;
    removal: string;
    storeDir: string;
  }): ConnectionStoreLeftError => ({
    cause,
    code: "CONNECTION_STORE_LEFT_BEHIND",
    message: `${cause.message}; ${storeDir} was left behind, and no plan names it: ${removal}`,
    storeDir,
  }),
  superseded: ({ id }: { id: string }): ConnectionSupersededError => ({
    code: "CONNECTION_SUPERSEDED",
    id,
    message: `sign-in attempt ${id} was replaced by a later one, so its record was left alone`,
  }),
  unreadable: ({ cause, path }: { cause: string; path: string }): ConnectionUnreadableError => ({
    code: "CONNECTION_UNREADABLE",
    message: `${path} could not be read: ${cause}`,
    path,
  }),
  unsupported: ({ host }: { host: string }): ConnectionUnsupportedError => ({
    code: "CONNECTION_UNSUPPORTED",
    host,
    message: `connecting a ${host} plan from the console is not built yet`,
  }),
  unwritable: ({ cause, path }: { cause: string; path: string }): ConnectionUnwritableError => ({
    code: "CONNECTION_UNWRITABLE",
    message: `${path} could not be written: ${cause}`,
    path,
  }),
} as const;

/** Why a Connect worker kept a store it would otherwise remove: each is a store left behind, its words on the record. */
export interface StoreKeptError {
  readonly code:
    | "NOT_CONNECTS_STORE"
    | "RESERVATION_UNREADABLE"
    | "RESERVATION_NOT_OURS"
    | "REGISTER_UNREADABLE"
    | "PLAN_HOLDS_STORE"
    | "REMOVAL_FAILED";
  readonly message: string;
}

/** The reasons a worker keeps a store rather than remove it. */
export const StoreKeptErrors = {
  notConnects: ({ alias }: { alias: string }): StoreKeptError => ({
    code: "NOT_CONNECTS_STORE",
    message: `it is not the store a Connect reserves for ${alias}, so it was not removed`,
  }),
  planHolds: ({ alias }: { alias: string }): StoreKeptError => ({
    code: "PLAN_HOLDS_STORE",
    message: `the plan ${alias} now uses it, so it was not removed`,
  }),
  registerUnreadable: ({ error }: { error: PlanRegisterError }): StoreKeptError => ({
    code: "REGISTER_UNREADABLE",
    message: `the register could not be read to check no plan uses it: ${registerReason({ error })}`,
  }),
  removalFailed: ({ cause }: { cause: string }): StoreKeptError => ({ code: "REMOVAL_FAILED", message: cause }),
  reservationNotOurs: (): StoreKeptError => ({
    code: "RESERVATION_NOT_OURS",
    message: "it does not carry this attempt's reservation, so it was not removed",
  }),
  reservationUnreadable: ({ cause }: { cause: string }): StoreKeptError => ({
    code: "RESERVATION_UNREADABLE",
    message: `its reservation could not be read to check it is this attempt's: ${cause}`,
  }),
} as const;
