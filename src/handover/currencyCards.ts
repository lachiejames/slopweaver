/**
 * Every Queue card `handover currency` reads, as a {@link CurrencyCardCandidate}: its exact key, the floor that
 * versions it, and whether its facts were re-confirmed. The pure half; the registers are read by
 * `../cli/commands/handover/currencyCardRead.ts`, and the cards a register holding them confirms are
 * `./currencyHeldCards.ts`'s.
 *
 * Every card kind is ranked by what needs the owner most, checking both the facts and the owner's steers. A card's floor is the instant the console stamps on
 * the same card (`site/lib/queueRows.ts` `currencyFloorIso`), so a newer card never inherits an older card's reading:
 *
 * - a hand step: when it was posted. Its facts: the register still holding it, or for a monitor's step that
 *   monitor's own last recorded pass naming it — a register that still holds a step whose monitor has gone clear
 *   is not a confirmation.
 * - an ask: the later of its asking and its last still-real check ({@link askFloorOf}). Its facts: the later of that
 *   check and a read of its Slack thread finding no reply.
 * - a held reply, a parked review: when it was parked. A parked post: when its current words were written — its newest
 *   voice revision, else the owner's pick, else its park — so the words the owner said that reworked it are not "said since". Its
 *   facts: the register still holding it.
 * - a pull request: GitHub's own `updatedAt`, never the landing poll's instant, which would make an unchanged pull
 *   request a new card on every poll. Its facts: that poll.
 */
import { isRecord } from "#lib/parsers.js";

import { type HandStep, waitingHandSteps } from "../hand/step.js";
import { handStepId, MONITOR_STEP_PREFIX, MONITORS, occurrenceBase } from "../monitor/registry.js";
import type { MonitorId, MonitorSubject } from "../monitor/types.js";
import { prCardKey, prCardKeyParts } from "../talk/prCardKey.js";
import type { CurrencyAsk, CurrencyCardCandidate, CurrencyDone, CurrencyFact, NotConfirmedWhy } from "./currency.js";

/** A source of cards that would not read whole, so a reading built without it would miss cards it cannot name. */
export interface CardSourceUnreadableError {
  readonly code: "CARD_SOURCE_UNREADABLE";
  readonly message: string;
  readonly source: string;
}

/** A source of cards that read, but passed over lines it could not make a card of. */
export interface CardSourcePartialError {
  readonly code: "CARD_SOURCE_PARTIAL";
  readonly message: string;
  readonly source: string;
  readonly lines: number;
}

/** Why the cards could not be read whole — the reading is then not written at all, never written short. */
export type CurrencyCardReadError = CardSourceUnreadableError | CardSourcePartialError;

/** Builds {@link CurrencyCardReadError}. */
export const CurrencyCardReadErrors = {
  partial: ({ source, lines }: { source: string; lines: number }): CardSourcePartialError => ({
    code: "CARD_SOURCE_PARTIAL",
    lines,
    message: `the ${source} passed over ${String(lines)} line(s) it could not read, so a card may be missing`,
    source,
  }),
  unreadable: ({ source, why }: { source: string; why: string }): CardSourceUnreadableError => ({
    code: "CARD_SOURCE_UNREADABLE",
    message: `the ${source} would not read: ${why}`,
    source,
  }),
} as const;

/** A monitor's last recorded pass, as a monitor hand's facts need it. */
export type RecordedMonitorPass =
  | {
      readonly kind: "read";
      /** When the pass was observed — the instant a confirmed fact carries. */
      readonly observedAtIso: string;
      readonly state: "firing" | "clear" | "steered" | "unmeasurable";
      /** On a firing pass, the hand-step base id of every subject it carded. */
      readonly firingBases: readonly string[];
    }
  | {
      readonly kind: "unread";
      readonly why: NotConfirmedWhy;
      /** The failed read's own reason, for the card's staleness mark only — never its Facts line. */
      readonly detail?: string;
    };

/** The four states a monitor reading declares (`../monitor/types.ts` `MonitorReading`). */
const MONITOR_STATES = ["firing", "clear", "steered", "unmeasurable"] as const;

/**
 * The bag a value is, when it is a plain object.
 *
 * @param value anything
 * @returns its fields, or `undefined` when it is not an object
 */
