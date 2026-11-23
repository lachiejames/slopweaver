/**
 * The ceilings reading under a per-plan usage limit — a plan at the limit set on it grades as at its usage limit
 * (never refusing), a monthly-spend allowance grades as not measured, and an open window's headroom is measured
 * against the limit rather than against the whole window.
 */
import { describe, expect, it } from "vitest";

import { admissionOf } from "../../../capacity/admission.js";
import { buildCeilingsReading } from "../../../capacity/ceilings.js";
import { CODEX_MONTHLY_SPEND_NOT_MEASURED } from "../../../plans/usageLimit.js";
import { claude, codex, machine, NOW, plans } from "./ceilingsFixtures.js";

describe("buildCeilingsReading, per-plan usage limits", () => {
  it("grades a Codex usage-limit exclusion as at its usage limit, and a monthly one as unread, never refusing", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        codex: [
          {
            ...codex({ alias: "codex-one", usageLimitPercent: 30, used: 30 }),
            exclusion: { kind: "usage-limit", reason: "weekly window at 30% used, at this plan's 30% usage limit" },
          },
          {
            ...codex({ alias: "codex-two", used: 5 }),
            exclusion: { kind: "not-measured", reason: "the router's own words" },
          },
        ],
      }),
    });

    expect(reading.ceilings.slice(1)).toStrictEqual([
      {
        account: "codex-one@example.test",
        freeResets: null,
        headroom: 0,
        id: "codex:codex-one",
        kind: "codex",
        reason: "weekly window at 30% used, at this plan's 30% usage limit",
        status: "at-usage-limit",
        windows: [{ available: 30, resetAtIso: "2026-10-03T00:00:00.000Z", used: 30, window: "weekly" }],
      },
      {
        account: "codex-two@example.test",
        freeResets: null,
        headroom: null,
        id: "codex:codex-two",
        kind: "codex",
        reason: CODEX_MONTHLY_SPEND_NOT_MEASURED,
        status: "unreadable",
        windows: [{ available: 100, resetAtIso: "2026-10-03T00:00:00.000Z", used: 5, window: "weekly" }],
      },
    ]);
    expect(reading.routes).toStrictEqual([]);
  });

  it("caps admission when the only other plan is monthly spend, but not when it is merely unread", () => {
    const atLimit = {
      ...codex({ alias: "codex-one", usageLimitPercent: 30, used: 30 }),
      exclusion: { kind: "usage-limit", reason: "weekly window at 30% used, at this plan's 30% usage limit" },
    };
    const monthly = { ...codex({ alias: "codex-two", used: 5 }), exclusion: { kind: "not-measured", reason: "x" } };
    const unread = { ...codex({ alias: "codex-two", used: 5 }), windows: null };
    const admitted = [monthly, unread].map((other) =>
      admissionOf({
        reading: buildCeilingsReading({
          machine: machine(),
          observedAtIso: NOW,
          plans: plans({ codex: [atLimit, other] }),
        }),
      }),
    );

    expect(admitted).toStrictEqual([
      { binding: "codex:codex-one", kind: "capped" },
      { binding: "machine", kind: "free" },
    ]);
  });

  it("measures an open Codex weekly window against its usage limit", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        codex: [codex({ alias: "codex-one", usageLimitPercent: 40, used: 30 })],
        codexRoutedAlias: "codex-one",
      }),
    });

    // 1 − 30 / 40 = 0.25, never 1 − 30 / 100.
    expect(reading.ceilings[1]!.headroom).toBe(0.25);
  });

  // Rounded to nearest, a raw 29.9999999 read 30.00 against a 30% limit, so a
  // window the router still takes read zero headroom and admitted nothing.
  it("never rounds a weekly window just under its usage limit up onto it", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        codex: [codex({ alias: "codex-one", usageLimitPercent: 30, used: 29.9999999 })],
        codexRoutedAlias: "codex-one",
      }),
    });

    expect(reading.ceilings[1]!.windows).toStrictEqual([
      { available: 30, resetAtIso: "2026-10-03T00:00:00.000Z", used: 29.99, window: "weekly" },
    ]);
    // 1 − 29.99 / 30, to four decimals.
    expect(reading.ceilings[1]!.headroom).toBe(0.0003);
  });

  it("grades a Claude plan at the usage limit set on it as at its usage limit, not refusing", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [
          claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.3, usageLimitPercent: 30 }),
          claude({ alias: "plan-two", fiveHour: 0.05, sevenDay: 0.3, usageLimitPercent: 40 }),
        ],
      }),
    });

    expect(reading.ceilings.slice(1)).toStrictEqual([
      {
        account: "plan-one@example.test",
        freeResets: null,
        headroom: 0,
        id: "claude:plan-one",
        kind: "claude",
        reason: "seven_day at 30%, at its usage limit of 30%",
        status: "at-usage-limit",
        windows: [
          { available: 100, resetAtIso: "2026-10-01T00:00:00.000Z", used: 10, window: "five-hour" },
          { available: 30, resetAtIso: "2026-10-01T00:00:00.000Z", used: 30, window: "seven-day" },
        ],
      },
      {
        account: "plan-two@example.test",
        freeResets: null,
        // The tighter of five-hour 1 − 5/100 = 0.95 and seven-day 1 − 30/40 = 0.25.
        headroom: 0.25,
        id: "claude:plan-two",
        kind: "claude",
        reason: null,
        status: "open",
        windows: [
          { available: 100, resetAtIso: "2026-10-01T00:00:00.000Z", used: 5, window: "five-hour" },
          { available: 40, resetAtIso: "2026-10-01T00:00:00.000Z", used: 30, window: "seven-day" },
        ],
      },
    ]);
    expect(reading.lowest).toBe("claude:plan-two");
  });
});
