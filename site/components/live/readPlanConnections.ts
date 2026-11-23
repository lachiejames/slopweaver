/**
 * The reader for `plans connections --json`: the sign-in a Connect press started, per provider, for Settings → Models'
 * live row (`../console/ModelsSettings.tsx`).
 *
 * Strict in `./read.ts`'s sense: a payload that does not read is `undefined`, which the tab names as not measured. An
 * attempt whose phase or failure code this console does not know refuses the whole reading, because a row drawn as
 * the wrong step would invite the wrong press — a Cancel on an attempt that already ended, or a Try again over one
 * still waiting in the browser.
 */

import { type Bag, instant, isBag, str, sub } from "../../lib/bag";

/** Every phase an attempt passes through, restated from `src/plans/connection.ts`'s `ConnectionPhase`. */
export const CONNECTION_PHASES = ["starting", "browser", "connected", "failed", "cancelled"] as const;

/** One of {@link CONNECTION_PHASES}. */
export type ConnectionPhase = (typeof CONNECTION_PHASES)[number];

/** Every way an attempt can fail, restated from `src/plans/connection.ts`'s `CONNECTION_FAILURES`. */
export const CONNECTION_FAILURES = [
  "CLI_MISSING",
  "START_REFUSED",
  "URL_REFUSED",
  "BROWSER_FAILED",
  "SIGN_IN_FAILED",
  "TIMED_OUT",
  "EXITED",
  "INTERRUPTED",
  "DUPLICATE_ACCOUNT",
  "ACCOUNT_UNKNOWN",
  "REGISTER_FAILED",
] as const;

/** One of {@link CONNECTION_FAILURES}. */
export type ConnectionFailure = (typeof CONNECTION_FAILURES)[number];

/** One attempt, as the live row needs it. */
export interface PlanConnectionView {
  readonly id: string;
  readonly host: "claude" | "codex";
  readonly phase: ConnectionPhase;
  /** The plan the attempt connects, as the register will name it. */
  readonly alias: string;
  readonly updatedAtIso: string;
  /** The provider's own sign-in page, once the worker opened it, so the row can open it again. */
  readonly signInUrl: string | undefined;
  /** The account it signed into, once it did. */
  readonly email: string | undefined;
  /** Present exactly when the phase is `failed`. */
  readonly failure: ConnectionFailure | undefined;
  /** The provider's or the worker's own words about a failure, when it gave any. */
  readonly detail: string | undefined;
}

/** The whole reading: at most one attempt per provider, the latest. */
export interface PlanConnectionsView {
  readonly claude: PlanConnectionView | undefined;
  readonly codex: PlanConnectionView | undefined;
}

/**
 * Whether a string is one of {@link CONNECTION_PHASES}.
 *
 * @returns true for a phase this console draws
 */
function isPhase(value: string): value is ConnectionPhase {
  return CONNECTION_PHASES.some((phase) => phase === value);
}

/**
 * Whether a string is one of {@link CONNECTION_FAILURES}.
 *
 * @returns true for a failure this console words
 */
function isFailure(value: string): value is ConnectionFailure {
  return CONNECTION_FAILURES.some((failure) => failure === value);
}

/**
 * An optional string field: absent reads as `undefined`, present must be a string.
 *
 * @returns the value, `undefined` when absent, or `false` when present and not a string
 */
function optionalStr({ bag, key }: { bag: Bag; key: string }): string | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const value = str({ bag, key });
  if (value === undefined) {
    return false;
  }
  return value;
}

/**
 * One attempt, or `undefined` when any field the row needs does not read or contradicts the provider it is filed
 * under.
 *
 * @param host the key the attempt sits under, which its own `host` field must repeat
 * @returns the attempt
 */
function connectionOf({ bag, host }: { bag: Bag; host: "claude" | "codex" }): PlanConnectionView | undefined {
  const id = str({ bag, key: "id" });
  const phase = str({ bag, key: "phase" });
  const alias = str({ bag, key: "alias" });
  const updatedAtIso = instant({ bag, key: "updatedAtIso" });
  if (id === undefined || id.length === 0 || alias === undefined || updatedAtIso === undefined) {
    return undefined;
  }
  if (str({ bag, key: "host" }) !== host || phase === undefined || !isPhase(phase)) {
    return undefined;
  }
  const signInUrl = optionalStr({ bag, key: "signInUrl" });
  const email = optionalStr({ bag, key: "email" });
  const detail = optionalStr({ bag, key: "detail" });
  const failureText = optionalStr({ bag, key: "failure" });
  if (signInUrl === false || email === false || detail === false || failureText === false) {
    return undefined;
  }
  let failure: ConnectionFailure | undefined;
  if (failureText !== undefined) {
    if (!isFailure(failureText)) {
      return undefined;
    }
    failure = failureText;
  }
  if ((phase === "failed") !== (failure !== undefined)) {
    return undefined;
  }
  return { alias, detail, email, failure, host, id, phase, signInUrl, updatedAtIso };
}

/**
 * Project `plans connections --json`.
 *
 * @returns the reading, or `undefined` when the payload, or any attempt in it, does not read
 */
export function readPlanConnections(payload: unknown): PlanConnectionsView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const connections = sub({ bag: payload, key: "connections" });
  if (connections === undefined) {
    return undefined;
  }
  const read: { claude: PlanConnectionView | undefined; codex: PlanConnectionView | undefined } = {
    claude: undefined,
    codex: undefined,
  };
  for (const key of Object.keys(connections)) {
    const bag = sub({ bag: connections, key });
    if (bag === undefined || (key !== "claude" && key !== "codex")) {
      return undefined;
    }
    const one = connectionOf({ bag, host: key });
    if (one === undefined) {
      return undefined;
    }
    read[key] = one;
  }
  return read;
}
