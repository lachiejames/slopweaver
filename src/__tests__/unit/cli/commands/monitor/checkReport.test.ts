import { describe, expect, it } from "vitest";

import { reportPass } from "../../../../../cli/commands/monitor/checkReport.js";
import type { PassOutcome } from "../../../../../monitor/pass.js";

const OUTCOME: PassOutcome = {
  actions: [
    {
      detail: "posted, floating",
      kind: "posted",
      monitorId: "claude-plan-unusable",
      stepId: "mon-claude-plan-two-1a2b3c4d",
    },
  ],
  readings: [
    {
      monitorId: "claude-plan-unusable",
      state: "firing",
      subjects: [
        {
          details: ["STORE_NOT_READY since 2026-10-31T06:22:53.000Z"],
          id: "plan-two",
          key: "plan-two-1a2b3c4d",
          label: "it is signed out — its store holds no sign-in",
        },
      ],
    },
    { because: "the plan register could not be read", monitorId: "codex-plan-signed-out", state: "unmeasurable" },
    { monitorId: "fleet-unhealthy", state: "clear" },
  ],
};

/** The lines one report prints. */
function printed({ json, outcome }: { json: boolean; outcome: PassOutcome }): readonly string[] {
  const lines: string[] = [];
  reportPass({ json, outcome, writeOut: (line) => lines.push(line) });
  return lines;
}

describe("reportPass", () => {
  it("prints every reading, the clear one included, then each action", () => {
    expect(printed({ json: false, outcome: OUTCOME })).toEqual([
      "claude-plan-unusable  FIRING over 1",
      "    plan-two — it is signed out — its store holds no sign-in",
      "      STORE_NOT_READY since 2026-10-31T06:22:53.000Z",
      "codex-plan-signed-out  UNMEASURABLE — the plan register could not be read",
      "fleet-unhealthy  clear",
      "  posted mon-claude-plan-two-1a2b3c4d: posted, floating",
    ]);
  });

  it("prints a clear reading's evidence under its clear line, so the maths is readable when nothing fires", () => {
    const outcome: PassOutcome = {
      actions: [],
      readings: [
        {
          evidence: ["Codex, projected at 90%", "codex-one: 48% used"],
          monitorId: "host-week-runs-out",
          state: "clear",
        },
      ],
    };
    expect(printed({ json: false, outcome })).toEqual([
      "host-week-runs-out  clear",
      "      Codex, projected at 90%",
      "      codex-one: 48% used",
      "monitor check: nothing arrived and nothing cleared",
    ]);
  });

  it("says a pass that did nothing did nothing", () => {
    expect(printed({ json: false, outcome: { actions: [], readings: [] } })).toEqual([
      "monitor check: nothing arrived and nothing cleared",
    ]);
  });

  it("prints the one machine document under --json", () => {
    expect(printed({ json: true, outcome: OUTCOME })).toEqual([
      JSON.stringify({ actions: OUTCOME.actions, readings: OUTCOME.readings }),
    ]);
  });
});
