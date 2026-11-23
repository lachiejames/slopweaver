/*
 * The Fleet page's plan usage block, one plan's row: its alias and account, its bars and the Fable week, and a
 * status that says what it means, a paused plan's week as it stood at its pause and a plan at the owner's own usage limit.
 */
import { describe, expect, it } from "vitest";

import type { GlancePlan } from "../../lib/fleetGlancePlans";
import type { PlanRail, PlanRow } from "../../lib/planMetersRails";
import { CLAUDE, CODEX, NOW, PAUSED, rowsOf, usage, window } from "./planMetersFixture";

/** The row's bar under one key, which the case knows is drawn. */
const rail = ({ key, row }: { key: PlanRail["key"]; row: PlanRow }): PlanRail =>
  row.rails.find((each) => each.key === key)!;

/** Which bars a row draws, in order. */
const railKeys = ({ row }: { row: PlanRow }): readonly PlanRail["key"][] => row.rails.map((each) => each.key);

describe("fleetUsageOf, a plan's row", () => {
  it("names a plan by its alias with its email on hover, draws its bars and the Fable week beside them", () => {
    const [claude] = usage({ lowest: "claude:plan-one", plans: [CLAUDE] }).hosts;
    expect(claude.plans).toStrictEqual({
      kind: "read",
      rows: [
        {
          accountTitle: "admin@example.invalid",
          alias: "plan-one",
          fable: "Fable week 20% left · resets in 3d 0h (shown, never counted)",
          id: "claude:plan-one",
          rails: [
            {
              barPercent: 44,
              detail: "56% used · resets in 2d 17h",
              figure: "44% left",
              key: "week",
              label: "week",
              measured: true,
            },
            {
              barPercent: 70,
              detail: "30% used · resets in 3h 0m",
              figure: "70% left",
              key: "session",
              label: "5-hour session",
              measured: true,
            },
            {
              barPercent: 0,
              detail: "not read by the tick; slopweaver claude reset --plan reads it",
              figure: "not read",
              key: "reset",
              label: "free reset",
              measured: false,
            },
          ],
          status: "taking new work",
          tone: "open",
          unread: undefined,
          usageLimit: undefined,
        },
      ],
    });
  });

  it("reads a paused plan as paused on purpose, since when and why, its week as it stood at the pause", () => {
    const [claude] = usage({ plans: [PAUSED] }).hosts;
    const [row] = rowsOf({ host: claude });
    expect([row.alias, row.accountTitle, row.status, row.tone]).toStrictEqual([
      "plan-two",
      "ops@example.invalid (from the plan list, not checked while paused)",
      "paused on purpose since 5 Oct 07:13Z: never hit a limit",
      "stopped",
    ]);
    expect(rail({ key: "week", row })).toStrictEqual({
      barPercent: 20,
      detail: "80% used · resets in 1d 20h",
      figure: "20% left when paused",
      key: "week",
      label: "week",
      measured: true,
    });
    // A paused Claude plan is never probed, so it draws no session bar: its week at the pause is all there is.
    expect(railKeys({ row })).toStrictEqual(["week", "reset"]);
  });

  it("draws a paused Codex plan's bars from this reading, since its sign-in and limits are still read", () => {
    // `src/codex/fleetRead.ts` live-reads a paused weekly Codex row, so its windows are current, never "not read".
    const pausedCodex: GlancePlan = { ...CODEX, reason: "paused: not signed in yet", status: "paused" };
    const [row] = rowsOf({ host: usage({ plans: [pausedCodex] }).hosts[1] });
    expect([
      row.status,
      row.tone,
      rail({ key: "week", row }).figure,
      rail({ key: "session", row }).figure,
    ]).toStrictEqual(["paused on purpose: not signed in yet", "stopped", "60% left", "10% left"]);
  });

  it("says why a paused plan's week was not read, and on a capture from before the pause field", () => {
    const unavailable: GlancePlan = {
      ...PAUSED,
      pause: { sinceIso: NOW, weekAtPause: { kind: "unavailable", why: "no capacity reading before the pause" } },
    };
    const old: GlancePlan = { ...PAUSED, id: "claude:plan-three", pause: undefined };
    const rows = rowsOf({ host: usage({ plans: [unavailable, old] }).hosts[0] });
    expect(
      rows.map((row) => [row.status, rail({ key: "week", row }).figure, rail({ key: "week", row }).detail]),
    ).toStrictEqual([
      [
        "paused on purpose since 02:00Z: never hit a limit",
        "not read while paused",
        "not read while paused: no capacity reading before the pause",
      ],
      [
        "paused on purpose: never hit a limit",
        "not read while paused",
        "this reading predates the week a plan carries at its pause",
      ],
    ]);
  });

  it("reads the em dash prefix a reading from before the colon still carries, and prints a colon", () => {
    const legacy: GlancePlan = { ...PAUSED, pause: undefined, reason: "paused — never hit a limit" };
    const [row] = rowsOf({ host: usage({ plans: [legacy] }).hosts[0] });
    expect(row.status).toBe("paused on purpose: never hit a limit");
  });

  it("words every other status by what it means", () => {
    const words = (["refusing", "unreadable"] as const).map(
      (status) => rowsOf({ host: usage({ plans: [{ ...CODEX, reason: "probe failed", status }] }).hosts[1] })[0].status,
    );
    expect(words).toStrictEqual(["not taking new work: probe failed", "not read this time: probe failed"]);
  });

  it("words a plan at the usage limit the owner set as their own setting, never as paused on purpose or a provider cap", () => {
    const reason = "weekly at 30%, at its usage limit of 30%";
    const limited: GlancePlan = {
      ...CODEX,
      reason,
      status: "at-usage-limit",
      windows: [{ available: 30, resetAtIso: "2026-10-07T03:30:00.000Z", used: 30, window: "weekly" }],
    };
    const [row] = rowsOf({ host: usage({ plans: [limited] }).hosts[1] });
    expect([row.status, row.tone, row.usageLimit!.kind]).toStrictEqual([
      "not taking new work: stopped at your usage limit of 30% of its week (your own setting, not the provider's)",
      "stopped",
      "raise",
    ]);
  });

  it("draws a plan whose own read failed as a staleness fact naming it and why, and a read plan as none", () => {
    const unread = (["unreadable", "refusing"] as const).map(
      (status) => rowsOf({ host: usage({ plans: [{ ...CODEX, reason: "probe failed", status }] }).hosts[1] })[0].unread,
    );
    expect(unread).toStrictEqual([{ subject: "codex-two's usage", why: "probe failed" }, undefined]);
  });

  it("draws a held Codex plan's status with its reason, and a held free reset as a full bar", () => {
    const [, codex] = usage({ plans: [CODEX] }).hosts;
    const [row] = rowsOf({ host: codex });
    expect([row.status, row.tone, row.fable, rail({ key: "reset", row })]).toEqual([
      "not taking new work: five-hour window at 90%",
      "stopped",
      undefined,
      {
        barPercent: 100,
        detail: "1 free reset unused",
        figure: "1 available",
        key: "reset",
        label: "free reset",
        measured: true,
      },
    ]);
  });

  it("tells none held, not read and not recorded apart on the reset bar", () => {
    const plans = [0, null, undefined].map((freeResets, at) => ({ ...CODEX, freeResets, id: `codex:${String(at)}` }));
    const [, codex] = usage({ plans }).hosts;
    const rows = rowsOf({ host: codex });
    const resetOf = (row: PlanRow): PlanRail => rail({ key: "reset", row });
    expect(rows.map((row) => [resetOf(row).figure, resetOf(row).measured, resetOf(row).detail])).toEqual([
      ["none held", true, "no free reset held"],
      ["not read", false, "free resets not read"],
      ["not read", false, "free resets not recorded in this reading"],
    ]);
  });

  it("draws no session bar for a Codex reading with no five-hour window, and an empty allowance as not measured", () => {
    const weekOnly = { ...CODEX, windows: [{ available: 0, resetAtIso: undefined, used: 4, window: "weekly" }] };
    const [, codex] = usage({ plans: [weekOnly] }).hosts;
    const [row] = rowsOf({ host: codex });
    expect(rail({ key: "week", row })).toEqual({
      barPercent: 0,
      detail: "no allowance to measure against · no reset named",
      figure: "not measured",
      key: "week",
      label: "week",
      measured: false,
    });
    expect(railKeys({ row })).toStrictEqual(["week", "reset"]);
  });

  it("draws no session bar for a Claude plan with no five-hour window, read or unread", () => {
    const weekly = { ...CLAUDE, windows: CLAUDE.windows.filter((each) => each.window !== "five-hour") };
    const unread = { ...weekly, id: "claude:plan-unread", windows: [] };
    const [claude] = usage({ plans: [weekly, unread] }).hosts;
    const rows = rowsOf({ host: claude });
    expect(rows.map((row) => railKeys({ row }))).toStrictEqual([
      ["week", "reset"],
      ["week", "reset"],
    ]);
  });

  it("prints the used share past the cap while the bar stops at empty", () => {
    const over = { ...CODEX, windows: [window({ key: "weekly", used: 130 })] };
    const [, codex] = usage({ plans: [over] }).hosts;
    const rows = rowsOf({ host: codex });
    const week = rail({ key: "week", row: rows[0] });
    expect([week.barPercent, week.figure, week.detail]).toEqual([0, "0% left", "130% used · no reset named"]);
  });

  it("tells an account the reading recorded as none apart from one a capture from before the field lacks", () => {
    const plans = [
      { ...CODEX, account: null },
      { ...CODEX, account: undefined, id: "codex:old" },
    ];
    const [, codex] = usage({ plans }).hosts;
    const rows = rowsOf({ host: codex });
    expect(rows.map((row) => row.accountTitle)).toEqual([
      "the reading named no account for this plan",
      "account not recorded in this reading",
    ]);
  });
});
