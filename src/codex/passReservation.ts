/**
 * Which destination one Codex PASS may spend once every other pass still running on the same account is counted —
 * the arithmetic and the pass-only ranking behind `./passReservationStore.ts`. Pure: a fleet snapshot, the
 * reservation document and an instant in, a decision out.
 *
 * ## Why a pass reserves
 *
 * A limit the owner sets is respected even if it means taking the fleet down: the fleet maximises to the owner's
 * cap and never goes over it, for Codex as for Claude. The
 * ranking (`./rank.ts`) holds a row out once its week READS at its limit, but a reading moves only when a turn
 * writes an event, so five review properties released together all read 48% under a 50% limit and all spend. So a
 * pass on a limited account takes {@link CODEX_PASS_RESERVATION_POINTS} weekly point under one lock, and the next
 * pass on that account counts it: admitted iff `live used + reserved + 1 <= limit`, equality allowed, because the
 * cap is the owner's and reaching it exactly is what they asked for.
 *
 * ## The account, not the row
 *
 * A limit is a share of an ACCOUNT's week, so every row signed into one account (`./accountIdentity.ts`) is held to
 * the LOWEST sub-100 limit any of them carries — a row registered at 100 beside a row at 30 on the same account
 * inherits 30 here. The account's use is the highest believable weekly reading among its stores, and at least one
 * of them must be LIVE: a rollout line or no reading at all cannot show headroom. An account no provider identity
 * proves is refused rather than reserved against a guess. A group with no sub-100 limit is never reserved for and
 * is ranked exactly as `./fleetCap.ts` ranks it.
 *
 * ## Only the order is borrowed
 *
 * `rankCodexPlans` decides the order and every exclusion, unchanged; this gate only passes over a limited account
 * that cannot hold one more point, and never invents a balancing key. Nothing here is cap evidence, so status,
 * seats, fallback and the fleet-cap record keep reading the ordinary ranking.
 *
 * ## Expiry is the only recovery
 *
 * A row lapses at `acquiredAt + bound + {@link CODEX_PASS_RESERVATION_MARGIN_MS}`. A dead PID does NOT release one
 * early: the PID is diagnostic, and a pass whose parent died may still be spending. Fifteen minutes is the
 * operation lock's own stale bound (`../admit/operationLockHeld.ts`'s `DEFAULT_STALE_AFTER_MS`), covering the setup,
 * snapshot, persistence and shutdown the model's wall-clock bound does not.
 */
import { parseIsoMs } from "#lib/date.js";

import type { UsageLimitPercent } from "../plans/usageLimit.js";
import { type CodexAccountGroup, groupCodexAccounts } from "./accountIdentity.js";
import type { CodexDestination } from "./destinations.js";
import { decideCodexFleetCap } from "./fleetCap.js";
import type { CodexFleetSnapshot, CodexPlanObservation } from "./fleetTypes.js";
import { limitedAccountGate, type PassAccountGate } from "./passReservationGate.js";
import { rankCodexPlans } from "./rank.js";
import type { PassBound } from "./types.js";

/** The weekly percentage points one pass reserves — settled policy, since `codex burn` reports no per-pass maximum. */
const CODEX_PASS_RESERVATION_POINTS = 1;

/** How long past its own bound a reservation stands before it lapses. See the header's § Expiry. */
const CODEX_PASS_RESERVATION_MARGIN_MS = 15 * 60 * 1000;

/** One running pass's hold on its account's week. */
export interface CodexPassReservation {
  readonly id: string;
  /** A digest of the account's provider identities when it was reserved, for a reader; matching uses the list. */
  readonly accountKey: string;
  /** One digest per provider identity and per member store; a later group sharing ANY of them counts this row. */
  readonly accountIdentities: readonly string[];
  readonly destinationAlias: string;
  readonly pid: number;
  readonly acquiredAtIso: string;
  readonly expiresAtIso: string;
  readonly weeklyPoints: 1;
}

/** The whole reservation document, `$SLOPWEAVER_HOME/live/codex-pass-reservations.json`. */
export interface CodexPassReservationDocument {
  readonly schemaVersion: 1;
  readonly reservations: readonly CodexPassReservation[];
}

/** The document a home with no file holds. */
export const EMPTY_CODEX_PASS_RESERVATIONS: CodexPassReservationDocument = { reservations: [], schemaVersion: 1 };

/** What the decision may count on: the document as read, or why there is none — which holds every limited account. */
export type CodexPassReservationStore =
  | { readonly kind: "healthy"; readonly document: CodexPassReservationDocument }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Where one pass goes, and whether it holds a reservation there. */
