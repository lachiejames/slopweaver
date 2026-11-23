/*
 * `codex route`'s human read: one summary line per destination by default, carrying its disposition and why, with
 * ACCOUNT DRIFT kept visible; each destination's account, allowance, store and scan behind `--full`. Built from a
 * constructed assessment — the renderer is pure.
 */
import { describe, expect, it } from "vitest";

import { CODEX_ROUTE_FLAG_NAMES, parseCodexRouteArgs } from "../../../cli/commands/codex/routeRun.js";
import { type CodexFleetAssessment, type CodexFleetRow } from "../../../codex/fleetAssessment.js";
import { renderCodexFleet } from "../../../codex/fleetRender.js";

const ROW: CodexFleetRow = {
  alias: "codex-main",
  allowance: "weekly-window",
  codexHome: "/h/codex-main",
  disposition: "ranked 1",
  dispositionReason: "lowest weekly use",
  emailCached: "dev@acme.example",
  filesRead: 3,
  filesSkipped: 0,
  fiveHourUsedPercent: 12,
  gauge: null,
  gaugeSource: "live",
  liveEmail: "dev@acme.example",
  liveState: "signed-in",
  liveUnreadableReason: null,
  observationAgeSeconds: 4,
  pausedReason: null,
  pausedSinceIso: null,
  refusalReason: null,
  refusing: false,
  resetCreditsAvailable: 2,
  usageLimitPercent: 100,
  weeklyUsedPercent: 40,
};

const DRIFTED: CodexFleetRow = {
  ...ROW,
  alias: "codex-spare",
  codexHome: "/h/codex-spare",
  disposition: "excluded (capped)",
  dispositionReason: "weekly window at 100%",
  emailCached: "old@acme.example",
  liveEmail: "new@acme.example",
  resetCreditsAvailable: 0,
  weeklyUsedPercent: 100,
};

const ASSESSMENT: CodexFleetAssessment = {
  advisories: ["codex-main: 2 free usage-limit reset(s) held"],
  destinations: 2,
  fiveHourMeasured: 2,
  insteadDo: null,
  ranking: { basis: "weekly", deferredUnmeasured: [], excluded: [], ranked: [] },
  readAtIso: "2026-11-05T12:00:00.000Z",
  refusing: 0,
  registerDiagnostics: [],
  requestedModel: "gpt-acme",
  rows: [ROW, DRIFTED],
  selection: { destination: { alias: "codex-main", codexHome: "/h/codex-main" }, kind: "selected" },
  unpaused: 2,
  weeklyMeasured: 2,
  weeklySpread: { kind: "spread", ofDestinations: 2, points: 60, samples: 2 },
};

const DRIFT_LINE =
  "      ACCOUNT DRIFT: the row says old@acme.example, the store is signed in as new@acme.example — run slopweaver plans sync-accounts";

describe("renderCodexFleet", () => {
  it("gives each destination one summary line by default, its drift kept and its detail folded", () => {
    expect(renderCodexFleet({ assessment: ASSESSMENT, full: false })).toEqual([
      "codex route: codex-main (/h/codex-main)",
      "  2 destination(s), 2 unpaused, 0 refusing, read at 2026-11-05T12:00:00.000Z (--full for each one's account, allowance, store and scan)",
      "  codex-main — week 40% / 5h 12% · ranked 1: lowest weekly use · 2 free reset(s) unused",
      "  codex-spare — week 100% / 5h 12% · excluded (capped): weekly window at 100%",
      DRIFT_LINE,
      "  advisory: codex-main: 2 free usage-limit reset(s) held",
    ]);
  });

  it("keeps a degraded reading's live state and skipped scan on the default line, so a deadline read says so", () => {
    const degraded: CodexFleetRow = {
      ...ROW,
      fiveHourUsedPercent: null,
      liveEmail: null,
      liveState: "unreadable",
      liveUnreadableReason: "deadline reached",
      resetCreditsAvailable: null,
      scanSkippedReason: "not run: under a caller's deadline",
      weeklyUsedPercent: null,
    };
    const lines = renderCodexFleet({ assessment: { ...ASSESSMENT, rows: [degraded] }, full: false });

    expect(lines.filter((line) => line.startsWith("  codex-main — "))).toEqual([
      "  codex-main — week unread · ranked 1: lowest weekly use · live read unavailable — deadline reached · rollout scan not run: under a caller's deadline",
    ]);
  });

  it("names no five-hour window, and counts none under --full, when no reading carries one", () => {
    const weeklyOnly: CodexFleetRow = { ...ROW, fiveHourUsedPercent: null };
    const assessment = { ...ASSESSMENT, fiveHourMeasured: 0, rows: [weeklyOnly] };

    expect(renderCodexFleet({ assessment, full: false })[2]).toBe(
      "  codex-main — week 40% · ranked 1: lowest weekly use · 2 free reset(s) unused",
    );
    expect(renderCodexFleet({ assessment, full: true })).toContain("  weekly readings: 2 of 2");
    expect(renderCodexFleet({ assessment: ASSESSMENT, full: true })).toContain(
      "  weekly readings: 2 of 2 · five-hour: 2 of 2",
    );
  });

  it("still counts a five-hour window under --full when a reading carries one nothing current was read from", () => {
    const carried: CodexFleetRow = {
      ...ROW,
      fiveHourUsedPercent: null,
      gauge: {
        credits: undefined,
        limitId: "codex",
        observedAtIso: "2026-01-01T00:00:00.000Z",
        planType: "team",
        reached: undefined,
        reachedType: undefined,
        windows: [
          {
            label: "five-hour",
            resetAtIso: "2026-01-01T01:00:00.000Z",
            slot: "primary",
            usedPercent: 30,
            windowMinutes: 300,
          },
        ],
      },
    };
    const assessment = { ...ASSESSMENT, fiveHourMeasured: 0, rows: [carried] };
    const lines = renderCodexFleet({ assessment, full: true });

    expect(lines).toContain("  weekly readings: 2 of 2 · five-hour: 0 of 2");
    expect(lines.some((line) => line.startsWith("  codex-main — week 40% / 5h "))).toBe(true);
  });

  it("prints every destination's detail lines and the whole header under --full", () => {
    const lines = renderCodexFleet({ assessment: ASSESSMENT, full: true });
    expect(lines).toContain("  requested model: gpt-acme");
    expect(lines).toContain("  weekly spread: 60 points across 2 of 2 destination(s)");
    expect(lines).toContain("      signed in as dev@acme.example (live) · 2 free reset(s) unused");
    expect(lines).toContain(
      "      /h/codex-spare · called after old@acme.example (unverified) · scanned 3 file(s), 0 beyond the bound",
    );
    expect(lines).toContain(DRIFT_LINE);
  });
});

describe("codex route --full", () => {
  it("is a declared flag the parser accepts", () => {
    expect(CODEX_ROUTE_FLAG_NAMES).toContain("--full");
    expect(parseCodexRouteArgs({ rest: ["--full"] }).isOk()).toBe(true);
  });
});
