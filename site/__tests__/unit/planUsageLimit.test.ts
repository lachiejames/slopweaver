/*
 * Why routing stopped on a plan when the usage limit is why, and the raise press beside it: the words never say
 * "capped", the next step is read off the weekly window's available share, and a plan nothing measures offers no
 * raise. The two lists the site restates from `src/` are held equal to it here.
 */
import { describe, expect, it } from "vitest";

import {
  CODEX_MONTHLY_SPEND_NOT_MEASURED as SOURCE_NOT_MEASURED,
  MONTHLY_SPEND_REASON_PREFIX as SOURCE_REASON_PREFIX,
  USAGE_LIMIT_PERCENTS,
} from "../../../src/plans/usageLimit";
import { actVerbFor, buildActArgv } from "../../lib/actVerbs";
import type { GlancePlan, GlanceWindow } from "../../lib/fleetGlancePlans";
import type { LiveState } from "../../lib/liveState";
import { planRowOf } from "../../lib/planMetersRails";
import {
  CODEX_MONTHLY_SPEND_NOT_MEASURED,
  MONTHLY_SPEND_REASON_PREFIX,
  nextUsageLimitStep,
  RAISE_USAGE_LIMIT_SLUG,
  raiseButtonHeldOf,
  raiseHeldOf,
  raisePressedHeldOf,
  raiseRecordedHeldOf,
  USAGE_LIMIT_STEPS,
  usageLimitStopOf,
} from "../../lib/planUsageLimit";

/** The reading's own instant. */
const NOW_MS = Date.parse("2026-11-04T02:00:00.000Z");

/** A window as the capacity reading carries it. */
function window({ name, used, available }: { name: string; used: number; available: number }): GlanceWindow {
  return { available, resetAtIso: "2026-11-07T00:00:00.000Z", used, window: name };
}

/** One plan's ceiling, open with no windows unless the case says otherwise. */
function plan(over: Partial<GlancePlan>): GlancePlan {
  return {
    account: "plan-one@example.com",
    freeResets: null,
    id: "claude:plan-one",
    pause: undefined,
    provider: "claude",
    reason: undefined,
    status: "open",
    windows: [],
    ...over,
  };
}

/** A Claude plan stopped at a 30% limit with its week at 30 of 30. */
const CLAUDE_AT_30 = plan({
  reason: "seven-day at 30% of its 30% share, at its usage limit of 30%",
  status: "at-usage-limit",
  windows: [
    window({ available: 100, name: "five-hour", used: 12 }),
    window({ available: 30, name: "seven-day", used: 30 }),
    window({ available: 30, name: "fable-seven-day", used: 4 }),
  ],
});

describe("the two lists the site restates from src", () => {
  it("holds the ten steps and the not-measured sentence equal to src/plans/usageLimit.ts", () => {
    expect([USAGE_LIMIT_STEPS, CODEX_MONTHLY_SPEND_NOT_MEASURED, MONTHLY_SPEND_REASON_PREFIX]).toEqual([
      [...USAGE_LIMIT_PERCENTS],
      SOURCE_NOT_MEASURED,
      SOURCE_REASON_PREFIX,
    ]);
  });
});

