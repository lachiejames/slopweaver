import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { applyPlanMutation } from "../../../plans/mutate.js";
import {
  derivePlanRegister,
  findRegisteredPlan,
  parsePlanRegister,
  pinnedPlanFor,
  unpausedPlansFor,
} from "../../../plans/register.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";

/** The five Claude rows this install actually carries, aliases and paths only. */
const LEGACY_CLAUDE_ROWS: readonly Readonly<Record<string, unknown>>[] = [
  { alias: "plan-one", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-one" },
  { alias: "plan-two", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-two" },
  { alias: "plan-three", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-three" },
  { alias: "plan-four", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-four" },
  { alias: "plan-five", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-five" },
];

/** The usage limit a newly added row carries: the whole of its weekly window. */
const WHOLE_WEEK = { allowance: { kind: "weekly-window" }, usageLimitPercent: 100 } as const;

const registered = ({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): PlanRegisterSnapshot =>
  unwrap(parsePlanRegister({ value: { rows, version: 1 } }));

describe("applyPlanMutation", () => {
  const base = (): PlanRegisterSnapshot =>
    registered({
      rows: [
        { alias: "plan-one", note: "kept by an older writer", pinned: null, provider: "claude", storeDir: "/c1" },
        { alias: "plan-two", provider: "claude", storeDir: "/c2" },
        { alias: "codex-work", pinned: true, provider: "codex", storeDir: "/x1" },
        { alias: "codex-spare", provider: "codex", storeDir: "/x2" },
      ],
    });

  it("preserves an unrelated raw field and `pinned: null` through a pause", () => {
    const paused = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "plan-one",
          kind: "pause",
          paused: { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" },
          provider: "claude",
        },
        snapshot: base(),
      }),
    );
    expect(paused.document.rows[0]).toStrictEqual({
      alias: "plan-one",
      note: "kept by an older writer",
      paused: { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" },
      pinned: null,
      provider: "claude",
      storeDir: "/c1",
    });
    expect(unpausedPlansFor({ plans: paused.plans, provider: "claude" }).map((p) => p.alias)).toStrictEqual([
      "plan-two",
    ]);
  });

  it("pauses a Codex row carrying a legacy pin, because a Codex pin decides nothing", () => {
    const paused = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "codex-work",
          kind: "pause",
          paused: { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" },
          provider: "codex",
        },
        snapshot: base(),
      }),
    );
    expect(unpausedPlansFor({ plans: paused.plans, provider: "codex" }).map((p) => p.alias)).toStrictEqual([
      "codex-spare",
    ]);
  });

  it("refuses a second pause and names when the standing one was recorded", () => {
    const paused = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "plan-one",
          kind: "pause",
          paused: { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" },
          provider: "claude",
        },
        snapshot: base(),
      }),
    );
    const again = unwrapErr(
      applyPlanMutation({
        mutation: {
          alias: "plan-one",
          kind: "pause",
          paused: { reason: "again", sinceIso: "2026-09-22T00:00:00.000Z" },
          provider: "claude",
        },
        snapshot: paused,
      }),
    );
    expect(again.code).toBe("MUTATION_CONFLICT");
    expect(again.message).toContain("2026-09-21T00:00:00.000Z");
  });

  it("removes only the paused key on resume", () => {
    const paused = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "plan-one",
          kind: "pause",
          paused: { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" },
          provider: "claude",
        },
        snapshot: base(),
      }),
    );
    const resumed = unwrap(
      applyPlanMutation({ mutation: { alias: "plan-one", kind: "resume", provider: "claude" }, snapshot: paused }),
    );
    expect(resumed.document.rows[0]).toStrictEqual({
      alias: "plan-one",
      note: "kept by an older writer",
      pinned: null,
      provider: "claude",
      storeDir: "/c1",
    });
  });

  it("refuses resuming a plan that was never paused", () => {
    const error = unwrapErr(
      applyPlanMutation({ mutation: { alias: "plan-two", kind: "resume", provider: "claude" }, snapshot: base() }),
    );
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain("is not paused, so nothing resumes");
  });

  it("names an unknown destination by provider and alias", () => {
    const error = unwrapErr(
      applyPlanMutation({ mutation: { alias: "plan-one", kind: "resume", provider: "codex" }, snapshot: base() }),
    );
    expect(error.code).toBe("UNKNOWN_DESTINATION");
    expect(error.message).toBe(
      "no registered codex plan is called `plan-one` — `slopweaver plans list` names every one",
    );
  });

  it("records a lapse on the addressed row alone, every other key and row kept, a paused row included", () => {
    const pause = { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" };
    const paused = unwrap(
      applyPlanMutation({
        mutation: { alias: "plan-one", kind: "pause", paused: pause, provider: "claude" },
        snapshot: base(),
      }),
    );
    const lapsed = unwrap(
      applyPlanMutation({
        mutation: { alias: "plan-one", kind: "set-lapse", lapsesAtIso: "2026-11-17T00:00:00Z", provider: "claude" },
        snapshot: paused,
      }),
    );
    expect(lapsed.document.rows).toStrictEqual([
      {
        alias: "plan-one",
        lapsesAtIso: "2026-11-17T00:00:00Z",
        note: "kept by an older writer",
        paused: pause,
        pinned: null,
        provider: "claude",
        storeDir: "/c1",
      },
      ...base().document.rows.slice(1),
    ]);
    expect(findRegisteredPlan({ alias: "plan-one", plans: lapsed.plans, provider: "claude" })!.lapsesAtIso).toBe(
      "2026-11-17T00:00:00Z",
    );
  });

  it("replaces an earlier lapse on renewal, and recording the same one again changes nothing", () => {
    const lapse = (at: { lapsesAtIso: string; snapshot: PlanRegisterSnapshot }): PlanRegisterSnapshot =>
      unwrap(
        applyPlanMutation({
          mutation: { alias: "plan-two", kind: "set-lapse", lapsesAtIso: at.lapsesAtIso, provider: "claude" },
          snapshot: at.snapshot,
        }),
      );
    const first = lapse({ lapsesAtIso: "2026-11-17T00:00:00Z", snapshot: base() });
    const renewed = lapse({ lapsesAtIso: "2026-12-17T00:00:00Z", snapshot: first });
    expect(renewed.document.rows[1]).toStrictEqual({
      alias: "plan-two",
      lapsesAtIso: "2026-12-17T00:00:00Z",
      provider: "claude",
      storeDir: "/c2",
    });
    expect(lapse({ lapsesAtIso: "2026-12-17T00:00:00Z", snapshot: renewed }).document).toStrictEqual(renewed.document);
  });

  it("refuses a lapse for a destination nobody registered", () => {
    const error = unwrapErr(
      applyPlanMutation({
        mutation: { alias: "plan-nine", kind: "set-lapse", lapsesAtIso: "2026-11-17T00:00:00Z", provider: "claude" },
        snapshot: base(),
      }),
    );
    expect(error.code).toBe("UNKNOWN_DESTINATION");
  });

  it("moves a Claude pin without touching a Codex row's legacy one", () => {
    const pinned = unwrap(
      applyPlanMutation({ mutation: { alias: "plan-two", kind: "pin", provider: "claude" }, snapshot: base() }),
    );
    expect(pinnedPlanFor({ plans: pinned.plans, provider: "claude" })?.alias).toBe("plan-two");
    const moved = unwrap(
      applyPlanMutation({ mutation: { alias: "plan-one", kind: "pin", provider: "claude" }, snapshot: pinned }),
    );
    expect(pinnedPlanFor({ plans: moved.plans, provider: "claude" })?.alias).toBe("plan-one");
    expect(findRegisteredPlan({ alias: "plan-two", plans: moved.plans, provider: "claude" })?.pinned).toBe(undefined);
    expect(pinnedPlanFor({ plans: moved.plans, provider: "codex" })?.alias).toBe("codex-work");
  });

  it("refuses to pin a Codex row, because Codex draws every destination down in one pool", () => {
    const error = unwrapErr(
      applyPlanMutation({ mutation: { alias: "codex-spare", kind: "pin", provider: "codex" }, snapshot: base() }),
    );
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain("Codex has no pinned seat");
  });

  it("refuses to add a pinned Codex row, the second way a Codex pin could be written", () => {
    const error = unwrapErr(
      applyPlanMutation({
        mutation: {
          kind: "add",
          row: { alias: "codex-new", pinned: true, provider: "codex", storeDir: "/x9", ...WHOLE_WEEK },
        },
        snapshot: base(),
      }),
    );
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain("Codex has no pinned seat");
  });

  it("refuses pinning a paused plan, because a pinned seat would have nowhere to boot", () => {
    const paused = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "plan-two",
          kind: "pause",
          paused: { reason: "card declined", sinceIso: "2026-09-21T00:00:00.000Z" },
          provider: "claude",
        },
        snapshot: base(),
      }),
    );
    const error = unwrapErr(
      applyPlanMutation({ mutation: { alias: "plan-two", kind: "pin", provider: "claude" }, snapshot: paused }),
    );
    expect(error.message).toContain("resume it first");
  });

  it("appends an added row and refuses a second row with the same alias", () => {
    const added = unwrap(
      applyPlanMutation({
        mutation: {
          kind: "add",
          row: {
            alias: "codex-personal",
            email: "owner@example.com",
            provider: "codex",
            storeDir: "/x3",
            ...WHOLE_WEEK,
          },
        },
        snapshot: base(),
      }),
    );
    expect(added.document.rows[4]).toStrictEqual({
      alias: "codex-personal",
      allowance: { kind: "weekly-window" },
      email: "owner@example.com",
      provider: "codex",
      storeDir: "/x3",
      usageLimitPercent: 100,
    });
    const clash = unwrapErr(
      applyPlanMutation({
        mutation: { kind: "add", row: { alias: "codex-personal", provider: "codex", storeDir: "/x4", ...WHOLE_WEEK } },
        snapshot: added,
      }),
    );
    expect(clash.code).toBe("MUTATION_CONFLICT");
    expect(clash.message).toContain("a codex plan called `codex-personal` is already registered");
  });

  it("refuses an added row whose store directory is already registered to its provider", () => {
    const error = unwrapErr(
      applyPlanMutation({
        mutation: { kind: "add", row: { alias: "codex-copy", provider: "codex", storeDir: "/x1", ...WHOLE_WEEK } },
        snapshot: base(),
      }),
    );
    expect(error.code).toBe("REGISTER_INVALID");
    expect(error.message).toContain("two codex plans share the same storeDir `/x1`");
  });

  it("adopts a derived register once and refuses adopting an adopted one", () => {
    const derived = unwrap(derivePlanRegister({ claudeRows: LEGACY_CLAUDE_ROWS }));
    const adopted = unwrap(applyPlanMutation({ mutation: { kind: "adopt" }, snapshot: derived }));
    expect(adopted.source).toBe("registered");
    expect(adopted.diagnostics).toStrictEqual([]);
    expect(adopted.document.rows).toStrictEqual(derived.document.rows);
    const again = unwrapErr(applyPlanMutation({ mutation: { kind: "adopt" }, snapshot: adopted }));
    expect(again.code).toBe("MUTATION_CONFLICT");
    expect(again.message).toContain("already adopted");
    expect(again.message).toContain("run slopweaver plans sync-accounts");
  });

  it("leaves the register untouched for a projection repair", () => {
    const snapshot = base();
    const repaired = unwrap(applyPlanMutation({ mutation: { kind: "repair-projection" }, snapshot }));
    expect(repaired).toStrictEqual(snapshot);
  });

  it("records a store's live address on its row, leaving every other field and row as it was", () => {
    const recorded = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "codex-spare",
          email: "spare@example.com",
          kind: "record-email",
          provider: "codex",
          storeDir: "/x2",
        },
        snapshot: base(),
      }),
    );
    expect(recorded.document.rows[3]).toStrictEqual({
      alias: "codex-spare",
      email: "spare@example.com",
      provider: "codex",
      storeDir: "/x2",
    });
    expect(recorded.document.rows.slice(0, 3)).toStrictEqual(base().document.rows.slice(0, 3));
  });

  it("refuses to record an address read from a store the row no longer names", () => {
    const refused = unwrapErr(
      applyPlanMutation({
        mutation: {
          alias: "codex-spare",
          email: "spare@example.com",
          kind: "record-email",
          provider: "codex",
          storeDir: "/x9",
        },
        snapshot: base(),
      }),
    );
    expect(refused.message).toContain("`codex-spare` now names /x2, not the /x9 that was read");
  });
});

