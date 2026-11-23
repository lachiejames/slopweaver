/**
 * What the last probe of each Claude plan found, kept so a monitor can float a fault the minute a probe confirms it.
 *
 * The owner needs a floating note when a plan is not set up locally, signed out, or otherwise wrong, because a
 * plan once sat signed out for about 72 hours with nothing saying so. The probes already ran — `claude gauge` every supervisor tick,
 * `claude watch` every keep-alive tick, the routing gate on every spawn — and each printed its problem to a transcript
 * nobody reads. A monitor pass is a
 * LOCAL read by contract (`../monitor/sources.ts`), so it cannot probe; this record is what crosses from the probe to
 * the pass.
 *
 * ## The three answers a probe gives
 *
 * - `ok` — the plan answered with its usage. Any fault it carried is over.
 * - `fault` — a failure that is the plan's own, never the network's: its store directory gone, nothing signed in, a
 *   rejected credential, a rejected or unreadable setup token, or a usage answer of a shape the gauge cannot read.
 * - `unmeasured` — the probe never reached a verdict (`PROBE_TRANSPORT_FAILED`, or a code this module does not
 *   classify). It neither starts a fault nor ends one: `../claude/errors.ts` says of a probe that never reached the
 *   API "attempt nothing", and a network blip clearing the owner's note would be the silent fallback the doctrine bans.
 *
 * ## One fault, one episode
 *
 * "Once per fault" needs the fault to have an identity that survives a hundred probes reading the same thing. A fault
 * is an EPISODE: it starts the first time a code is seen on a store, keeps its `sinceIso` while the same code repeats
 * on the same store (an `unmeasured` probe in between included), and ends on `ok`, on a different code, or when the
 * alias is re-pointed at another store. `lastSeenIso` moves on every probe that confirms it — what a monitor compares
 * the owner's Done against, so a Done no probe has re-tested yet is held rather than contradicted.
 *
 * Pure: the clock, the probe's reading and the previous record arrive as arguments.
 */
import { err, ok, type Result } from "#lib/result.js";

import { parseStrictIsoInstantMs } from "../lib/date.js";
import { isRecord } from "../lib/parsers.js";

import type { ClaudeRotationError } from "./errors.js";

/** The faults whose one fix is the owner's own sign-in: `slopweaver claude signin --plan <alias>`. */
const CLAUDE_SIGN_IN_FAULTS = ["STORE_MISSING", "STORE_NOT_READY", "CREDENTIAL_REJECTED"] as const;

/**
 * The faults a sign-in does NOT fix: the probe prefers the setup token, so a rejected or unreadable one is re-minted
 * by a seat (`../cli/commands/claude/mintRun.ts`), and a usage answer of a new shape is a code change. The owner asks
 * for the repair on the card, never by typing words to a session.
 */
const CLAUDE_BROKEN_FAULTS = ["SETUP_TOKEN_REJECTED", "SETUP_TOKEN_UNREADABLE", "USAGE_SHAPE_CHANGED"] as const;

/** A probe failure that is the plan's own. `STORE_MISSING` is this module's: the store directory is not on disk. */
export type ClaudePlanFaultCode = (typeof CLAUDE_SIGN_IN_FAULTS)[number] | (typeof CLAUDE_BROKEN_FAULTS)[number];

/** Every code a record may carry, in one list the decoder checks against. */
const FAULT_CODES: ReadonlySet<string> = new Set<string>([...CLAUDE_SIGN_IN_FAULTS, ...CLAUDE_BROKEN_FAULTS]);

/** Whether a value is a code a record may carry. */
function isFaultCode(code: unknown): code is ClaudePlanFaultCode {
  return typeof code === "string" && FAULT_CODES.has(code);
}

/**
 * The faults read off the PROVIDER's answer rather than this machine's disk. A network in trouble can mimic every one
 * of them: a proxy or an outage answers with no rate-limit headers, which reads as a usage answer of a new shape. So
 * one probe seeing one is not yet a verdict — {@link isUnconfirmedFault}.
 */
const CLAUDE_ANSWERED_FAULTS: ReadonlySet<ClaudePlanFaultCode> = new Set<ClaudePlanFaultCode>([
  "CREDENTIAL_REJECTED",
  "SETUP_TOKEN_REJECTED",
  "USAGE_SHAPE_CHANGED",
]);

