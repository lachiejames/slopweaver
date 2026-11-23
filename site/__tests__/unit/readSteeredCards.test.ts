/*
 * The console's reader of the `talk steers` reading: it takes the verb's document whole or refuses it, so a steer is
 * never forgotten on a payload that did not read. Split from `./steeredCards.test.ts` by describe block.
 */
import { describe, expect, it } from "vitest";

import { readSteeredCards } from "../../components/live/readSteeredCards";

const TURN = "ed674c0e-d0f9-49da-8764-42c1b8fce1e6";
const SLUG = "talk-ed674c0ed0f9";
const CARD = "pr:acme.widgets.1779";
const OTHER = "pr:acme.widgets.1780";
const SENT = "2026-10-04T00:36:58.000Z";
/** The window start every reading here carries: well before the owner spoke. */
const SINCE = "2026-09-27T00:36:58.000Z";

describe("readSteeredCards", () => {
  it("refuses a reading that does not say how many relay lines did not decode", () => {
    expect(readSteeredCards({ observedAtIso: SENT, ok: true, sinceIso: SINCE, steers: [] })).toBe(undefined);
  });

  it("refuses the whole reading when one steer's verdict does not read", () => {
    const steers = [
      { cardKey: CARD, heard: "x", registeredAtIso: SENT, relaySlug: SLUG, turnId: TURN, verdict: { kind: "maybe" } },
    ];
    expect(readSteeredCards({ observedAtIso: SENT, ok: true, sinceIso: SINCE, steers, undecodedRelays: 0 })).toBe(
      undefined,
    );
  });

  it("refuses a reading not marked ok, never forgetting a steer on a refusal's payload", () => {
    const reading = { observedAtIso: SENT, sinceIso: SINCE, steers: [], undecodedRelays: 0 };
    expect(readSteeredCards({ ...reading, ok: false })).toBe(undefined);
    expect(readSteeredCards(reading)).toBe(undefined);
    expect(readSteeredCards({ ...reading, ok: true })!.sinceIso).toBe(SINCE);
  });

  it("refuses a reading or a steer carrying a key the verb never emits", () => {
    const one = { cardKey: CARD, heard: "x", registeredAtIso: SENT, relaySlug: SLUG, turnId: TURN };
    const settled = { ...one, verdict: { action: { kind: "settlement" }, kind: "settled" } };
    const reading = { observedAtIso: SENT, ok: true, sinceIso: SINCE, undecodedRelays: 0 };
    expect(readSteeredCards({ ...reading, steers: [{ ...settled, extra: true }] })).toBe(undefined);
    expect(readSteeredCards({ ...reading, extra: true, steers: [settled] })).toBe(undefined);
    expect(readSteeredCards({ ok: true, sinceIso: SINCE, steers: [], undecodedRelays: 0 })).toBe(undefined);
    expect(readSteeredCards({ ...reading, observedAtIso: "not-a-date", steers: [] })).toBe(undefined);
    expect(readSteeredCards({ ...reading, steers: [settled] })!.steers.length).toBe(1);
  });

  it("refuses a reading carrying one turn and card twice, never picking a verdict by order", () => {
    const one = { cardKey: CARD, heard: "x", registeredAtIso: SENT, relaySlug: SLUG, turnId: TURN };
    const awaiting = { ...one, verdict: { kind: "awaiting" } };
    const kept = { ...one, verdict: { kind: "reverted", reason: "kept", why: "answered in thread" } };
    const reading = { observedAtIso: SENT, ok: true, sinceIso: SINCE, undecodedRelays: 0 };
    expect(readSteeredCards({ ...reading, steers: [awaiting, kept] })).toBe(undefined);
    expect(readSteeredCards({ ...reading, steers: [awaiting, { ...kept, cardKey: OTHER }] })!.steers.length).toBe(2);
  });

  /** A reading of one steer carrying `verdict`. */
  const readOne = ({ verdict }: { verdict: Record<string, unknown> }) =>
    readSteeredCards({
      observedAtIso: SENT,
      ok: true,
      sinceIso: SINCE,
      steers: [{ cardKey: CARD, heard: "x", registeredAtIso: SENT, relaySlug: SLUG, turnId: TURN, verdict }],
      undecodedRelays: 0,
    });

  it("refuses a settled verdict whose action is delivery, never forgetting a steer on it", () => {
    expect(readOne({ verdict: { action: { kind: "delivery" }, kind: "settled" } })).toBe(undefined);
    expect(readOne({ verdict: { action: { kind: "settlement" }, kind: "settled" } })!.steers[0].verdict).toEqual({
      action: "settlement",
      kind: "settled",
    });
  });

  it("refuses a settled action missing a field its kind carries, never forgetting a steer on it", () => {
    const mark = { atIso: SENT, kind: "intake-mark", markKind: "card", witness: "ask:a-steer" };
    expect(readOne({ verdict: { action: { kind: "intake-mark" }, kind: "settled" } })).toBe(undefined);
    expect(readOne({ verdict: { action: { ...mark, witness: 7 }, kind: "settled" } })).toBe(undefined);
    expect(
      readOne({ verdict: { action: { ...mark, atIso: "not-a-date" }, kind: "settled" } })!.steers[0].verdict,
    ).toEqual({ action: "intake-mark", kind: "settled" });
    expect(readOne({ verdict: { action: { atIso: SENT, kind: "run-event" }, kind: "settled" } })).toBe(undefined);
    expect(readOne({ verdict: { action: { kind: "check-in-ruling" }, kind: "settled" } })).toBe(undefined);
    expect(readOne({ verdict: { action: { atIso: 42, kind: "settlement" }, kind: "settled" } })).toBe(undefined);
    expect(readOne({ verdict: { action: { ...mark, extra: "x" }, kind: "settled" } })).toBe(undefined);
    expect(readOne({ verdict: { kind: "awaiting", why: 42 } })).toBe(undefined);
    expect(readOne({ verdict: { action: mark, kind: "settled", why: "x" } })).toBe(undefined);
    const ran = { atIso: SENT, eventKind: "dispatched", kind: "run-event" };
    expect(readOne({ verdict: { action: ran, kind: "settled" } })!.steers[0].verdict).toEqual({
      action: "run-event",
      kind: "settled",
    });
    expect(readOne({ verdict: { action: mark, kind: "settled" } })!.steers[0].verdict).toEqual({
      action: "intake-mark",
      kind: "settled",
    });
  });

  it("refuses a missed-pass revert whose pass instant is absent or does not parse, never re-opening on it", () => {
    const missed = { kind: "reverted", reason: "missed-pass" };
    expect(readOne({ verdict: missed })).toBe(undefined);
    expect(readOne({ verdict: { ...missed, passFinalisedIso: "not-a-date" } })).toBe(undefined);
    expect(
      readOne({ verdict: { ...missed, passFinalisedIso: "2026-10-04T00:39:00.000Z" } })!.steers[0].verdict,
    ).toEqual({
      kind: "reverted",
      passFinalisedIso: "2026-10-04T00:39:00.000Z",
      reason: "missed-pass",
      why: undefined,
    });
  });

  it("reads a revert only in the exact shape the verb writes for its reason, never re-opening without it", () => {
    const kept = { kind: "reverted", reason: "kept" };
    expect(readOne({ verdict: kept })).toBe(undefined);
    expect(readOne({ verdict: { ...kept, why: 42 } })).toBe(undefined);
    expect(readOne({ verdict: { ...kept, why: null } })).toBe(undefined);
    expect(readOne({ verdict: { ...kept, passFinalisedIso: SENT, why: "x" } })).toBe(undefined);
    expect(readOne({ verdict: { kind: "reverted", reason: "restored" } })).toBe(undefined);
    expect(readOne({ verdict: { kind: "reverted", reason: "chair-down", why: "x" } })).toBe(undefined);
    expect(readOne({ verdict: { kind: "reverted", passFinalisedIso: SENT, reason: "missed-pass", why: "x" } })).toBe(
      undefined,
    );
    expect(readOne({ verdict: { kind: "reverted", reason: "landing-missing" } })!.steers[0].verdict).toEqual({
      kind: "reverted",
      passFinalisedIso: undefined,
      reason: "landing-missing",
      why: undefined,
    });
    expect(readOne({ verdict: { ...kept, why: "the owner wants it kept" } })!.steers[0].verdict).toEqual({
      kind: "reverted",
      passFinalisedIso: undefined,
      reason: "kept",
      why: "the owner wants it kept",
    });
  });

  it("refuses a window start that does not parse, never reading an unlisted steer as unrecorded", () => {
    const reading = { observedAtIso: SENT, ok: true, steers: [], undecodedRelays: 0 };
    expect(readSteeredCards({ ...reading, sinceIso: "not-a-date" })).toBe(undefined);
    expect(readSteeredCards({ ...reading, sinceIso: SINCE })!.sinceIso).toBe(SINCE);
  });

  it("refuses an undecoded count that is no count, never reading an unlisted steer as unrecorded", () => {
    const reading = { observedAtIso: SENT, ok: true, sinceIso: SINCE, steers: [] };
    expect(readSteeredCards({ ...reading, undecodedRelays: -1 })).toBe(undefined);
    expect(readSteeredCards({ ...reading, undecodedRelays: 1.5 })).toBe(undefined);
    expect(readSteeredCards({ ...reading, undecodedRelays: 2 })!.undecodedRelays).toBe(2);
  });

  it("reads a steer whose registration does not parse as unread, never as the revert beside it", () => {
    const chairDown = {
      cardKey: CARD,
      heard: "x",
      relaySlug: SLUG,
      turnId: TURN,
      verdict: { kind: "reverted", reason: "chair-down" },
    };
    const reading = { observedAtIso: SENT, ok: true, sinceIso: SINCE, undecodedRelays: 0 };
    expect(
      readSteeredCards({ ...reading, steers: [{ ...chairDown, registeredAtIso: "not-a-date" }] })!.steers[0].verdict,
    ).toEqual({
      kind: "unread",
      why: "its registration time not-a-date does not parse",
    });
    expect(
      readSteeredCards({ ...reading, steers: [{ ...chairDown, registeredAtIso: SENT }] })!.steers[0].verdict.kind,
    ).toBe("reverted");
  });
});
