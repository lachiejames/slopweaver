/**
 * The effectful census read for one question, over a real census written into a throwaway home: no census
 * reads as nothing rather than an error, and a written one yields the services the question names plus the
 * census's age judged against the Datadog atlas's 24h freshness window at a fixed instant. Every Datadog host in
 * this file reads a synthetic site rather than the install's own.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Catalogue } from "../../../datadog/detective/catalogue.js";
import { writeCatalogue } from "../../../datadog/detective/store.js";
import { censusRouteReading, censusStaleAfterMs } from "../../../route/censusReadings.js";
import { stateHomePaths } from "../../../stateHome.js";

const homes: string[] = [];

/** A throwaway home, removed after the test that minted it. */
function mintHome(): string {
  const home = mkdtempSync(join(tmpdir(), "census-readings-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

const BUILT_MS = Date.parse("2026-09-16T02:05:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** A census built at {@link BUILT_MS} over the week before it, holding two services. */
function catalogue(): Catalogue {
  return {
    manifest: {
      builtAtIso: "2026-09-16T02:05:00.000Z",
      map: {
        dashboards: [],
        edges: [],
        entities: [],
        indexes: [{ name: "main", retentionDays: 15 }],
        metricNamespaces: [],
        monitors: [],
        pipelines: [],
        rumApplications: [],
      },
      notMeasured: [],
      products: [{ exemplified: 0, notMeasured: [], product: "logs", rows: 0 }],
      retentionDays: 15,
      rows: 0,
      schemaVersion: 2,
      services: [
        { events: 18_808_434, product: "logs", service: "jobs-api" },
        { events: 1_200, product: "logs", service: "billing-worker" },
      ],
      site: "ap1.datadoghq.com",
      window: { fromIso: "2026-09-09T02:05:00.000Z", toIso: "2026-09-16T02:05:00.000Z" },
    },
    rows: [],
  };
}

describe("censusStaleAfterMs", () => {
  it("is the Datadog atlas's declared 24h freshness window, in milliseconds", () => {
    expect(censusStaleAfterMs()).toBe(DAY_MS);
  });
});

describe("censusRouteReading", () => {
  it("is null on a home with no census built", () => {
    expect(censusRouteReading({ home: mintHome(), nowMs: BUILT_MS, question: "why is jobs-api down" })).toBe(null);
  });

  it("is null when the census manifest is there but is not JSON", () => {
    const home = mintHome();
    const manifestPath = stateHomePaths({ home }).datadogCatalogue.manifest;
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, "{ not json");

    expect(censusRouteReading({ home, nowMs: BUILT_MS, question: "why is jobs-api down" })).toBe(null);
  });

  it("names the one service the question names, with its events, and is fresh exactly at the window's edge", () => {
    const home = mintHome();
    writeCatalogue({ catalogue: catalogue(), home });

    const reading = censusRouteReading({ home, nowMs: BUILT_MS + DAY_MS, question: "Why is jobs-api erroring?" })!;

    expect(reading.reading).toEqual({ matches: [{ events: 18_808_434, service: "jobs-api", token: "jobs-api" }] });
    expect(reading.age.state).toBe("fresh");
    expect(reading.age.ageMs).toBe(DAY_MS);
  });

  it("is stale one millisecond past the window", () => {
    const home = mintHome();
    writeCatalogue({ catalogue: catalogue(), home });

    const reading = censusRouteReading({ home, nowMs: BUILT_MS + DAY_MS + 1, question: "billing-worker" })!;

    expect(reading.reading).toEqual({
      matches: [{ events: 1_200, service: "billing-worker", token: "billing-worker" }],
    });
    expect(reading.age.state).toBe("stale");
    expect(reading.age.ageMs).toBe(DAY_MS + 1);
  });

  it("reads no matches, with the age still judged, when the question names no service", () => {
    const home = mintHome();
    writeCatalogue({ catalogue: catalogue(), home });

    const reading = censusRouteReading({ home, nowMs: BUILT_MS, question: "who can I ask for support?" })!;

    expect(reading.reading).toEqual({ matches: [] });
    expect(reading.age.state).toBe("fresh");
    expect(reading.age.ageMs).toBe(0);
  });
});
