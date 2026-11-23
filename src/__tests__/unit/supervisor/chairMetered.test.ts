/**
 * The metered chair judgement: which readings refuse, which only print, and the exact lines each one prints.
 */
import { describe, expect, it } from "vitest";

import { type ChairMeteredSession, judgeChairMetered } from "../../../supervisor/chairMetered.js";

/** The metered chair at the end of the incident. */
const METERED: ChairMeteredSession = {
  pid: 222,
  sessionId: "a0000038-0000-4000-8000-000000000041",
  verdict: {
    dollars: 7.38025375,
    firstIso: "2026-09-17T13:39:02.089Z",
    kind: "metered-now",
    lastIso: "2026-09-17T13:40:58.040Z",
    requests: 4,
  },
};

/** A second tab in the same workspace, on a plan. */
const ON_PLAN: ChairMeteredSession = {
  pid: 333,
  sessionId: "s-plan",
  verdict: { kind: "plan", newestIso: "2026-09-17T13:47:39.139Z" },
};

describe("judgeChairMetered", () => {
  it("refuses a workspace holding a metered session, naming it with its dollars and leaving the plan tab out", () => {
    expect(
      judgeChairMetered({
        reading: { kind: "measured", sessions: [METERED, ON_PLAN], truncated: false, unprojected: 0 },
      }),
    ).toStrictEqual({
      detail:
        "1 of 2 session(s) in the pinned workspace spend on a metered Console organisation — their newest " +
        "api_request telemetry resolves no claude.ai organisation",
      kind: "refused",
      lines: [
        "  session a0000038-0000-4000-8000-000000000041 (pid 222): METERED — $7.38 across 4 request(s), " +
          "2026-09-17T13:39:02.089Z..2026-09-17T13:40:58.040Z; org UNRESOLVED, email UNRESOLVED (a Console " +
          "credential resolves no claude.ai identity — that absence is the signal)",
      ],
    });
  });

  it("states the dollars as a floor when the page cap truncated the read", () => {
    const verdict = judgeChairMetered({
      reading: { kind: "measured", sessions: [METERED], truncated: true, unprojected: 0 },
    });

    expect(verdict.kind).toBe("refused");
    expect((verdict as { lines: readonly string[] }).lines[0]!).toContain("METERED — at least $7.38 across 4");
  });

  it("is clean and silent when every session is on a plan", () => {
    expect(
      judgeChairMetered({ reading: { kind: "measured", sessions: [ON_PLAN], truncated: false, unprojected: 0 } }),
    ).toStrictEqual({ kind: "clean", notes: [] });
  });

  it("names earlier metered spend without refusing a chair that is back on a plan", () => {
    const earlier: ChairMeteredSession = {
      ...METERED,
      verdict: {
        dollars: 7.38025375,
        firstIso: "2026-09-17T13:39:02.089Z",
        kind: "metered-earlier",
        lastIso: "2026-09-17T13:40:58.040Z",
        newestIso: "2026-09-17T13:47:39.139Z",
        requests: 4,
      },
    };

    expect(
      judgeChairMetered({ reading: { kind: "measured", sessions: [earlier], truncated: false, unprojected: 0 } }),
    ).toStrictEqual({
      kind: "clean",
      notes: [
        "metered check: session a0000038-0000-4000-8000-000000000041 (pid 222): metered EARLIER — $7.38 across 4 " +
          "request(s), 2026-09-17T13:39:02.089Z..2026-09-17T13:40:58.040Z; back on a plan organisation as of " +
          "2026-09-17T13:47:39.139Z",
      ],
    });
  });

  it("prints, never refuses, every way the telemetry could not describe a session", () => {
    const verdict = judgeChairMetered({
      reading: {
        kind: "measured",
        sessions: [
          { pid: 1, sessionId: "s1", verdict: { kind: "no-telemetry" } },
          {
            pid: 2,
            sessionId: "s2",
            verdict: { kind: "unmeasured", why: "its transcript names no prompt yet" },
          },
        ],
        truncated: false,
        unprojected: 2,
      },
    });

    expect(verdict).toStrictEqual({
      kind: "clean",
      notes: [
        "metered check: session s1 (pid 1) UNMEASURED — no api_request telemetry was found for its recent prompts",
        "metered check: session s2 (pid 2) UNMEASURED — its transcript names no prompt yet",
        "metered check: 2 telemetry event(s) did not project and were not judged",
      ],
    });
  });

  it("prints an unmeasured read whole", () => {
    expect(
      judgeChairMetered({ reading: { kind: "unmeasured", why: "Datadog credentials are not usable" } }),
    ).toStrictEqual({ kind: "clean", notes: ["metered check: UNMEASURED — Datadog credentials are not usable"] });
  });
});