/**
 * Whether a fault episode still waits on a second probe before anything floats: a fault read off the provider's
 * answer, seen by one probe only. An episode keeps its `sinceIso` while the same code repeats, so `lastSeenIso`
 * moving past it is the second probe's confirmation, an unmeasured probe in between included. A fault read off the
 * disk — a store gone, nothing signed in, a token file that does not read — is confirmed by the one probe that saw it.
 *
 * MEASURED: one `claude watch` probe during a network blip read no `7d-status` header on two plans, two cards
 * floated eleven seconds later, and the next probe read both plans fine. Reproduce with
 * `grep -n 'mon-claude-plan-t' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"`: each card's detail says the fault was
 * last confirmed at the instant it began.
 *
 * Confirmed means a LATER instant, compared as instants: a record whose last sighting is not after its first — one
 * probe, or a record no writer made with the two reversed — is unconfirmed. The residue, stated: two probes are not
 * independent evidence, so an outage spanning two probes still floats its card on the second; the rule is that one
 * answer never does.
 *
 * @param fault the episode a plan's record carries
 * @returns true when the episode floats nothing yet
 */
export function isUnconfirmedFault({
  fault,
}: {
  fault: Pick<ClaudePlanFault, "code" | "lastSeenIso" | "sinceIso">;
}): boolean {
  if (!CLAUDE_ANSWERED_FAULTS.has(fault.code)) {
    return false;
  }
  const sinceMs = parseStrictIsoInstantMs({ text: fault.sinceIso });
  const lastMs = parseStrictIsoInstantMs({ text: fault.lastSeenIso });
  return sinceMs === undefined || lastMs === undefined || lastMs <= sinceMs;
}

/**
 * Whether a code is one of {@link CLAUDE_SIGN_IN_FAULTS}.
 *
 * @param code a fault code
 * @returns true when the owner's sign-in is the fix
 */
export function isSignInFault({ code }: { code: ClaudePlanFaultCode }): boolean {
  return (CLAUDE_SIGN_IN_FAULTS as readonly string[]).includes(code);
}

/** What ONE probe concluded about one plan. */
export type ClaudePlanProbeObservation =
  | { readonly kind: "ok" }
  | { readonly kind: "fault"; readonly code: ClaudePlanFaultCode; readonly message: string }
  | { readonly kind: "unmeasured"; readonly message: string };

/** The fault episode a plan is in, while it is in one. */
export interface ClaudePlanFault {
  readonly code: ClaudePlanFaultCode;
  /** The latest probe's own words for it. */
  readonly message: string;
  /** When this episode was first seen. With the store and the code, its identity. */
  readonly sinceIso: string;
  /** When a probe last confirmed it. */
  readonly lastSeenIso: string;
}

/** What the last probe of one plan found, and the fault episode it is in, if any. */
export interface ClaudePlanProbeRecord {
  readonly alias: string;
  /** The store the probe read. A record for another store says nothing about this one. */
  readonly storeDir: string;
  /** When the latest probe ran. */
  readonly observedAtIso: string;
  readonly latest: "ok" | "fault" | "unmeasured";
  /** Why the latest probe was unmeasured, when it was. */
  readonly unmeasuredBecause: string | undefined;
  readonly fault: ClaudePlanFault | undefined;
}

/** Every plan's record, as the `claude-plan-probes` singleton register stores it. */
export interface ClaudePlanProbesDocument {
  readonly schemaVersion: 1;
  readonly plans: readonly ClaudePlanProbeRecord[];
}

/** One probe to record: which plan, on which store, when, and what it concluded. */
export interface ClaudePlanProbeObserved {
  readonly alias: string;
  readonly storeDir: string;
  readonly observedAtIso: string;
  readonly observation: ClaudePlanProbeObservation;
}

/**
 * What one probe's typed reading concludes. The store's absence is checked by the caller, on disk, and wins: a plan
 * "not set up locally" is told as that, not as the sign-in the missing store also lacks.
 *
 * @param reading the probe's typed result (`./probeStore.ts`'s `ClaudeProbeResult.reading`)
 * @param storeExists whether the plan's store directory is on disk
 * @returns the observation
 */
export function observationOfReading({
  reading,
  storeExists,
}: {
  reading: Result<unknown, ClaudeRotationError>;
  storeExists: boolean;
}): ClaudePlanProbeObservation {
  if (!storeExists) {
    return { code: "STORE_MISSING", kind: "fault", message: "its store directory is not on this machine" };
  }
  if (reading.isOk()) {
    return { kind: "ok" };
  }
  const { code, message } = reading.error;
  if (isFaultCode(code)) {
    return { code, kind: "fault", message };
  }
  return { kind: "unmeasured", message };
}

