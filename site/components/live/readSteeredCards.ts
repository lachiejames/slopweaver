/**
 * The reader for `talk steers --json` — what became of each steer the owner spoke over a Queue card
 * (`src/talk/steeredCards.ts`).
 *
 * A sibling of `./readCardLandings.ts`, and strict for the same reason: the reading decides whether a collapsed card
 * comes back, so a steer that does not read refuses the whole reading rather than being skipped — a skipped steer is
 * one whose card would stay collapsed on a verdict nobody read.
 */

import { type Bag, bags, isBag, num, str } from "../../lib/bag";

/** Why a steer the page collapsed is back on the Queue, as the verb spells it. */
export type ServerRevertReason = "kept" | "restored" | "landing-missing" | "missed-pass" | "chair-down";

/** What became of one steer, as the verb judged it. */
export type ServerSteerVerdict =
  | { readonly kind: "awaiting" }
  | { readonly kind: "settled"; readonly action: string }
  | {
      readonly kind: "reverted";
      readonly reason: ServerRevertReason;
      readonly why: string | undefined;
      readonly passFinalisedIso: string | undefined;
    }
  | { readonly kind: "unread"; readonly why: string };

/** One steer the verb reports. */
export interface ServerSteer {
  readonly turnId: string;
  readonly relaySlug: string;
  readonly cardKey: string;
  readonly heard: string;
  readonly registeredAtIso: string;
  readonly verdict: ServerSteerVerdict;
}

/** The whole reading. */
export interface SteeredCardsReading {
  /** The oldest registration the verb judged: a steer sent before it is out of the window, not unrecorded. */
  readonly sinceIso: string;
  readonly steers: readonly ServerSteer[];
  /** Relay-ledger lines that did not decode, so a steer missing from `steers` may be one of them. */
  readonly undecodedRelays: number;
}

const REVERT_REASONS: ReadonlySet<string> = new Set<ServerRevertReason>([
  "kept",
  "restored",
  "landing-missing",
  "missed-pass",
  "chair-down",
]);

/**
 * The action kinds the verb settles on, each with the string fields its `SteerAction` variant requires
 * (`src/talk/steeredCards.ts`) and no other; delivery is never one, so any other kind, a missing field or a key the
 * verb never emits refuses.
 */
const ACTION_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["intake-mark", ["atIso", "markKind", "witness"]],
  ["check-in-ruling", ["atIso"]],
  ["settlement", []],
  ["run-event", ["atIso", "eventKind"]],
]);

/** The keys the verb's reading carries (`src/cli/commands/talk/steersRun.ts`), and no other. */
const READING_KEYS: readonly string[] = ["observedAtIso", "ok", "sinceIso", "steers", "undecodedRelays"];

/** The keys each steer in it carries (`src/talk/steeredCardsRead.ts`), and no other. */
const STEER_KEYS: readonly string[] = ["cardKey", "heard", "registeredAtIso", "relaySlug", "turnId", "verdict"];

/** The keys each verdict kind may carry; the verb emits no other, so any other refuses the reading. */
const VERDICT_KEYS: ReadonlyMap<string, readonly string[]> = new Map([
  ["awaiting", ["kind"]],
  ["settled", ["kind", "action"]],
  ["unread", ["kind", "why"]],
  ["reverted", ["kind", "reason", "why", "passFinalisedIso"]],
]);

/** The string fields `steerVerdict` writes on a revert, per reason (`src/talk/steeredCards.ts`), and no other. */
const REVERT_FIELDS: Readonly<Record<ServerRevertReason, readonly string[]>> = {
  "chair-down": [],
  kept: ["why"],
  "landing-missing": [],
  "missed-pass": ["passFinalisedIso"],
  restored: ["why"],
};

/**
 * Whether an object carries no key outside the ones allowed.
 *
 * @returns true when every key is allowed
 */
function onlyKeys({ bag, allowed }: { bag: Bag; allowed: readonly string[] }): boolean {
  return Object.keys(bag).every((key) => allowed.includes(key));
}

/** Whether a string is a reason the verb spells. */
function isRevertReason(value: unknown): value is ServerRevertReason {
  return typeof value === "string" && REVERT_REASONS.has(value);
}

/**
 * Project one verdict.
 *
 * @param bag the verdict object
 * @returns the verdict, or `undefined` when it does not read
 */
