/*
 * A register with no first answer within its own route timeout is named unread on the page: never an endless spinner,
 * never counted as a measured zero.
 */

import { describe, expect, it } from "vitest";

import { boundedFreshnessOf } from "../../components/console/useQueueRowsReading";
import { boundedFirstRead, emptyListDraw, queueFreshness, type RegisterFreshness } from "../../lib/registerFreshness";

const AT = "2026-10-04T11:00:00.000Z";

const loading = ({ label }: { label: string }): RegisterFreshness => ({
  drawn: { phase: "loading" },
  label,
  read: { phase: "loading" },
});

const handedOver = ({ label }: { label: string }): RegisterFreshness => ({
  drawn: { observedAtIso: AT, phase: "ready", refreshing: true },
  label,
  read: { phase: "ready" },
});

const answered = ({ label }: { label: string }): RegisterFreshness => ({
  drawn: { observedAtIso: AT, phase: "ready", refreshing: false },
  label,
  read: { phase: "ready" },
});

const NONE = queueFreshness({ registers: [] });

describe("boundedFirstRead", () => {
  it("leaves a register inside its bound in flight", () => {
    const register = loading({ label: "held replies" });
    expect(boundedFirstRead({ boundMs: 20_000, register, waitedMs: 19_999 })).toBe(register);
  });

  it("names a register with nothing drawn as failed once its bound passes, so the empty list draws no zero", () => {
    const bounded = boundedFirstRead({
      boundMs: 20_000,
      register: loading({ label: "held replies" }),
      waitedMs: 20_000,
    });
    const freshness = queueFreshness({ registers: [bounded, answered({ label: "your hands" })] });
    expect([freshness.reading, freshness.failed]).toEqual([
      [],
      [{ label: "held replies", why: "its first read had not answered 20s after the page opened" }],
    ]);
    expect(emptyListDraw({ answered: 1, deciders: NONE, expected: 2, freshness, overlays: NONE })).toEqual({
      facts: [{ subject: "held replies", why: "its first read had not answered 20s after the page opened" }],
      kind: "stale",
    });
  });

  it("names a reading handed over from earlier as stale once its bound passes, with when that reading was true", () => {
    const bounded = boundedFirstRead({
      boundMs: 90_000,
      register: handedOver({ label: "recorded asks" }),
      waitedMs: 90_001,
    });
    const freshness = queueFreshness({ registers: [bounded] });
    expect([freshness.rereading, freshness.stale]).toEqual([
      [],
      [{ label: "recorded asks", observedAtIso: AT, why: "its first read had not answered 90s after the page opened" }],
    ]);
  });

  it("leaves a register that answered on this page untouched, however long the page has been open", () => {
    const register = answered({ label: "your hands" });
    expect(boundedFirstRead({ boundMs: 20_000, register, waitedMs: 600_000 })).toBe(register);
  });

  it("holds each reading to its own verb's bound: twenty seconds in, held replies are unread while the board still reads", () => {
    const freshness = boundedFreshnessOf({
      readings: [
        { drawn: { phase: "loading" }, label: "recorded asks", slug: "board" },
        { drawn: { phase: "loading" }, label: "held replies", slug: "drafts" },
      ],
      waitedMs: 20_000,
    });
    expect([freshness.reading, freshness.failed.map((gap) => gap.label)]).toEqual([
      ["recorded asks"],
      ["held replies"],
    ]);
  });

  it("holds a decider still on its first read past its bound as a stale fact on the empty list, never a zero", () => {
    const decider = boundedFirstRead({
      boundMs: 20_000,
      register: loading({ label: "the steers you gave that are still being relayed" }),
      waitedMs: 30_000,
    });
    const draw = emptyListDraw({
      answered: 1,
      deciders: queueFreshness({ registers: [decider] }),
      expected: 1,
      freshness: queueFreshness({ registers: [answered({ label: "your hands" })] }),
      overlays: NONE,
    });
    expect(draw).toEqual({
      facts: [
        {
          subject: "the steers you gave that are still being relayed",
          why: "its first read had not answered 20s after the page opened, and it can move a card onto or off this list",
        },
      ],
      kind: "stale",
    });
  });
});