/** What recording one probe does to the record it lands on. */
export type ClaudePlanProbeTransition =
  { readonly kind: "write"; readonly record: ClaudePlanProbeRecord } | { readonly kind: "keep"; readonly why: string };

/**
 * The record one probe leaves behind, given the one it lands on.
 *
 * @param observed the probe
 * @param previous the plan's current record, when it has one
 * @returns the record to write, or why the current one stands — a probe no newer than the record's own is stale
 */
export function nextClaudePlanProbeRecord({
  observed,
  previous,
}: {
  observed: ClaudePlanProbeObserved;
  previous: ClaudePlanProbeRecord | undefined;
}): ClaudePlanProbeTransition {
  const { alias, observation, observedAtIso, storeDir } = observed;
  // A record for another store says nothing about this one, so a re-pointed alias starts clean.
  const sameStorePrevious = previous?.storeDir === storeDir ? previous : undefined;
  if (sameStorePrevious !== undefined && sameStorePrevious.observedAtIso >= observedAtIso) {
    return { kind: "keep", why: `a probe at ${sameStorePrevious.observedAtIso} is already recorded for ${alias}` };
  }
  const carried = sameStorePrevious?.fault;
  const base = { alias, observedAtIso, storeDir };
  if (observation.kind === "ok") {
    return { kind: "write", record: { ...base, fault: undefined, latest: "ok", unmeasuredBecause: undefined } };
  }
  if (observation.kind === "unmeasured") {
    return {
      kind: "write",
      record: { ...base, fault: carried, latest: "unmeasured", unmeasuredBecause: observation.message },
    };
  }
  let sinceIso = observedAtIso;
  if (carried !== undefined && carried.code === observation.code) {
    sinceIso = carried.sinceIso;
  }
  const fault: ClaudePlanFault = {
    code: observation.code,
    lastSeenIso: observedAtIso,
    message: observation.message,
    sinceIso,
  };
  return { kind: "write", record: { ...base, fault, latest: "fault", unmeasuredBecause: undefined } };
}

/**
 * The document with every probe recorded, each through {@link nextClaudePlanProbeRecord}. A plan no probe names is
 * carried as it stands.
 *
 * @param document the document as read, or undefined when the register holds none yet
 * @param observed the probes to record
 * @returns the next document, and one line per probe that was stale and kept out
 */
export function withClaudePlanProbes({
  document,
  observed,
}: {
  document: ClaudePlanProbesDocument | undefined;
  observed: readonly ClaudePlanProbeObserved[];
}): { readonly document: ClaudePlanProbesDocument; readonly kept: readonly string[] } {
  const byAlias = new Map<string, ClaudePlanProbeRecord>();
  for (const record of document === undefined ? [] : document.plans) {
    byAlias.set(record.alias, record);
  }
  const kept: string[] = [];
  for (const probe of observed) {
    const next = nextClaudePlanProbeRecord({ observed: probe, previous: byAlias.get(probe.alias) });
    if (next.kind === "keep") {
      kept.push(next.why);
    } else {
      byAlias.set(probe.alias, next.record);
    }
  }
  const plans = [...byAlias.values()].toSorted((a, b) => a.alias.localeCompare(b.alias));
  return { document: { plans, schemaVersion: 1 }, kept };
}

/**
 * Why a stored document did not decode. One variant: no caller branches on which field was wrong, and the message
 * names it for the one that reads it.
 *
 * @internal
 */
export interface ClaudePlanProbesUndecodableError {
  readonly code: "CLAUDE_PLAN_PROBES_UNDECODABLE";
  readonly message: string;
}

/** The decoder's one refusal. */
function undecodable({ why }: { why: string }): ClaudePlanProbesUndecodableError {
  return { code: "CLAUDE_PLAN_PROBES_UNDECODABLE", message: why };
}

/**
 * A stored instant in the one spelling every comparison here relies on — UTC, `Z`, milliseconds — or undefined when it
 * is not one. Every writer stamps `toISOString()`, yet the decoder admits any strict ISO instant, and records are
 * ordered by comparing these as TEXT: an offset spelling kept as written would sort a later probe before an earlier
 * one and keep a recovered plan's card up.
 */