export type CodexPassReservationDecision =
  | {
      readonly kind: "reserved";
      readonly destination: CodexDestination;
      readonly document: CodexPassReservationDocument;
      readonly reservation: CodexPassReservation;
      readonly why: string;
    }
  | { readonly kind: "unlimited"; readonly destination: CodexDestination; readonly why: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The reservations still standing at `nowIso`: a row lapses only when `expiresAtIso <= nowIso`. A row whose instant
 * cannot be parsed is KEPT, since dropping it would free capacity nothing showed was free.
 *
 * @param document the document as read
 * @param nowIso the instant judged at
 * @returns the standing rows, in file order
 */
function activeCodexPassReservations({
  document,
  nowIso,
}: {
  document: CodexPassReservationDocument;
  nowIso: string;
}): readonly CodexPassReservation[] {
  const nowMs = parseIsoMs({ tsIso: nowIso });
  return document.reservations.filter((row) => {
    const expiresMs = parseIsoMs({ tsIso: row.expiresAtIso });
    return nowMs === undefined || expiresMs === undefined || expiresMs > nowMs;
  });
}

/**
 * The document once one pass's reservation is removed and every lapsed row pruned.
 *
 * @param reservationId the finishing pass's own reservation, the only row removed early
 * @returns the document to publish
 */
export function releaseCodexPassReservation({
  document,
  nowIso,
  reservationId,
}: {
  document: CodexPassReservationDocument;
  nowIso: string;
  reservationId: string;
}): CodexPassReservationDocument {
  const reservations = activeCodexPassReservations({ document, nowIso }).filter((row) => row.id !== reservationId);
  return { reservations, schemaVersion: 1 };
}

/**
 * Whether any registered row carries a usage limit below 100, so a pass on this fleet may need a reservation.
 *
 * @param snapshot one fleet read
 * @returns true when the reservation store has to be consulted
 */
export function codexFleetHasUsageLimit({ snapshot }: { snapshot: CodexFleetSnapshot }): boolean {
  return snapshot.observations.some((observation) => observation.plan.usageLimitPercent < 100);
}

/** The lowest sub-100 usage limit any member of an account carries, or undefined when none does. */
function accountLimit({
  group,
  observations,
}: {
  group: CodexAccountGroup;
  observations: readonly CodexPlanObservation[];
}): UsageLimitPercent | undefined {
  const limits = group.members
    .map((index) => observations[index]!.plan.usageLimitPercent)
    .filter((limit) => limit < 100)
    .toSorted((a, b) => a - b);
  return limits[0];
}

/** The points every standing reservation on this account holds — any shared identity counts the row. */
function reservedOn({ active, group }: { active: readonly CodexPassReservation[]; group: CodexAccountGroup }): number {
  const identities = new Set([...group.provenIdentities, ...group.storeIdentities]);
  return active
    .filter((row) => row.accountIdentities.some((identity) => identities.has(identity)))
    .reduce((sum, row) => sum + row.weeklyPoints, 0);
}

/**
 * Judge one ranked destination's account for this pass.
 *
 * @returns `unlimited` with no reservation, `reserve` with the arithmetic, or `held` with the sentence that says why
 */
function gateAccount({
  active,
  group,
  nowIso,
  observations,
  store,
}: {
  active: readonly CodexPassReservation[];
  group: CodexAccountGroup;
  nowIso: string;
  observations: readonly CodexPlanObservation[];
  store: CodexPassReservationStore;
}): PassAccountGate {
  const limit = accountLimit({ group, observations });
  if (limit === undefined) {
    return { kind: "unlimited" };
  }
  return limitedAccountGate({
    group,
    limit,
    nowIso,
    observations,
    requested: CODEX_PASS_RESERVATION_POINTS,
    reserved: reservedOn({ active, group }),
    store,
  });
}

/** The routed sentence's opening: which destination, where it ranked, and on what. */
function rankedClause({ alias, at, of, basis }: { alias: string; at: number; of: number; basis: string }): string {
  return `${alias} can take a pass — ranked ${String(at)} of ${String(of)} on ${basis}`;
}

/** The trailing clause naming every limited account a pass was routed past, empty when none was. */
function passedOverClause({ held }: { held: readonly string[] }): string {
  return held.length === 0 ? "" : `; passed over ${held.join("; ")}`;
}

/** The refusal when every ranked destination's account was held: each held sentence, then each exclusion. */
function allHeldRefusal({
  excluded,
  held,
}: {
  excluded: ReturnType<typeof rankCodexPlans>["excluded"];
  held: readonly string[];
}): CodexPassReservationDecision {
  const excludedClauses = excluded.map((entry) => `${entry.destination.alias} (${entry.kind}: ${entry.reason})`);
  return {
    kind: "refused",
    why: `no Codex destination can take this pass within its account's usage limit — ${[...held, ...excludedClauses].join("; ")}`,
  };
}

/** The rows still standing at `atIso` in a store that can be counted on, and none in one that cannot. */
function standingIn({
  atIso,
  store,
}: {
  atIso: string;
  store: CodexPassReservationStore;
}): readonly CodexPassReservation[] {
  if (store.kind !== "healthy") {
    return [];
  }
  return activeCodexPassReservations({ document: store.document, nowIso: atIso });
}

/** Why a store was judged unavailable: the id minted for the new row already names a standing one. */
const RESERVATION_ID_CLASH = "the reservation id minted for this pass already names a standing reservation";

/**
 * The rows standing at `reservedAtIso` and the store to judge by: the store as read, or unavailable when the minted
 * id already names a STANDING row — one release would then erase two holds, so nothing stands to count. A lapsed row
 * of that id is pruned on publish, so it clashes with nothing (both found by a Codex review).
 */
function clashChecked({
  reservationId,
  reservedAtIso,
  store,
}: {
  reservationId: string;
  reservedAtIso: string;
  store: CodexPassReservationStore;
}): { readonly active: readonly CodexPassReservation[]; readonly store: CodexPassReservationStore } {
  const active = standingIn({ atIso: reservedAtIso, store });
  if (active.some((row) => row.id === reservationId)) {
    return { active: [], store: { kind: "unavailable", reason: RESERVATION_ID_CLASH } };
  }
  return { active, store };
}

/** The decision for a pass that takes a reservation: the new row, the document that holds it and the routed sentence. */
function reservedDecision({
  active,
  bound,
  destination,
  gate,
  group,
  held,
  pid,
  ranked,
  reservationId,
  reservedAtIso,
  reservedAtMs,
}: {
  active: readonly CodexPassReservation[];
  bound: PassBound;
  destination: CodexDestination;
  gate: Extract<PassAccountGate, { kind: "reserve" }>;
  group: CodexAccountGroup;
  held: readonly string[];
  pid: number;
  ranked: string;
  reservationId: string;
  reservedAtIso: string;
  reservedAtMs: number;
}): CodexPassReservationDecision {
  const reservation: CodexPassReservation = {
    accountIdentities: [...group.provenIdentities, ...group.storeIdentities],
    accountKey: gate.accountKey,
    acquiredAtIso: reservedAtIso,
    destinationAlias: destination.alias,
    expiresAtIso: new Date(reservedAtMs + bound.totalMs + CODEX_PASS_RESERVATION_MARGIN_MS).toISOString(),
    id: reservationId,
    pid,
    weeklyPoints: CODEX_PASS_RESERVATION_POINTS,
  };
  const terms = `reserved ${String(CODEX_PASS_RESERVATION_POINTS)} weekly point of its account's ${String(gate.limit)}% usage limit (read live at ${String(gate.usedPercent)}% used, ${String(gate.reserved)} already reserved) until ${reservation.expiresAtIso}`;
  const document: CodexPassReservationDocument = { reservations: [...active, reservation], schemaVersion: 1 };
  return {
    destination,
    document,
    kind: "reserved",
    reservation,
    why: `${ranked}; ${terms}${passedOverClause({ held })}`,
  };
}

/**
 * Decide where one pass goes, and whether it reserves its account's week to get there.
 *
 * @param bound the pass's own wall-clock bound, which sets the reservation's expiry
 * @param nowIso the instant the fleet read was taken at — what every reading is ranked and judged against, exactly as
 *   routing with no reservation judges it
 * @param observations every registered Codex row's evidence, in register order
 * @param pid the reserving process, kept on the row as diagnostic evidence only
 * @param reservationId the id the new row takes, if one is made
 * @param reservedAtIso a clock read AFTER the fleet read, under the lock that publishes the result: a new row is
 *   dated from it and a standing row is judged expired at it, so a stalled read never publishes an expired row
 * @param store the reservation document as read, or why it could not be
 * @param thresholds the register's Codex bars, read with the observations
 * @returns reserved, unlimited, or refused with every reason
 */
export function decideCodexPassReservation({
  bound,
  nowIso,
  observations,
  pid,
  reservationId,
  reservedAtIso,
  store: asRead,
  thresholds,
}: {
  bound: PassBound;
  nowIso: string;
  observations: readonly CodexPlanObservation[];
  pid: number;
  reservationId: string;
  reservedAtIso: string;
  store: CodexPassReservationStore;
  thresholds: CodexFleetSnapshot["thresholds"];
}): CodexPassReservationDecision {
  const ranking = rankCodexPlans({ nowIso, observations, thresholds });
  const reservedAtMs = parseIsoMs({ tsIso: reservedAtIso });
  if (ranking.ranked.length === 0 || reservedAtMs === undefined) {
    return { kind: "refused", why: decideCodexFleetCap({ observations, ranking }).why };
  }
  const groups = groupCodexAccounts({ candidates: observations });
  const { active, store } = clashChecked({ reservationId, reservedAtIso, store: asRead });
  const held: string[] = [];
  for (const [index, destination] of ranking.ranked.entries()) {
    const at = observations.findIndex((observation) => observation.destination.alias === destination.alias);
    const group = groups.find((candidate) => candidate.members.includes(at))!;
    const gate = gateAccount({ active, group, nowIso, observations, store });
    const ranked = rankedClause({
      alias: destination.alias,
      at: index + 1,
      basis: ranking.basis,
      of: ranking.ranked.length,
    });
    if (gate.kind === "held") {
      held.push(`${destination.alias} (usage-limit: ${gate.reason})`);
      continue;
    }
    if (gate.kind === "unlimited") {
      return { destination, kind: "unlimited", why: `${ranked}${passedOverClause({ held })}` };
    }
    return reservedDecision({
      active,
      bound,
      destination,
      gate,
      group,
      held,
      pid,
      ranked,
      reservationId,
      reservedAtIso,
      reservedAtMs,
    });
  }
  return allHeldRefusal({ excluded: ranking.excluded, held });
}