describe("nextUsageLimitStep", () => {
  it("is one step up, and nothing at the whole week or off the steps", () => {
    expect([10, 30, 90, 100, 35, 0].map((percent) => nextUsageLimitStep({ percent }))).toEqual([
      20,
      40,
      100,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("usageLimitStopOf", () => {
  it("offers a Claude plan at 30% the raise to 40%, from 30, read off its seven-day window and never the Fable week", () => {
    expect(usageLimitStopOf({ plan: CLAUDE_AT_30 })).toEqual({
      kind: "raise",
      label: "Raise the usage limit to 40% and continue",
      limitPercent: 30,
      nextPercent: 40,
      slots: { from: "30", percent: "40", plan: "plan-one", provider: "claude" },
      words: "stopped at your usage limit of 30% of its week (your own setting, not the provider's)",
    });
  });

  it("still offers the raise when only the Fable week is past the next step, and says Fable work stays stopped", () => {
    const fableFull = plan({
      status: "at-usage-limit",
      windows: [
        window({ available: 30, name: "seven-day", used: 30 }),
        window({ available: 30, name: "fable-seven-day", used: 45 }),
      ],
    });
    expect(usageLimitStopOf({ plan: fableFull })).toMatchObject({
      kind: "raise",
      nextPercent: 40,
      words:
        "stopped at your usage limit of 30% of its week (your own setting, not the provider's); its Fable week has " +
        "already used 45%, so Fable work stays stopped at 40%",
    });
  });

  it("still offers the raise when the five-hour window is full too, and says it continues once that resets", () => {
    const fiveHourFull = plan({
      status: "at-usage-limit",
      windows: [
        window({ available: 100, name: "five-hour", used: 100 }),
        window({ available: 30, name: "seven-day", used: 30 }),
      ],
    });
    expect(usageLimitStopOf({ plan: fiveHourFull })).toMatchObject({
      kind: "raise",
      nextPercent: 40,
      words:
        "stopped at your usage limit of 30% of its week (your own setting, not the provider's); its five-hour " +
        "window is full too, so it continues once that resets",
    });
  });

  it("offers no raise when the Fable week carries a different limit from the seven-day week", () => {
    const split = plan({
      status: "at-usage-limit",
      windows: [
        window({ available: 30, name: "seven-day", used: 30 }),
        window({ available: 40, name: "fable-seven-day", used: 4 }),
      ],
    });
    expect(usageLimitStopOf({ plan: split })).toEqual({
      kind: "no-raise",
      words:
        "stopped at your usage limit (your own setting, not the provider's), but this reading carried weekly " +
        "windows at different limits, so there is no one limit to raise from here",
    });
  });

  it("reads a Codex plan's limit off its weekly window and names the bare alias", () => {
    const codex = plan({
      id: "codex:codex-two",
      provider: "codex",
      status: "at-usage-limit",
      windows: [
        window({ available: 100, name: "five-hour", used: 3 }),
        window({ available: 50, name: "weekly", used: 50 }),
      ],
    });
    expect(usageLimitStopOf({ plan: codex })).toMatchObject({
      kind: "raise",
      slots: { from: "50", percent: "60", plan: "codex-two", provider: "codex" },
    });
  });

  it("offers no raise when the week's use already reaches the next step, since routing would still stop it", () => {
    const over = plan({ status: "at-usage-limit", windows: [window({ available: 30, name: "seven-day", used: 75 })] });
    const atNext = plan({
      status: "at-usage-limit",
      windows: [window({ available: 30, name: "seven-day", used: 40 })],
    });
    expect([over, atNext].map((each) => usageLimitStopOf({ plan: each }))).toEqual([
      {
        kind: "no-raise",
        words:
          "stopped at your usage limit of 30% of its week (your own setting, not the provider's); it has already used " +
          "75% of its week, so one step up to 40% would not let it continue",
      },
      {
        kind: "no-raise",
        words:
          "stopped at your usage limit of 30% of its week (your own setting, not the provider's); it has already used " +
          "40% of its week, so one step up to 40% would not let it continue",
      },
    ]);
  });

  it("judges a Codex plan's fullest weekly window when the reading carries two, not the first", () => {
    const twoWeeks = plan({
      id: "codex:codex-two",
      provider: "codex",
      status: "at-usage-limit",
      windows: [
        window({ available: 30, name: "weekly", used: 30 }),
        window({ available: 30, name: "weekly", used: 40 }),
      ],
    });
    expect(usageLimitStopOf({ plan: twoWeeks })).toEqual({
      kind: "no-raise",
      words:
        "stopped at your usage limit of 30% of its week (your own setting, not the provider's); it has already used " +
        "40% of its week, so one step up to 40% would not let it continue",
    });
  });

  it("offers no raise when the weekly windows disagree on the limit, rather than picking one", () => {
    const split = plan({
      id: "codex:codex-two",
      provider: "codex",
      status: "at-usage-limit",
      windows: [
        window({ available: 30, name: "weekly", used: 30 }),
        window({ available: 50, name: "weekly", used: 20 }),
      ],
    });
    expect(usageLimitStopOf({ plan: split })).toEqual({
      kind: "no-raise",
      words:
        "stopped at your usage limit (your own setting, not the provider's), but this reading carried weekly " +
        "windows at different limits, so there is no one limit to raise from here",
    });
  });

  it("still offers the raise when the week's use sits just under the next step", () => {
    const under = plan({ status: "at-usage-limit", windows: [window({ available: 30, name: "seven-day", used: 39 })] });
    expect(usageLimitStopOf({ plan: under })).toMatchObject({ kind: "raise", nextPercent: 40 });
  });

  it("offers no raise at the whole week, off the steps, or with no weekly window, and says which", () => {
    const at = (windows: readonly GlanceWindow[]): GlancePlan => plan({ status: "at-usage-limit", windows });
    expect(
      [
        at([window({ available: 100, name: "seven-day", used: 100 })]),
        at([window({ available: 35, name: "seven-day", used: 35 })]),
        at([window({ available: 100, name: "five-hour", used: 100 })]),
      ].map((each) => usageLimitStopOf({ plan: each })),
    ).toEqual([
      {
        kind: "no-raise",
        words:
          "stopped at your usage limit of 100% of its week (your own setting, not the provider's); it is already the " +
          "whole week, so there is nothing to raise",
      },
      {
        kind: "no-raise",
        words:
          "stopped at your usage limit of 35% of its week (your own setting, not the provider's); 35% is not one of the " +
          "limits the register records, so there is no raise to offer from here",
      },
      {
        kind: "no-raise",
        words:
          "stopped at your usage limit (your own setting, not the provider's), but this reading carried no weekly " +
          "window to say which limit, so there is no raise to offer from here",
      },
    ]);
  });

  it("says a monthly-spend plan is not measured and offers no raise, since raising changes nothing", () => {
    const stop = usageLimitStopOf({ plan: plan({ reason: CODEX_MONTHLY_SPEND_NOT_MEASURED, status: "unreadable" }) });
    expect(stop).toEqual({
      kind: "not-measured",
      words:
        "not measured: its allowance is a monthly spend, which nothing here reads yet, so routing never sends it " +
        "autonomous work; raising its usage limit would not change that",
    });
  });

  it("is nothing for an open, paused, refusing or failed-read plan", () => {
    expect(
      [
        plan({ status: "open" }),
        plan({ status: "paused" }),
        plan({ reason: "seven-day at 99%, past the routing bar", status: "refusing" }),
        plan({ reason: "probe timed out", status: "unreadable" }),
      ].map((each) => usageLimitStopOf({ plan: each })),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("the plan row", () => {
  it("says the limit is the owner's own setting, never 'capped', and carries the raise", () => {
    const row = planRowOf({ nowMs: NOW_MS, plan: CLAUDE_AT_30 });
    expect([row.status, row.tone, row.unread, row.usageLimit!.kind]).toEqual([
      "not taking new work: stopped at your usage limit of 30% of its week (your own setting, not the provider's)",
      "stopped",
      undefined,
      "raise",
    ]);
  });

  it("keeps a not-measured plan's row and says why, rather than drawing it as a failed read", () => {
    const row = planRowOf({
      nowMs: NOW_MS,
      plan: plan({ reason: CODEX_MONTHLY_SPEND_NOT_MEASURED, status: "unreadable" }),
    });
    expect([row.status, row.tone, row.unread, row.usageLimit!.kind]).toEqual([
      "not taking new work: not measured: its allowance is a monthly spend, which nothing here reads yet, so routing " +
        "never sends it autonomous work; raising its usage limit would not change that",
      "unread",
      undefined,
      "not-measured",
    ]);
  });

  it("still draws a plan whose probe failed as a staleness mark", () => {
    const row = planRowOf({ nowMs: NOW_MS, plan: plan({ reason: "probe timed out", status: "unreadable" }) });
    expect([row.unread, row.usageLimit]).toEqual([{ subject: "plan-one's usage", why: "probe timed out" }, undefined]);
  });
});

describe("the raise's act row", () => {
  it("builds the set-usage-limit argv with --from from the slots a 30% stop carries", () => {
    // The slots the first usageLimitStopOf case asserts CLAUDE_AT_30 produces.
    const slots = { from: "30", percent: "40", plan: "plan-one", provider: "claude" };
    const built = buildActArgv({ slots, verb: actVerbFor({ slug: RAISE_USAGE_LIMIT_SLUG })! });
    expect(built).toEqual({
      argv: [
        "plans",
        "set-usage-limit",
        "--provider",
        "claude",
        "--plan",
        "plan-one",
        "--percent",
        "40",
        "--from",
        "30",
        "--allowance",
        "weekly-window",
        "--json",
      ],
      kind: "argv",
    });
  });

  it("refuses a slot carrying a flag, so a press cannot name another verb's argument", () => {
    const built = buildActArgv({
      slots: { from: "30", percent: "40", plan: "--home", provider: "claude" },
      verb: actVerbFor({ slug: RAISE_USAGE_LIMIT_SLUG })!,
    });
    expect(built).toMatchObject({
      kind: "refused",
      why: expect.stringContaining("plan is not an id a register prints"),
    });
  });

  it("re-reads the capacity reading the rows are drawn from", () => {
    expect(actVerbFor({ slug: RAISE_USAGE_LIMIT_SLUG })!.readsSlug).toBe("capacity-reading");
  });
});

describe("raisePressedHeldOf", () => {
  it("leaves an unpressed button armed", () => {
    expect(raisePressedHeldOf({ phase: "idle" })).toBe(undefined);
  });

  it("holds while the write is in flight", () => {
    expect(raisePressedHeldOf({ phase: "sending" })).toBe("the raise is being written");
  });

  it("holds after a raise that landed, because the recorded row still shows the old limit", () => {
    expect(raisePressedHeldOf({ phase: "done" })).toBe(
      "raised, so the button waits for the next capacity reading to show the new limit",
    );
  });

  it("holds after a refused or unanswered press until the next reading", () => {
    const expected = "this press did not land as asked, so the button waits for the next capacity reading";
    expect(raisePressedHeldOf({ phase: "refused" })).toBe(expected);
    expect(raisePressedHeldOf({ phase: "unknown" })).toBe(expected);
  });
});

describe("raiseRecordedHeldOf", () => {
  const pressedFrom: ReadonlySet<string> = new Set(["2026-11-05T01:00:00.000Z"]);

  it("holds every raise drawn off the reading a raise was pressed from, the pressed row's and every other's", () => {
    expect(raiseRecordedHeldOf({ pressedFrom, readAtIso: "2026-11-05T01:00:00.000Z" })).toBe(
      "a raise was already pressed from this capacity reading, so every raise waits for the next one",
    );
  });

  it("re-arms on a newer reading, even one still showing the old limit", () => {
    expect(raiseRecordedHeldOf({ pressedFrom, readAtIso: "2026-11-05T01:40:00.000Z" })).toBe(undefined);
  });

  it("holds nothing on a page that pressed nothing", () => {
    expect(raiseRecordedHeldOf({ pressedFrom: new Set(), readAtIso: "2026-11-05T01:00:00.000Z" })).toBe(undefined);
  });

  it("holds nothing before a reading answers", () => {
    expect(raiseRecordedHeldOf({ pressedFrom, readAtIso: undefined })).toBe(undefined);
  });
});

describe("raiseButtonHeldOf", () => {
  const pressedFrom: ReadonlySet<string> = new Set(["2026-11-05T01:00:00.000Z"]);
  const readAtIso = "2026-11-05T01:00:00.000Z";

  it("says the button's own press first, over the page's record of the same reading", () => {
    expect(raiseButtonHeldOf({ phase: "sending", pressedFrom, readAtIso })).toBe("the raise is being written");
  });

  it("falls to the page's record when this button pressed nothing", () => {
    expect(raiseButtonHeldOf({ phase: "idle", pressedFrom, readAtIso })).toBe(
      "a raise was already pressed from this capacity reading, so every raise waits for the next one",
    );
  });

  it("holds nothing when neither this button nor the page pressed off this reading", () => {
    expect(raiseButtonHeldOf({ phase: "idle", pressedFrom: new Set(), readAtIso })).toBe(undefined);
  });
});

describe("raiseHeldOf", () => {
  const ready = (over: { stale?: { why: string }; refreshing?: true; fixture?: string }): LiveState<unknown> => ({
    fixture: undefined,
    observedAtIso: "2026-11-04T02:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: {},
    ...over,
  });

  it("holds on a fixture, an unanswered, a stale and a refreshing reading, and frees a current one", () => {
    expect([
      raiseHeldOf({ fixture: "busy-fleet", state: ready({}) }),
      raiseHeldOf({ fixture: undefined, state: { phase: "loading" } }),
      raiseHeldOf({ fixture: undefined, state: ready({ stale: { why: "exit 1" } }) }),
      raiseHeldOf({ fixture: undefined, state: ready({ refreshing: true }) }),
      raiseHeldOf({ fixture: undefined, state: ready({}) }),
    ]).toEqual([
      "a fixture (busy-fleet), so the raise is off",
      "the capacity reading has not answered, so the raise waits for it",
      "an earlier capacity reading, so the raise waits for a fresh one",
      "the capacity reading is being re-read, so the raise waits for it",
      undefined,
    ]);
  });

  it("holds on a frozen reading still drawn after the page has left its fixture", () => {
    expect(raiseHeldOf({ fixture: undefined, state: ready({ fixture: "usage-limit" }) })).toBe(
      "a fixture (usage-limit), so the raise is off",
    );
  });
});
