import { describe, expect, it } from "vitest";

import { DATADOG_CONSOLE_ROUTES } from "../../../../atlas/datadog/consolePages.js";
import { DATADOG_ATLAS_DESCRIPTOR } from "../../../../atlas/datadog/descriptor.js";
import { DATADOG_CHANNELS } from "../../../../atlas/datadog/documents.js";
import { DATADOG_KINDS } from "../../../../atlas/datadog/model.js";
import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";

const descriptor = DATADOG_ATLAS_DESCRIPTOR;

describe("DATADOG_ATLAS_DESCRIPTOR", () => {
  it("names one platform, never a surface", () => {
    expect(descriptor.platform).toBe("datadog");
  });

  it("declares three surfaces, so neither the compiled catalogue nor the console is a silence", () => {
    expect(descriptor.surfaces.map((surface) => surface.acquisition)).toStrictEqual([
      "compiled",
      "api",
      "driven-browser",
    ]);
  });

  // The R3 counterexample: the descriptor said `rest-api` while the schema admitted only `api`, so a
  // stored observation's `source.surface` would have pointed at a surface the catalogue never declared.
  // A test over `acquisition` values passed straight through it, which is why this one compares NAMES.
  it("names each surface exactly as documents.ts names its channel", () => {
    expect(descriptor.surfaces.map((surface) => surface.name)).toStrictEqual([...DATADOG_CHANNELS]);
  });

  it("claims NO filled surface yet, because no sync and no walk has run", () => {
    expect(unfilledSurfaces({ descriptor }).length).toBe(3);
    expect(hasFilledBrowserSurface({ descriptor })).toBe(false);
  });

  it("says why each surface is unfilled, so the state is a statement rather than a silence", () => {
    expect(descriptor.surfaces.filter((surface) => surface.unfilledBecause === null)).toStrictEqual([]);
  });

  // The whole browser surface is wanted, never a subset. The failure this guards is a descriptor that quietly drops the browser half, or that reports a
  // denominator it does not have — so the console surface must be declared, must divide by the live nav's
  // own page count, and must name the walk that fills it.
  it("declares the console surface against the live left nav, and names the walk that fills it", () => {
    const consoleSurface = descriptor.surfaces.find((surface) => surface.acquisition === "driven-browser")!;

    expect(consoleSurface.name).toBe("console");
    expect(consoleSurface.denominator).toStrictEqual({
      exists: DATADOG_CONSOLE_ROUTES.length,
      known: true,
      reached: 0,
      source: expect.stringContaining("read live in the owner's Chrome on 2026-09-16"),
    });
    expect(consoleSurface.unfilledBecause).toContain("slopweaver atlas datadog walk");
    expect(consoleSurface.unfilledBecause).toContain("The denominator is settled");
  });

  // The denominator is the owner's accepted one, not a sitemap: the reason says so rather than claiming
  // parity with a provider-published list, so the next session is not sent looking for one.
  it("says the denominator is the live nav the owner accepted, never a sitemap Datadog does not publish", () => {
    const consoleSurface = descriptor.surfaces.find((surface) => surface.acquisition === "driven-browser")!;

    expect(consoleSurface.unfilledBecause).toContain("Datadog publishes no sitemap");
    expect(consoleSurface.unfilledBecause).toContain("LIVE left nav");
  });

  it("resyncs the surface map and then rebuilds the census the detectives match against", () => {
    expect(descriptor.resyncCommand).toBe(
      "slopweaver atlas datadog sync && slopweaver datadog catalogue build --from 7d",
    );
  });

  it("declares every kind the model publishes, in the model's own order", () => {
    expect(descriptor.kinds).toStrictEqual([...DATADOG_KINDS]);
  });

  it("states what it deliberately does NOT hold, which is the fact a reader needs most", () => {
    expect(descriptor.excludes.length).toBe(6);
    expect(descriptor.excludes.filter((entry) => entry.because.length === 0)).toStrictEqual([]);
  });

  it("names the voluminous scope rule in its exclusions, because that is the owner's own cut", () => {
    const voluminous = descriptor.excludes.filter((entry) =>
      entry.because.includes("everything reachable minus the voluminous"),
    );
    expect(voluminous.length).toBe(1);
  });
});
