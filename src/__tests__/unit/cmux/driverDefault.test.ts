/**
 * Which host a `cmux spawn` with no `--driver` boots on: Codex only on a REGISTERED register holding Codex rows and
 * no Claude row (one plan of either provider runs all of Slopweaver), Claude everywhere else.
 */
import { describe, expect, it } from "vitest";

import { defaultCmuxDriver } from "../../../cmux/driverDefault.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { PlanRegisterSnapshot, RegisteredPlan } from "../../../plans/types.js";

/** One registered row, with only the fields a case cares about spelled. */
const row = (over: Partial<RegisteredPlan> = {}): RegisteredPlan => ({
  alias: "plan-one",
  allowance: { kind: "weekly-window" },
  provider: "claude",
  storeDir: "/s/one",
  usageLimitPercent: 100,
  ...over,
});

const CODEX = row({ alias: "codex-one", provider: "codex", storeDir: "/s/codex-one" });
const CLAUDE = row({ alias: "claude-one" });

/** A snapshot carrying the given rows. */
const snapshotOf = ({
  plans,
  source = "registered",
}: {
  plans: readonly RegisteredPlan[];
  source?: PlanRegisterSnapshot["source"];
}): PlanRegisterSnapshot => ({
  diagnostics: [],
  document: { rows: plans.map((plan) => ({ ...plan })), version: 1 },
  plans,
  revision: null,
  source,
  thresholds: DEFAULT_THRESHOLDS,
});

describe("defaultCmuxDriver", () => {
  it("boots codex on a registered register holding only Codex rows", () => {
    expect(defaultCmuxDriver({ register: snapshotOf({ plans: [CODEX] }) })).toBe("codex");
  });

  // A paused Codex-only install must reach the Codex route's own refusal, never escape onto an unregistered Claude.
  it("boots codex on a Codex-only register even when its one row is paused or monthly-spend", () => {
    const paused = row({ ...CODEX, paused: { reason: "owner call", sinceIso: "2026-11-03T00:00:00.000Z" } });
    const monthly = row({ ...CODEX, allowance: { kind: "monthly-spend" } });
    expect([paused, monthly].map((plan) => defaultCmuxDriver({ register: snapshotOf({ plans: [plan] }) }))).toEqual([
      "codex",
      "codex",
    ]);
  });

  it("keeps claude on a Claude-only, a mixed and an empty registered register", () => {
    expect(
      [[CLAUDE], [CLAUDE, CODEX], []].map((plans) => defaultCmuxDriver({ register: snapshotOf({ plans }) })),
    ).toEqual(["claude", "claude", "claude"]);
  });

  // Only an ADOPTED register can be Codex-only: a derived one holds the signed-in Claude plans alone, and the
  // guard keeps it on Claude even for a hand-built derived snapshot carrying a Codex row.
  it("reads a Codex-only register as Codex only when it is REGISTERED", () => {
    const codex = row({ alias: "codex-one", provider: "codex", storeDir: "/home/.codex-one" });
    expect(defaultCmuxDriver({ register: snapshotOf({ plans: [codex], source: "derived" }) })).toBe("claude");
    expect(defaultCmuxDriver({ register: snapshotOf({ plans: [codex], source: "registered" }) })).toBe("codex");
  });
});