function verdictOf({ bag }: { bag: unknown }): ServerSteerVerdict | undefined {
  if (!isBag(bag)) {
    return undefined;
  }
  const kind = str({ bag, key: "kind" });
  if (kind === undefined) {
    return undefined;
  }
  const allowed = VERDICT_KEYS.get(kind);
  if (allowed === undefined || !onlyKeys({ allowed, bag })) {
    return undefined;
  }
  if (kind === "awaiting") {
    return { kind };
  }
  if (kind === "settled") {
    const action = bag["action"];
    if (!isBag(action)) {
      return undefined;
    }
    const actionKind = str({ bag: action, key: "kind" });
    if (actionKind === undefined) {
      return undefined;
    }
    const fields = ACTION_FIELDS.get(actionKind);
    if (
      fields === undefined ||
      !onlyKeys({ allowed: ["kind", ...fields], bag: action }) ||
      fields.some((key) => str({ bag: action, key }) === undefined)
    ) {
      return undefined;
    }
    // An action's instant is only ever carried, never judged on: the verb passes an intake mark's or a ruling's through
    // as written, so one that does not parse is still the action it names, and reading it otherwise would disagree.
    return { action: actionKind, kind };
  }
  if (kind === "unread") {
    const why = str({ bag, key: "why" });
    return why === undefined ? undefined : { kind, why };
  }
  const reason = bag["reason"];
  if (kind !== "reverted" || !isRevertReason(reason)) {
    return undefined;
  }
  // Each reason carries exactly the fields the verb writes for it, as strings, and no other.
  const fields = REVERT_FIELDS[reason];
  if (
    !onlyKeys({ allowed: ["kind", "reason", ...fields], bag }) ||
    fields.some((key) => str({ bag, key }) === undefined)
  ) {
    return undefined;
  }
  // A pass instant that does not parse dates the revert against nothing, so it refuses rather than re-opens.
  const passFinalisedIso = str({ bag, key: "passFinalisedIso" });
  if (passFinalisedIso !== undefined && Number.isNaN(Date.parse(passFinalisedIso))) {
    return undefined;
  }
  return { kind, passFinalisedIso, reason, why: str({ bag, key: "why" }) };
}

/**
 * Project `talk steers --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the reading, or `undefined` when the payload or any steer in it does not read
 */
export function readSteeredCards(payload: unknown): SteeredCardsReading | undefined {
  // The verb's refusal carries only a code and a reason, so a reading not marked ok is never one; and
  // like a verdict, the reading and each steer in it are read as the exact shape the verb emits.
  if (!isBag(payload) || payload["ok"] !== true || !onlyKeys({ allowed: READING_KEYS, bag: payload })) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "steers" });
  const undecodedRelays = num({ bag: payload, key: "undecodedRelays" });
  const sinceIso = str({ bag: payload, key: "sinceIso" });
  // A window start that does not parse would read every unlisted steer as unrecorded, so it refuses.
  if (rows === undefined || undecodedRelays === undefined || sinceIso === undefined || !parses({ iso: sinceIso })) {
    return undefined;
  }
  // The verb always says when it observed; a reading without that instant is not one it emitted.
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  if (observedAtIso === undefined || !parses({ iso: observedAtIso })) {
    return undefined;
  }
  // A count that is no count would read an unlisted steer as unrecorded rather than a hiccup, so it refuses.
  if (!Number.isInteger(undecodedRelays) || undecodedRelays < 0) {
    return undefined;
  }
  const steers: ServerSteer[] = [];
  // The verb keeps one steer per turn and card, so a second is malformed: which one the page read would be order.
  const seen = new Set<string>();
  for (const row of rows) {
    const turnId = str({ bag: row, key: "turnId" });
    const relaySlug = str({ bag: row, key: "relaySlug" });
    const cardKey = str({ bag: row, key: "cardKey" });
    const heard = str({ bag: row, key: "heard" });
    const registeredAtIso = str({ bag: row, key: "registeredAtIso" });
    const verdict = verdictOf({ bag: row["verdict"] });
    if (
      turnId === undefined ||
      relaySlug === undefined ||
      cardKey === undefined ||
      heard === undefined ||
      registeredAtIso === undefined ||
      verdict === undefined ||
      !onlyKeys({ allowed: STEER_KEYS, bag: row }) ||
      seen.has(`${turnId} ${cardKey}`)
    ) {
      return undefined;
    }
    seen.add(`${turnId} ${cardKey}`);
    // A registration that does not parse dates the verdict against nothing: this steer is unread, never reverted.
    const judged: ServerSteerVerdict = parses({ iso: registeredAtIso })
      ? verdict
      : { kind: "unread", why: `its registration time ${registeredAtIso} does not parse` };
    steers.push({ cardKey, heard, registeredAtIso, relaySlug, turnId, verdict: judged });
  }
  return { sinceIso, steers, undecodedRelays };
}

/** Whether a string is an instant `Date.parse` reads. */
function parses({ iso }: { iso: string }): boolean {
  return !Number.isNaN(Date.parse(iso));
}
