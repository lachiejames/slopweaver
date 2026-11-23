/**
 * One plan sign-in the Settings modal's Connect button started, as a record the console polls — the pure half.
 *
 * ## Why a record and not a held request
 *
 * A sign-in waits on a person in a browser for minutes, and the console's act route awaits its child under a short
 * timeout. So `plans connect` writes a `starting` record, backgrounds a worker that holds the provider's own sign-in
 * open, and returns at once; the worker moves the record through its phases and the console reads it back with
 * `plans connections`. Setting a plan up must never hand the owner a terminal command, so a failure
 * here says WHY and offers Try again, never a line to paste.
 *
 * ## What it never holds
 *
 * No token, no code, no credential. The sign-in lands in the plan's own store, the provider CLI's business; the one
 * provider string kept is the sign-in page's address, so the console can offer to open it again.
 *
 * Pure: shapes, decode and the judgement of a record against the clock. The file edge is `./connectionStore.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import { isPlanAlias } from "./alias.js";
import type { PlanProvider } from "./types.js";

/** Where an attempt stands. The first two are ACTIVE; the rest are where it ended. */
export type ConnectionPhase = "starting" | "browser" | "connected" | "failed" | "cancelled";

/** Why an attempt failed — a closed set, so the console words each one and none falls back to a raw error. */
export type ConnectionFailure =
  /** The provider's CLI is not installed where Slopweaver looks for it. */
  | "CLI_MISSING"
  /** The provider refused to start a sign-in — most often another sign-in already holds its callback port. */
  | "START_REFUSED"
  /** The provider answered with a sign-in address that is not its own sign-in page, so it was never opened. */
  | "URL_REFUSED"
  /** The sign-in page could not be opened in a browser. */
  | "BROWSER_FAILED"
  /** The provider reported the sign-in itself failed. */
  | "SIGN_IN_FAILED"
  /** Nobody finished the sign-in before the attempt's deadline. */
  | "TIMED_OUT"
  /** The provider's CLI stopped answering mid sign-in. */
  | "EXITED"
  /** The worker holding the sign-in is gone, and the record was never finished. */
  | "INTERRUPTED"
  /** The account that signed in is already a connected plan, so a second copy would add no capacity. */
  | "DUPLICATE_ACCOUNT"
  /** The sign-in worked but the provider named no account, so it could not be checked for a twin and is not added. */
  | "ACCOUNT_UNKNOWN"
  /** The sign-in worked but the plan could not be written into the register. */
  | "REGISTER_FAILED";

/** Every failure code, for decode and for the console's wording table. */
export const CONNECTION_FAILURES: readonly ConnectionFailure[] = [
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
];

/** One attempt, as stored. */
export interface PlanConnection {
  /** An opaque id, minted at start — what Cancel and the worker name. */
  readonly id: string;
  readonly host: PlanProvider;
  readonly phase: ConnectionPhase;
  /** The alias the plan will be (or was) registered under. */
  readonly alias: string;
  /** The fresh store the sign-in lands in, which the register gains a row for. */
  readonly storeDir: string;
  readonly startedAtIso: string;
  readonly updatedAtIso: string;
  /** When an active attempt is given up on — the worker's own deadline plus a margin. */
  readonly deadlineAtIso: string;
  /** The provider's sign-in page, once it handed one over — so the console can open it again. */
  readonly signInUrl?: string;
  /** The address the signed-in account reported, once connected. */
  readonly email?: string;
  /** Why it failed, on a `failed` record. */
  readonly failure?: ConnectionFailure;
  /** The provider's own words about the failure, when it gave any — shown under the failure's wording. */
  readonly detail?: string;
}

/**
 * Whether a phase is still in flight.
 *
 * @param phase the stored phase
 * @returns true for `starting` and `browser`
 */
export function isActivePhase({ phase }: { phase: ConnectionPhase }): boolean {
  return phase === "starting" || phase === "browser";
}

const PHASES: ReadonlySet<string> = new Set(["starting", "browser", "connected", "failed", "cancelled"]);
const FAILURES: ReadonlySet<string> = new Set(CONNECTION_FAILURES);

/** Whether a stored string is one of the phases. */
function isPhase(value: string): value is ConnectionPhase {
  return PHASES.has(value);
}

