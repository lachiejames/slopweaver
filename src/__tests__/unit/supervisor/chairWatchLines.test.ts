/**
 * {@link chairWatchLines}: one watch report as the lines a terminal prints — the status line first, naming the
 * successor's host and plan on a hand-off, then each section only when it has something to say.
 */
import { describe, expect, it } from "vitest";

import type { ChairWatchReport } from "../../../supervisor/chairWatch.js";
import { chairWatchLines } from "../../../supervisor/chairWatchLines.js";

/** A report with nothing to say beyond its status, overridden per case. */
function report(over: Partial<ChairWatchReport> = {}): ChairWatchReport {
  return {
    chair: { appSessionId: "app-1", kind: "app", sessionIds: ["s-1"] },
    notes: [],
    observedAtIso: "2026-11-27T00:00:00.000Z",
    overrides: [],
    readings: [],
    reasons: [],
    status: "stay",
    usage: { gaps: [], plans: [], sessions: [] },
    ...over,
  };
}

describe("chairWatchLines", () => {
  it("prints only the status line when every section is empty", () => {
    expect(chairWatchLines({ report: report() })).toEqual(["chair-watch: STAY — no measured reason to hand off"]);
  });

  it("names the successor's plan and host on a hand-off, then each section in order", () => {
    const lines = chairWatchLines({
      report: report({
        notes: ["one plan's reading is stale"],
        overrides: ["slopweaver supervisor hand-off-hold --reason <why>"],
        readings: [
          { alias: "plan-one", chair: true, reading: "week 91%", state: "measured", vendor: "claude" },
          { alias: "plan-two", chair: false, reading: "week 20%", state: "measured", vendor: "claude" },
        ],
        reasons: ["plan-one's week is past 90%"],
        status: "hand-off",
        successor: { alias: "plan-two", target: { kind: "claude" } },
      }),
    });
    expect(lines).toEqual([
      "chair-watch: HAND-OFF — 1 reason(s); successor on plan-two (claude)",
      "reasons:",
      "  - plan-one's week is past 90%",
      "plans:",
      "  plan-one (chair): measured — week 91%",
      "  plan-two: measured — week 20%",
      "notes:",
      "  - one plan's reading is stale",
      "overrides:",
      "  slopweaver supervisor hand-off-hold --reason <why>",
    ]);
  });

  it("names the host alone when routing picks the plan at spawn, or the successor is on the codex host", () => {
    const routed = chairWatchLines({
      report: report({ status: "hand-off", successor: { target: { kind: "claude" } } }),
    });
    const codex = chairWatchLines({ report: report({ status: "hand-off", successor: { target: { kind: "codex" } } }) });
    expect([routed[0], codex[0]]).toEqual([
      "chair-watch: HAND-OFF — 0 reason(s); successor on whichever claude plan routing picks at spawn",
      "chair-watch: HAND-OFF — 0 reason(s); successor on the codex host",
    ]);
  });

  it("says why no host can take it, and that the owner's hold is holding it back", () => {
    const lines = chairWatchLines({
      report: report({
        hold: { reason: "demo at three", sinceIso: "2026-11-26T22:00:00.000Z" },
        reasons: ["a", "b"],
        status: "held",
        successor: { target: { kind: "none", why: "every plan is spent" } },
      }),
    });
    expect(lines.slice(0, 1)).toEqual([
      "chair-watch: HELD — 2 reason(s) to hand off, held by the owner since 2026-11-26T22:00:00.000Z: demo at three",
    ]);
    const handOff = chairWatchLines({
      report: report({ status: "hand-off", successor: { target: { kind: "none", why: "every plan is spent" } } }),
    });
    expect(handOff[0]).toBe("chair-watch: HAND-OFF — 0 reason(s); successor none can take it — every plan is spent");
  });

  it("names the host a chair cannot be handed off from, and an unresolved chair's reason", () => {
    const cmux = chairWatchLines({
      report: report({ chair: { kind: "cmux", sessionIds: [], workspaceId: "w-1" }, status: "unsupported" }),
    });
    const unresolved = chairWatchLines({
      report: report({ chair: { kind: "unresolved", why: "no pinned workspace" }, status: "unmeasured" }),
    });
    const unjudged = chairWatchLines({ report: report({ status: "unmeasured" }) });
    expect([cmux[0], unresolved[0], unjudged[0]]).toEqual([
      "chair-watch: UNSUPPORTED — 0 reason(s) to hand off, but the chair is a cmux tab, which the control plane cannot hand off from",
      "chair-watch: UNMEASURED — the chair did not resolve: no pinned workspace",
      "chair-watch: UNMEASURED — the chair's cadence could not be judged; the notes say why",
    ]);
  });

  it("prints the usage section with a mismatch, a rate, each plan's app total beside the model host's, and gaps", () => {
    const lines = chairWatchLines({
      report: report({
        usage: {
          gaps: ["the register could not be read"],
          plans: [
            { alias: "plan-one", appTokens: 1200, modelHostReading: "measured: week 20%" },
            { alias: "unregistered", appTokens: 0 },
          ],
          sessions: [
            { mismatch: "asked for fable, ran opus", plan: "plan-one", sessionId: "s-1", tokensPerHour: 99.6 },
            { ranModel: "fable", sessionId: "s-2" },
          ],
        },
      }),
    });
    expect(lines.slice(1)).toEqual([
      "usage: 2 session(s), 1 on a model they did not ask for",
      "  s-1 on plan-one, MISMATCH asked for fable, ran opus, 100 tokens/h",
      "  s-2, fable",
      "  plan-one: 1200 tokens in the app; model host measured: week 20%",
      "  unregistered: 0 tokens in the app",
      "  gap: the register could not be read",
    ]);
  });
});
