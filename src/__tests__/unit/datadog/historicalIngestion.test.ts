import { client } from "@datadog/datadog-api-client";
import { describe, expect, it } from "vitest";

import {
  DatadogHmiErrors,
  enableHmi,
  type HmiApi,
  type HmiState,
  isAbsentConfiguration,
  metricsStillOff,
  planHmiEnable,
  readHmiStates,
  validateMetricNames,
} from "../../../datadog/historicalIngestion.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const TURNS = "trajectory.task.turns";
const RISK = "trajectory.task.risk_score";
const SDLC = "sdlc.v1.pr.merged_daily";

/**
 * A fake Datadog whose HMI settings are a set: `get` answers from it, `create` adds to it. `refuse` names a
 * metric whose create throws, `sticky` one whose create is accepted and changes nothing (the V2 console's
 * gotcha), `unreadable` one whose lookup throws a 403, and `unknown` one Datadog has never received, whose
 * create answers 404.
 */
function fakeApi({
  on,
  refuse = [],
  sticky = [],
  unreadable = [],
  unknown = [],
}: {
  on: readonly string[];
  refuse?: readonly string[];
  sticky?: readonly string[];
  unreadable?: readonly string[];
  unknown?: readonly string[];
}): { api: HmiApi; created: string[] } {
  const enabled = new Set(on);
  const created: string[] = [];
  return {
    api: {
      create: ({ metric }) => {
        if (refuse.includes(metric)) {
          return Promise.reject(new client.ApiException(403, { errors: ["Forbidden"] }));
        }
        if (unknown.includes(metric)) {
          return Promise.reject(new client.ApiException(404, { errors: [{ detail: `${metric} not found` }] }));
        }
        created.push(metric);
        if (!sticky.includes(metric)) {
          enabled.add(metric);
        }
        return Promise.resolve();
      },
      get: ({ metric }) => {
        if (unreadable.includes(metric)) {
          return Promise.reject(new client.ApiException(403, { errors: ["Forbidden"] }));
        }
        return Promise.resolve(
          enabled.has(metric) ? { createdIso: "2026-07-29T23:33:02.845Z", found: true } : { found: false },
        );
      },
    },
    created,
  };
}

describe("validateMetricNames", () => {
  it("keeps valid names in the order given and drops repeats", () => {
    expect(unwrap(validateMetricNames({ names: [TURNS, RISK, TURNS] }))).toEqual([TURNS, RISK]);
  });

  it("names every invalid name at once", () => {
    const error = unwrapErr(validateMetricNames({ names: [TURNS, "9lives", "a/b"] }));
    expect(error.code).toBe("METRIC_NAME_INVALID");
    expect(error).toEqual(DatadogHmiErrors.metricNameInvalid({ names: ["9lives", "a/b"] }));
  });

  it("refuses a name past Datadog's 200-character limit", () => {
    const error = unwrapErr(validateMetricNames({ names: [`a${"b".repeat(200)}`] }));
    expect(error.code).toBe("METRIC_NAME_INVALID");
  });
});

describe("planHmiEnable", () => {
  it("enables only what is off", () => {
    const states: HmiState[] = [
      { createdIso: "2026-07-29T23:33:02.845Z", enabled: true, metric: SDLC },
      { enabled: false, metric: TURNS },
    ];
    expect(planHmiEnable({ states })).toEqual({ alreadyOn: [SDLC], toEnable: [TURNS] });
  });

  it("plans nothing for an empty list", () => {
    expect(planHmiEnable({ states: [] })).toEqual({ alreadyOn: [], toEnable: [] });
  });
});

describe("metricsStillOff", () => {
  it("names the metrics a read-back finds off", () => {
    const states: HmiState[] = [
      { createdIso: null, enabled: true, metric: SDLC },
      { enabled: false, metric: TURNS },
    ];
    expect(metricsStillOff({ states })).toEqual([TURNS]);
  });
});

describe("readHmiStates", () => {
  it("reads a found configuration as on and an absent one as off", async () => {
    const { api } = fakeApi({ on: [SDLC] });
    expect(unwrap(await readHmiStates({ api, metrics: [SDLC, TURNS] }))).toEqual([
      { createdIso: "2026-07-29T23:33:02.845Z", enabled: true, metric: SDLC },
      { enabled: false, metric: TURNS },
    ]);
  });

  it("refuses to call an unreadable setting off", async () => {
    const { api } = fakeApi({ on: [], unreadable: [RISK] });
    const error = unwrapErr(await readHmiStates({ api, metrics: [TURNS, RISK] }));
    expect(error.code).toBe("READ_FAILED");
    expect(error.message).toContain(`for ${RISK}: HTTP 403`);
  });
});

describe("enableHmi", () => {
  it("creates each planned metric in order", async () => {
    const { api, created } = fakeApi({ on: [] });
    expect(unwrap(await enableHmi({ api, metrics: [TURNS, RISK] }))).toEqual([TURNS, RISK]);
    expect(created).toEqual([TURNS, RISK]);
  });

  it("stops at a refusal and names what it had already enabled", async () => {
    const { api, created } = fakeApi({ on: [], refuse: [RISK] });
    const error = unwrapErr(await enableHmi({ api, metrics: [TURNS, RISK, SDLC] }));
    expect(error).toEqual(
      DatadogHmiErrors.enableRejected({
        cause: new client.ApiException(403, { errors: ["Forbidden"] }),
        enabledBefore: [TURNS],
        metric: RISK,
      }),
    );
    expect(created).toEqual([TURNS]);
  });

  it("names a metric Datadog has never received, distinct from a refusal", async () => {
    const { api } = fakeApi({ on: [], unknown: [RISK] });
    expect(unwrapErr(await enableHmi({ api, metrics: [TURNS, RISK] }))).toEqual(
      DatadogHmiErrors.metricUnknown({ enabledBefore: [TURNS], metric: RISK }),
    );
  });

  it("an accepted create that changed nothing is caught by the read-back, not by the create", async () => {
    const { api } = fakeApi({ on: [], sticky: [RISK] });
    expect(unwrap(await enableHmi({ api, metrics: [TURNS, RISK] }))).toEqual([TURNS, RISK]);
    const after = unwrap(await readHmiStates({ api, metrics: [TURNS, RISK] }));
    expect(metricsStillOff({ states: after })).toEqual([RISK]);
  });
});

describe("isAbsentConfiguration", () => {
  it("reads only an SDK 404 as an absent configuration", () => {
    expect(isAbsentConfiguration({ cause: new client.ApiException(404, { errors: ["not found"] }) })).toBe(true);
    expect(isAbsentConfiguration({ cause: new client.ApiException(403, { errors: ["Forbidden"] }) })).toBe(false);
    expect(isAbsentConfiguration({ cause: new Error("404") })).toBe(false);
  });
});