/** Whether a stored string is one of the failure codes. */
function isFailure(value: string): value is ConnectionFailure {
  return FAILURES.has(value);
}

const ID_PATTERN = /^[a-z0-9-]{8,64}$/;

/**
 * Whether a string is a well-formed attempt id — it names a marker FILE, so nothing else may reach a path.
 *
 * @param id the candidate
 * @returns whether it is 8 to 64 lowercase letters, digits and hyphens
 */
export function isConnectionId({ id }: { id: string }): boolean {
  return ID_PATTERN.test(id);
}

/** An optional string field: absent stays absent, a non-string makes the record unreadable. */
function optionalString({ record, key }: { record: Record<string, unknown>; key: string }): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  return value;
}

/** The optional fields of a record, or `undefined` when one of them is malformed. */
function optionalFields({
  record,
}: {
  record: Record<string, unknown>;
}): Pick<PlanConnection, "signInUrl" | "email" | "failure" | "detail"> | undefined {
  const signInUrl = optionalString({ key: "signInUrl", record });
  const email = optionalString({ key: "email", record });
  const failure = optionalString({ key: "failure", record });
  const detail = optionalString({ key: "detail", record });
  if (signInUrl === null || email === null || failure === null || detail === null) {
    return undefined;
  }
  if (failure !== undefined && !isFailure(failure)) {
    return undefined;
  }
  return {
    ...(signInUrl === undefined ? {} : { signInUrl }),
    ...(email === undefined ? {} : { email }),
    ...(failure === undefined ? {} : { failure }),
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Decode one stored record.
 *
 * @param value the parsed JSON
 * @returns the record, or `undefined` for anything that is not exactly one — a reader treats that as no attempt
 */
export function parsePlanConnection({ value }: { value: unknown }): PlanConnection | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { alias, deadlineAtIso, host, id, phase, startedAtIso, storeDir, updatedAtIso } = value;
  const wellFormed =
    typeof id === "string" &&
    isConnectionId({ id }) &&
    (host === "claude" || host === "codex") &&
    typeof phase === "string" &&
    isPhase(phase) &&
    typeof alias === "string" &&
    isPlanAlias({ alias }) &&
    typeof storeDir === "string" &&
    storeDir.startsWith("/") &&
    typeof startedAtIso === "string" &&
    parseStrictIsoInstantMs({ text: startedAtIso }) !== undefined &&
    typeof updatedAtIso === "string" &&
    parseStrictIsoInstantMs({ text: updatedAtIso }) !== undefined &&
    typeof deadlineAtIso === "string" &&
    parseStrictIsoInstantMs({ text: deadlineAtIso }) !== undefined;
  if (!wellFormed) {
    return undefined;
  }
  const optional = optionalFields({ record: value });
  if (optional === undefined) {
    return undefined;
  }
  return {
    alias,
    deadlineAtIso,
    host,
    id,
    phase,
    startedAtIso,
    storeDir,
    updatedAtIso,
    ...optional,
  };
}

/**
 * The record as a reader should see it now: an active attempt past its deadline is `failed` / `INTERRUPTED`,
 * because the worker that would have finished it is gone.
 *
 * @param connection the stored record
 * @param nowMs the instant it is judged at
 * @returns the record, or its interrupted reading
 */
export function connectionAsOf({ connection, nowMs }: { connection: PlanConnection; nowMs: number }): PlanConnection {
  if (!isActivePhase({ phase: connection.phase })) {
    return connection;
  }
  const deadlineMs = parseStrictIsoInstantMs({ text: connection.deadlineAtIso })!;
  if (nowMs < deadlineMs) {
    return connection;
  }
  return { ...connection, failure: "INTERRUPTED", phase: "failed" };
}

/**
 * Whether a Connect may start now, given the provider's last attempt.
 *
 * @param previous the last stored attempt for this provider, judged as of now, or `undefined`
 * @returns `undefined` when it may, else the id of the attempt still in flight
 */
export function activeConnectionId({ previous }: { previous: PlanConnection | undefined }): string | undefined {
  if (previous === undefined || !isActivePhase({ phase: previous.phase })) {
    return undefined;
  }
  return previous.id;
}
