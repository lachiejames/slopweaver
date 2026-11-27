/** `session list`'s human line: the row, then the plan the spawn recorded, when it recorded one. */
import { describe, expect, it } from "vitest";

import { renderSession } from "../../../../../cli/commands/session/run.js";
import type { SessionPlanChoice } from "../../../../../sessions/planChoice.js";
import { foldSessions, type SessionEvent } from "../../../../../sessions/session.js";

const SPAWNED: SessionEvent = {
  branch: "s",
  cwd: "/w/s",
  kind: "spawned",
  sessionKey: "abc-1",
  surfaceRef: "surface:1",
  tsIso: "2026-11-05T10:00:00.000Z",
  workspaceRef: "workspace:9",
};

const CHOICE: SessionPlanChoice = {
  alias: "plan-two",
  basis: "requested",
  kind: "named",
  alternative: "--plan <alias> names another plan; omit --plan to route on live gauges",
  readings: [{ alias: "plan-two", reading: "all-models week 30%", state: "chosen" }],
  reason: "--plan named it; its own gauge allows it",
  vendor: "claude",
};

describe("renderSession", () => {
  it("prints a row with no recorded choice on one line, as before", () => {
    const [item] = foldSessions({ events: [SPAWNED] });
    expect(renderSession({ item: item! })).toBe("abc-1 — open  model=unrecorded  workspace:9");
  });

  it("prints the recorded choice indented under its row", () => {
    const [item] = foldSessions({ events: [{ ...SPAWNED, planChoice: CHOICE }] });
    expect(renderSession({ item: item! })).toBe(
      "abc-1 — open  model=unrecorded  workspace:9\n" +
        "    plan: plan-two (claude, requested) — --plan named it; its own gauge allows it; readings: plan-two chosen " +
        "(all-models week 30%); alternative: --plan <alias> names another plan; omit --plan to route on live gauges",
    );
  });
});
