import { describe, expect, it } from "vitest";

import { decodePlanChoice, planChoiceLine, type SessionPlanChoice } from "../../../sessions/planChoice.js";
import { foldSessions, parseSessionLog, type SessionEvent, sessionEventLine } from "../../../sessions/session.js";

const ROUTED: SessionPlanChoice = {
  alias: "plan-two",
  basis: "routed",
  kind: "named",
  alternative: "--plan <alias>",
  readings: [
    {
      alias: "plan-two",
      observedAtIso: "2026-09-12T06:00:00.000Z",
      reading: "all-models week 30%, 5h 20%",
      state: "chosen",
    },
    { alias: "plan-one", reading: "provider-refused", state: "excluded" },
    { alias: "plan-three", reading: "no gauge was readable", state: "unreadable" },
  ],
  reason: "ranked first of 1 eligible plan(s) for a all-models spawn",
  vendor: "claude",
};

const AMBIENT: SessionPlanChoice = {
  kind: "ambient",
  alternative: "unset ANTHROPIC_API_KEY to spend a plan login",
  reason: "ANTHROPIC_API_KEY outranks every credential store, so the session presents an API key and no plan decides",
  vendor: "claude",
};

/** A spawned row as the ledger writes it, with whatever `planChoice` the case puts on it. */
const spawnedLine = ({ planChoice }: { planChoice?: unknown }): string =>
  JSON.stringify({
    branch: "s",
    cwd: "/w/s",
    kind: "spawned",
    sessionKey: "s",
    surfaceRef: "surface:1",
    tsIso: "2026-11-05T10:00:00.000Z",
    workspaceRef: "workspace:9",
    ...(planChoice === undefined ? {} : { planChoice }),
  });

describe("decodePlanChoice", () => {
  it("decodes a named choice exactly as it was written", () => {
    expect(decodePlanChoice({ value: JSON.parse(JSON.stringify(ROUTED)) })).toStrictEqual(ROUTED);
  });

  it("decodes an ambient choice exactly as it was written", () => {
    expect(decodePlanChoice({ value: JSON.parse(JSON.stringify(AMBIENT)) })).toStrictEqual(AMBIENT);
  });

  it("refuses a reading carrying an account address", () => {
    const leaked = { ...ROUTED, readings: [{ alias: "plan-two", reading: "seat-1@example.test", state: "chosen" }] };
    expect(decodePlanChoice({ value: leaked })).toBe(undefined);
  });

  it("refuses a reason carrying a store path", () => {
    expect(decodePlanChoice({ value: { ...ROUTED, reason: "booted on /stores/plan-two" } })).toBe(undefined);
  });

  it("refuses a Windows-style path separator as well", () => {
    expect(decodePlanChoice({ value: { ...AMBIENT, alternative: "C:\\stores" } })).toBe(undefined);
  });

  it("refuses an unknown key rather than dropping it", () => {
    expect(decodePlanChoice({ value: { ...ROUTED, storeDir: "plan-two" } })).toBe(undefined);
  });

  it("refuses an unknown basis", () => {
    expect(decodePlanChoice({ value: { ...ROUTED, basis: "guessed" } })).toBe(undefined);
  });
});

describe("planChoiceLine", () => {
  it("names the plan, its basis and reason, every reading once, and the alternative", () => {
    expect(planChoiceLine({ choice: ROUTED })).toBe(
      "plan: plan-two (claude, routed) — ranked first of 1 eligible plan(s) for a all-models spawn; readings: " +
        "plan-two chosen (all-models week 30%, 5h 20%, read 2026-09-12T06:00:00.000Z), " +
        "plan-one excluded (provider-refused), plan-three unreadable (no gauge was readable); alternative: --plan <alias>",
    );
  });

  it("says no plan decided an ambient spawn, and how to make one", () => {
    expect(planChoiceLine({ choice: AMBIENT })).toBe(
      "plan: ambient claude login — ANTHROPIC_API_KEY outranks every credential store, so the session presents an " +
        "API key and no plan decides; alternative: unset ANTHROPIC_API_KEY to spend a plan login",
    );
  });

  it("says `none` for a choice with no readings", () => {
    expect(planChoiceLine({ choice: { ...ROUTED, readings: [] } })).toBe(
      "plan: plan-two (claude, routed) — ranked first of 1 eligible plan(s) for a all-models spawn; readings: none; " +
        "alternative: --plan <alias>",
    );
  });
});

describe("a spawned ledger row's planChoice", () => {
  it("round-trips through the log onto the folded row", () => {
    const event: SessionEvent = {
      branch: "s",
      cwd: "/w/s",
      kind: "spawned",
      planChoice: ROUTED,
      sessionKey: "s",
      surfaceRef: "surface:1",
      tsIso: "2026-11-05T10:00:00.000Z",
      workspaceRef: "workspace:9",
    };
    const parsed = parseSessionLog({ text: sessionEventLine({ event }) });
    expect(parsed.events).toStrictEqual([event]);
    expect(foldSessions({ events: parsed.events })[0]!.planChoice).toStrictEqual(ROUTED);
  });

  it("reads a legacy row with no planChoice exactly as before", () => {
    const parsed = parseSessionLog({ text: spawnedLine({}) });
    expect(parsed.unreadable).toStrictEqual([]);
    expect(parsed.events).toStrictEqual([
      {
        branch: "s",
        cwd: "/w/s",
        kind: "spawned",
        sessionKey: "s",
        surfaceRef: "surface:1",
        tsIso: "2026-11-05T10:00:00.000Z",
        workspaceRef: "workspace:9",
      },
    ]);
    expect(foldSessions({ events: parsed.events })[0]!.planChoice).toBe(undefined);
  });

  it("rejects the line when a present planChoice is malformed, rather than reading it without one", () => {
    const parsed = parseSessionLog({ text: spawnedLine({ planChoice: { ...ROUTED, reason: "seat-1@example.test" } }) });
    expect(parsed.events).toStrictEqual([]);
    expect(parsed.unreadable).toStrictEqual([1]);
  });
});