describe("applyPlanMutation set-usage-limit", () => {
  const base = (): PlanRegisterSnapshot =>
    registered({
      rows: [
        { alias: "plan-one", note: "kept by an older writer", pinned: null, provider: "claude", storeDir: "/c1" },
        { alias: "plan-two", provider: "claude", storeDir: "/c2" },
        { alias: "codex-spare", provider: "codex", storeDir: "/x2" },
      ],
    });

  it("writes only the two limit keys onto the named row, keeping every raw field and every other row", () => {
    const limited = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "plan-one",
          allowance: { kind: "weekly-window" },
          kind: "set-usage-limit",
          provider: "claude",
          usageLimitPercent: 30,
        },
        snapshot: base(),
      }),
    );
    expect(limited.document.rows[0]).toStrictEqual({
      alias: "plan-one",
      allowance: { kind: "weekly-window" },
      note: "kept by an older writer",
      pinned: null,
      provider: "claude",
      storeDir: "/c1",
      usageLimitPercent: 30,
    });
    expect(limited.document.rows.slice(1)).toStrictEqual(base().document.rows.slice(1));
    expect(findRegisteredPlan({ alias: "plan-one", plans: limited.plans, provider: "claude" })!.usageLimitPercent).toBe(
      30,
    );
  });

  it("records a monthly-spend allowance on a Codex row", () => {
    const limited = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "codex-spare",
          allowance: { kind: "monthly-spend" },
          kind: "set-usage-limit",
          provider: "codex",
          usageLimitPercent: 50,
        },
        snapshot: base(),
      }),
    );
    const plan = findRegisteredPlan({ alias: "codex-spare", plans: limited.plans, provider: "codex" })!;
    expect(plan.allowance).toStrictEqual({ kind: "monthly-spend" });
    expect(plan.usageLimitPercent).toBe(50);
  });

  it("refuses a limit the row already carries, so a no-op never bumps the revision", () => {
    const error = unwrapErr(
      applyPlanMutation({
        mutation: {
          alias: "plan-two",
          allowance: { kind: "weekly-window" },
          kind: "set-usage-limit",
          provider: "claude",
          usageLimitPercent: 100,
        },
        snapshot: base(),
      }),
    );
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain("`plan-two` already has a usage limit of 100% of its weekly-window allowance");
  });

  it("names an unknown destination rather than adding one", () => {
    const error = unwrapErr(
      applyPlanMutation({
        mutation: {
          alias: "plan-nine",
          allowance: { kind: "weekly-window" },
          kind: "set-usage-limit",
          provider: "claude",
          usageLimitPercent: 30,
        },
        snapshot: base(),
      }),
    );
    expect(error.code).toBe("UNKNOWN_DESTINATION");
  });

  it("keeps the limit through a pause, a resume, a pin, a recorded address, a repair and a reread", () => {
    const steps = [
      {
        alias: "plan-one",
        allowance: { kind: "weekly-window" },
        kind: "set-usage-limit",
        provider: "claude",
        usageLimitPercent: 30,
      },
      {
        alias: "plan-one",
        kind: "pause",
        paused: { reason: "lapsed", sinceIso: "2026-11-04T00:00:00Z" },
        provider: "claude",
      },
      { alias: "plan-one", kind: "resume", provider: "claude" },
      { alias: "plan-one", kind: "pin", provider: "claude" },
      { alias: "codex-spare", email: "spare@example.com", kind: "record-email", provider: "codex", storeDir: "/x2" },
      { kind: "repair-projection" },
    ] as const;
    const final = steps.reduce((snapshot, mutation) => unwrap(applyPlanMutation({ mutation, snapshot })), base());
    const reread = registered({ rows: final.document.rows });
    const plan = findRegisteredPlan({ alias: "plan-one", plans: reread.plans, provider: "claude" })!;
    expect(plan.allowance).toStrictEqual({ kind: "weekly-window" });
    expect(plan.usageLimitPercent).toBe(30);
    expect(plan.pinned).toBe(true);
    expect(plan.paused).toBe(undefined);
  });
});
