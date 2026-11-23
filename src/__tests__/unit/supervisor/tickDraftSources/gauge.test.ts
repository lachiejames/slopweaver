/** The `claude gauge --json` document turned into the tick's gauge observation. */
import { describe, expect, it } from "vitest";

import { planGauge, quietGaugeDocument } from "../tickDraftDocumentsFixture.js";
import {
  CAPTURED,
  diagnosticOf,
  factsOf,
  redirected,
  refusalFor,
  sourcesWith,
  verbatimOf,
} from "../tickDraftSourcesFixture.js";

describe("draftTickSources — gauge", () => {
  it("keeps only complete plan rows, names what it left out, and takes the producer's own alert lines", () => {
    const document = quietGaugeDocument({
      fleetWide: true,
      nextAllModels: "plan-three",
      nextFable: "plan-three",
      nowIso: "2026-09-12T21:20:00.000Z",
      outcomes: [
        { alias: "plan-two", gauge: planGauge({ alias: "plan-two", fable: 0.52, week: 1 }) },
        { alias: "plan-three", gauge: planGauge({ alias: "plan-three", fable: undefined, week: 0.36 }) },
        { alias: "plan-four", problem: "the provider REFUSED `plan-four`'s stored credential with HTTP 401" },
      ],
    });
    const sources = sourcesWith({ capture: redirected({ path: "gauge.json", value: document }), kind: "gauge" });
    const facts = factsOf({ observation: sources.gauge });

    expect(sources.gauge.status).toBe("partial");
    expect(sources.gauge.observedAtIso).toBe("2026-09-12T21:20:00.000Z");
    expect(facts.plans).toStrictEqual([
      {
        fablePct: 52,
        fableResetsIso: "2026-09-17T19:00:00.000Z",
        fiveHourPct: 13,
        fiveHourResetsIso: "2026-09-17T19:00:00.000Z",
        plan: "plan-two",
        resetsIso: "2026-09-17T19:00:00.000Z",
        usageLimitPercent: 100,
        weekPct: 100,
      },
    ]);
    expect(facts.weekOnlyPlans).toStrictEqual([{ plan: "plan-three", usageLimitPercent: 100, weekPct: 36 }]);
    expect(facts.nextFable).toBe("plan-three");
    expect(facts.reactNowLines.length).toBe(1);
    expect(facts.reactNowLines[0]).toContain("REACT NOW — plan-two week at 100%");
    expect(diagnosticOf({ observation: sources.gauge })).toBe(
      "plan-three carried no Fable week window, so it has no complete row; plan-four was not read: the provider REFUSED `plan-four`'s stored credential with HTTP 401",
    );
    expect(verbatimOf({ observation: sources.gauge })).toContain("acceptance:");
  });

  it("is unavailable — not an empty plan list — when no plan could be read at all", () => {
    const document = quietGaugeDocument({
      fleetWide: true,
      nowIso: "2026-09-12T21:20:00.000Z",
      outcomes: [
        { alias: "plan-one", problem: "the provider REFUSED `plan-one`'s stored credential with HTTP 401" },
        { alias: "plan-two", problem: "the provider REFUSED `plan-two`'s stored credential with HTTP 401" },
      ],
    });
    const sources = sourcesWith({ capture: redirected({ path: "gauge.json", value: document }), kind: "gauge" });

    expect(sources.gauge.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.gauge })).toContain(
      "no plan in gauge.json yielded a complete reading, so the fleet's budgets are unknown",
    );
  });

  it("is PARTIAL, naming the gap, when every plan was READ but none carried a complete row", () => {
    const document = quietGaugeDocument({
      fleetWide: true,
      nextAllModels: "plan-one",
      nowIso: "2026-09-12T21:20:00.000Z",
      outcomes: [
        { alias: "plan-one", gauge: planGauge({ alias: "plan-one", fable: undefined, week: 0.52 }) },
        { alias: "plan-two", gauge: planGauge({ alias: "plan-two", fable: undefined, week: 0.4 }) },
      ],
    });
    const sources = sourcesWith({ capture: redirected({ path: "gauge.json", value: document }), kind: "gauge" });

    expect(sources.gauge.status).toBe("partial");
    expect(factsOf({ observation: sources.gauge }).plans).toStrictEqual([]);
    expect(diagnosticOf({ observation: sources.gauge })).toBe(
      "no plan in gauge.json yielded a complete reading, so the fleet's budgets are unknown: plan-one carried no Fable week window, so it has no complete row; plan-two carried no Fable week window, so it has no complete row",
    );
  });

  it("refuses an ambient credential kind outside the producer's own vocabulary", () => {
    const document = quietGaugeDocument({
      fleetWide: true,
      nextAllModels: "plan-one",
      nowIso: "2026-09-12T21:20:00.000Z",
      outcomes: [{ alias: "plan-one", gauge: planGauge({ alias: "plan-one", fable: 0.75, week: 0.52 }) }],
    });
    const refusal = refusalFor({
      capture: redirected({ path: "gauge.json", value: { ...document, ambient: { kind: "borrowed", reason: "r" } } }),
      kind: "gauge",
    });

    expect(refusal[0]).toBe("--gauge gauge.json is not a `slopweaver claude gauge --json` document:");
    expect(refusal[1]).toContain("ambient.kind");
  });

  it("is unavailable on a narrowed read, because no balance means no known next spawn", () => {
    const document = quietGaugeDocument({
      fleetWide: false,
      nowIso: "2026-09-12T21:20:00.000Z",
      outcomes: [{ alias: "plan-one", gauge: planGauge({ alias: "plan-one", fable: 0.75, week: 0.52 }) }],
    });
    const sources = sourcesWith({ capture: redirected({ path: "gauge.json", value: document }), kind: "gauge" });

    expect(sources.gauge.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.gauge })).toContain("narrowed gauge read");
  });

  it("is unavailable when the document was captured before this tick started", () => {
    const document = quietGaugeDocument({
      fleetWide: true,
      nextAllModels: "plan-one",
      nowIso: "2026-09-12T20:00:00.000Z",
      outcomes: [{ alias: "plan-one", gauge: planGauge({ alias: "plan-one", fable: 0.75, week: 0.52 }) }],
    });
    const sources = sourcesWith({ capture: redirected({ path: "gauge.json", value: document }), kind: "gauge" });

    expect(sources.gauge.status).toBe("unavailable");
    expect(sources.gauge.observedAtIso).toBe(CAPTURED);
    expect(diagnosticOf({ observation: sources.gauge })).toBe(
      "--gauge gauge.json was captured at 2026-09-12T20:00:00.000Z, before this tick started at 2026-09-12T21:18:42.000Z: a reading from another tick is not recorded as this one's",
    );
  });
});