function bagOf({ value }: { value: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return value;
}

/**
 * The subjects of a firing reading, each through the id its card is posted under.
 *
 * @param subjects the reading's `subjects` field
 * @param prefix the monitor's own token
 * @returns each subject's base id, or `undefined` when a subject is not a whole subject
 */
function firingBasesOf({ subjects, prefix }: { subjects: unknown; prefix: string }): string[] | undefined {
  if (!Array.isArray(subjects)) {
    return undefined;
  }
  const bases: string[] = [];
  for (const value of subjects) {
    const bag = bagOf({ value });
    const [id, key, label] = [bag?.["id"], bag?.["key"], bag?.["label"]];
    if (typeof id !== "string" || typeof key !== "string" || typeof label !== "string") {
      return undefined;
    }
    const subject: MonitorSubject = { id, key, label };
    bases.push(handStepId({ prefix, subject }));
  }
  return bases;
}

/**
 * One monitor's last pass, decoded strictly from the document `monitor check --only <id> --json` records: a
 * document that does not hold a well-formed reading of this monitor is a pass that would not read, never a clear one.
 *
 * @param document the recorded `{ readings, actions }` document
 * @param observedAtIso the ledger row's observed instant
 * @param monitorId which monitor's reading to take
 * @returns the pass
 */
export function monitorPassOf({
  document,
  observedAtIso,
  monitorId,
}: {
  document: unknown;
  observedAtIso: string;
  monitorId: MonitorId;
}): RecordedMonitorPass {
  const readings = bagOf({ value: document })?.["readings"];
  if (!Array.isArray(readings)) {
    return { kind: "unread", why: "its monitor's last recorded pass is not a monitor check document" };
  }
  const reading = readings.map((value) => bagOf({ value })).find((bag) => bag?.["monitorId"] === monitorId);
  if (reading === undefined) {
    return { kind: "unread", why: "its monitor's last recorded pass holds no reading of that monitor" };
  }
  const state = MONITOR_STATES.find((known) => known === reading["state"]);
  if (state === undefined) {
    return { kind: "unread", why: "its monitor's last recorded pass declares a state this check does not know" };
  }
  if (state !== "firing") {
    return { firingBases: [], kind: "read", observedAtIso, state };
  }
  const prefix = MONITORS.find((monitor) => monitor.id === monitorId)!.prefix;
  const firingBases = firingBasesOf({ prefix, subjects: reading["subjects"] });
  if (firingBases === undefined) {
    return { kind: "unread", why: "its monitor's last recorded pass carries a subject this check cannot read" };
  }
  return { firingBases, kind: "read", observedAtIso, state };
}

/**
 * The monitor a hand step was posted by, when its id is a monitor's.
 *
 * @returns the monitor, or `undefined` for a step no monitor posts
 */
export function monitorOfStep({ stepId }: { stepId: string }): MonitorId | undefined {
  const base = occurrenceBase({ id: stepId });
  return MONITORS.find((monitor) => base.startsWith(`${MONITOR_STEP_PREFIX}${monitor.prefix}-`))?.id;
}

/** The plain-language reason a pass that did not name the step leaves its facts unconfirmed. */
const NOT_NAMED: Readonly<Record<(typeof MONITOR_STATES)[number], NotConfirmedWhy>> = {
  clear: "its monitor's last pass found the condition clear",
  firing: "its monitor's last pass no longer names it",
  steered: "its monitor's last pass found a steer of yours already answers it",
  unmeasurable: "its monitor's last pass could not measure it",
};

/**
 * A monitor step's facts: confirmed only by its monitor's own last pass, firing and naming this step's base.
 *
 * @param step the step
 * @param monitorId the monitor that posts it
 * @param pass that monitor's last pass, absent when none was read
 * @returns the facts
 */
function monitorFact({
  step,
  monitorId,
  pass,
}: {
  step: HandStep;
  monitorId: MonitorId;
  pass: RecordedMonitorPass | undefined;
}): CurrencyFact {
  if (pass === undefined) {
    return { kind: "not-confirmed", why: "no pass of its monitor is recorded" };
  }
  if (pass.kind === "unread") {
    return pass.detail === undefined
      ? { kind: "not-confirmed", why: pass.why }
      : { kind: "not-confirmed", unread: pass.detail, why: pass.why };
  }
  if (pass.state === "firing" && pass.firingBases.includes(occurrenceBase({ id: step.id }))) {
    return { atIso: pass.observedAtIso, by: `the ${monitorId} monitor's last pass`, kind: "confirmed" };
  }
  return { kind: "not-confirmed", why: NOT_NAMED[pass.state] };
}

/**
 * Every hand step waiting on the owner, as a card.
 *
 * @param steps every open step, notices included — the same filter the console reads drops those
 * @param checkedIso when the register was read
 * @param passes each monitor's last pass, for the monitors that own an open step
 * @returns the cards
 */
export function handCurrencyCards({
  steps,
  checkedIso,
  passes,
}: {
  steps: readonly HandStep[];
  checkedIso: string;
  passes: ReadonlyMap<MonitorId, RecordedMonitorPass>;
}): CurrencyCardCandidate[] {
  return waitingHandSteps({ steps }).map((step) => ({
    ask: undefined,
    fact: handFact({ checkedIso, passes, step }),
    floorIso: step.postedIso,
    key: `hand:${step.id}`,
    row: step.row,
  }));
}

/**
 * One hand step's facts. A `mon-` step whose monitor this build no longer defines is a monitor's card all the same,
 * so the register still holding it never confirms it — no pass of a removed monitor can.
 *
 * @param checkedIso when the register was read
 * @param passes each monitor's last pass
 * @returns the facts
 */
function handFact({
  step,
  checkedIso,
  passes,
}: {
  step: HandStep;
  checkedIso: string;
  passes: ReadonlyMap<MonitorId, RecordedMonitorPass>;
}): CurrencyFact {
  const monitorId = monitorOfStep({ stepId: step.id });
  if (monitorId !== undefined) {
    return monitorFact({ monitorId, pass: passes.get(monitorId), step });
  }
  if (step.id.startsWith(MONITOR_STEP_PREFIX)) {
    return { kind: "not-confirmed", why: "no monitor this build defines posts it, so no pass can re-confirm it" };
  }
  return { atIso: checkedIso, by: "the hand register still holding it", kind: "confirmed" };
}

/**
 * The later of two optional instants, the earlier one on a tie — an ask's floor. `site/lib/askVerified.ts` restates
 * it, because the console cannot import it.
 *
 * @returns the later one, either when only one is present, `undefined` when neither is
 */
export function askFloorOf({
  left,
  right,
}: {
  left: string | undefined;
  right: string | undefined;
}): string | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Date.parse(right) > Date.parse(left) ? right : left;
}