function utcInstant({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const ms = parseStrictIsoInstantMs({ text: value });
  if (ms === undefined) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

/** Decode one stored fault, or say what is wrong with it. */
function decodeFault({
  value,
}: {
  value: unknown;
}): Result<ClaudePlanFault | undefined, ClaudePlanProbesUndecodableError> {
  if (value === undefined || value === null) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(undecodable({ why: "a fault is not an object" }));
  }
  const { code, message } = value;
  if (!isFaultCode(code)) {
    return err(undecodable({ why: `a fault's code ${String(code)} is not one this version knows` }));
  }
  const sinceIso = utcInstant({ value: value["sinceIso"] });
  const lastSeenIso = utcInstant({ value: value["lastSeenIso"] });
  if (typeof message !== "string" || sinceIso === undefined || lastSeenIso === undefined) {
    return err(undecodable({ why: `the ${code} fault does not carry a message, a sinceIso and a lastSeenIso` }));
  }
  return ok({ code, lastSeenIso, message, sinceIso });
}

/** A record's fault, decoded and held against what its latest probe read, or what is wrong with the pair. */
function decodeFaultBesideLatest({
  alias,
  latest,
  value,
}: {
  alias: string;
  latest: ClaudePlanProbeRecord["latest"];
  value: unknown;
}): Result<ClaudePlanFault | undefined, ClaudePlanProbesUndecodableError> {
  const fault = decodeFault({ value });
  if (fault.isErr()) {
    return err(undecodable({ why: `${alias}: ${fault.error.message}` }));
  }
  if (latest === "fault" && fault.value === undefined) {
    return err(undecodable({ why: `${alias}'s latest probe is a fault, and the record carries none` }));
  }
  // An ok probe ends the episode (`nextClaudePlanProbeRecord`), so a fault beside one is a record no writer made;
  // read as it stands it would keep a recovered plan's card up for good.
  if (latest === "ok" && fault.value !== undefined) {
    return err(undecodable({ why: `${alias}'s latest probe read ok, and the record still carries a fault` }));
  }
  return fault;
}

/** Decode one stored record, or say what is wrong with it. */
function decodeRecord({ value }: { value: unknown }): Result<ClaudePlanProbeRecord, ClaudePlanProbesUndecodableError> {
  if (!isRecord(value)) {
    return err(undecodable({ why: "a plan's record is not an object" }));
  }
  const { alias, latest, storeDir, unmeasuredBecause } = value;
  if (typeof alias !== "string" || alias.length === 0 || typeof storeDir !== "string" || storeDir.length === 0) {
    return err(undecodable({ why: "a plan's record names no alias or no store" }));
  }
  const observedAtIso = utcInstant({ value: value["observedAtIso"] });
  if (observedAtIso === undefined) {
    return err(undecodable({ why: `${alias}'s record carries no observedAtIso instant` }));
  }
  if (latest !== "ok" && latest !== "fault" && latest !== "unmeasured") {
    return err(undecodable({ why: `${alias}'s latest probe ${String(latest)} is not ok, fault or unmeasured` }));
  }
  if (unmeasuredBecause !== undefined && unmeasuredBecause !== null && typeof unmeasuredBecause !== "string") {
    return err(undecodable({ why: `${alias}'s unmeasuredBecause is not text` }));
  }
  const fault = decodeFaultBesideLatest({ alias, latest, value: value["fault"] });
  if (fault.isErr()) {
    return err(fault.error);
  }
  return ok({
    alias,
    fault: fault.value,
    latest,
    observedAtIso,
    storeDir,
    unmeasuredBecause: typeof unmeasuredBecause === "string" ? unmeasuredBecause : undefined,
  });
}

/**
 * Validate the stored document. A field no version declares is tolerated, as every singleton register's decoder
 * tolerates one; a record that is not the declared shape refuses the whole document, never reads as an absent plan —
 * an absent record is unmeasured, and a refused one is said.
 *
 * @param value the stored `jsonb`
 * @returns the document, or what is wrong with it
 */
export function decodeClaudePlanProbesDocument({
  value,
}: {
  value: unknown;
}): Result<ClaudePlanProbesDocument, ClaudePlanProbesUndecodableError> {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return err(undecodable({ why: "it is not a schemaVersion 1 object" }));
  }
  const listed = value["plans"];
  if (!Array.isArray(listed)) {
    return err(undecodable({ why: "plans is not a list" }));
  }
  const plans: ClaudePlanProbeRecord[] = [];
  const seen = new Set<string>();
  for (const entry of listed) {
    const record = decodeRecord({ value: entry });
    if (record.isErr()) {
      return err(record.error);
    }
    if (seen.has(record.value.alias)) {
      return err(undecodable({ why: `${record.value.alias} is recorded twice` }));
    }
    seen.add(record.value.alias);
    plans.push(record.value);
  }
  return ok({ plans, schemaVersion: 1 });
}