/**
 * An ask's facts: the later of its still-real check and a read of its thread that found no reply from the owner.
 *
 * @param done what its done-check found
 * @returns the facts
 */
function askFact({ ask, done }: { ask: CurrencyAsk; done: CurrencyDone }): CurrencyFact {
  const stillReal =
    ask.stillRealIso === undefined ? undefined : { atIso: ask.stillRealIso, by: "its still-real check" };
  const threadRead =
    done.kind === "not-yet" ? { atIso: done.readAtIso, by: "a read of its Slack thread finding no reply" } : undefined;
  const latest = [stillReal, threadRead]
    .filter((one) => one !== undefined)
    .toSorted((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso))[0];
  if (latest !== undefined) {
    return { ...latest, kind: "confirmed" };
  }
  // The read's own reason stays on `done`, which reaches only the card's staleness mark, never its Facts line.
  if (done.kind === "could-not-check") {
    return { kind: "not-confirmed", why: "its Slack thread could not be read" };
  }
  return { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" };
}

/**
 * One ask waiting on the owner, as a card.
 *
 * @param done what its done-check found
 * @returns the card
 */
export function askCurrencyCard({ ask, done }: { ask: CurrencyAsk; done: CurrencyDone }): CurrencyCardCandidate {
  return {
    ask,
    fact: askFact({ ask, done }),
    floorIso: askFloorOf({ left: ask.askedIso, right: ask.stillRealIso }),
    key: `ask:${ask.slug}`,
    row: ask.slug,
  };
}

/**
 * Every pull request the landing reading holds, as a card — every row rather than the console's own selection of the
 * ones that need the owner, so the two never have to agree on that selection: a row the console draws no card for is a
 * reading nothing joins.
 *
 * @param document the recorded `github landing --json` document
 * @param observedAtIso when that poll was observed
 * @returns the cards, or why the document is not one this reads
 */
export function landingCurrencyCards({
  document,
  observedAtIso,
}: {
  document: unknown;
  observedAtIso: string;
}): { kind: "read"; cards: CurrencyCardCandidate[] } | { kind: "unreadable"; why: string } {
  const rows = bagOf({ value: document })?.["rows"];
  if (!Array.isArray(rows)) {
    return { kind: "unreadable", why: "the last landing reading carries no rows" };
  }
  const cards: CurrencyCardCandidate[] = [];
  for (const row of rows) {
    const bag = bagOf({ value: row });
    const number = bag?.["number"];
    const repoSlug = bag?.["repoSlug"];
    const updatedAtIso = bag?.["updatedAtIso"];
    // Any string, as the console's landing reader takes it: the floor is matched to the card byte for byte, and one
    // that does not parse is the row's own gap (`currencyRowOf`), never a reason to drop the card.
    if (typeof number !== "number" || typeof updatedAtIso !== "string" || typeof repoSlug !== "string") {
      return { kind: "unreadable", why: "a row of the last landing reading carries no number, repository or instant" };
    }
    // Keyed as the console keys it, repository and number (`../talk/prCardKey.ts`); a slug that keys no pull request
    // would make a card the console never draws, so the reading is not one this reads.
    const key = prCardKey({ number, repoSlug });
    if (prCardKeyParts({ key })?.repoSlug !== repoSlug) {
      return {
        kind: "unreadable",
        why: `a row of the last landing reading names no pull request: ${repoSlug}#${String(number)}`,
      };
    }
    cards.push({
      ask: undefined,
      fact: { atIso: observedAtIso, by: "the last landing poll", kind: "confirmed" },
      floorIso: updatedAtIso,
      key,
      row: undefined,
    });
  }
  return { cards, kind: "read" };
}
