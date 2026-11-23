import { describe, expect, it } from "vitest";

import { type ResyncClockDeps, readResyncClock } from "../../../../live/resync/clock.js";

/**
 * What the store read answers. Derived from the seam rather than imported from `store/newest.ts`, which this
 * file does not test, so the untested-modules gate does not credit that module with coverage it lacks.
 */
type StoreAnswer = Awaited<ReturnType<ResyncClockDeps["readStoreNewest"]>>;

const MANIFEST = "/home-alpha/atlas/alpha/manifest.json";

/**
 * Plain edges that record every call; the store answers `storeAnswer` and the atlas edge resolves only the
 * platform named "alpha".
 *
 * @returns the edges and the calls each received
 */
function recordingDeps({ storeAnswer }: { storeAnswer: StoreAnswer }): {
  readonly deps: ResyncClockDeps;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      atlasPathsFor: ({ home, platform }) => {
        calls.push(`paths ${String(home)} ${platform}`);
        if (platform !== "alpha") {
          return null;
        }
        return { kinds: {}, manifest: MANIFEST, root: "/home-alpha/atlas/alpha", superseded: "/s" };
      },
      generationClock: ({ manifestPath }) => {
        calls.push(`generation ${manifestPath}`);
        return "2026-10-01T00:00:00.000Z";
      },
      readStoreNewest: ({ home, sources }) => {
        calls.push(`store ${home} ${sources.join(",")}`);
        return Promise.resolve(storeAnswer);
      },
    },
  };
}

describe("readResyncClock", () => {
  it("answers null for the gold source without reading anything", async () => {
    const recorded = recordingDeps({ storeAnswer: new Map() });
    const clock = await readResyncClock({
      deps: recorded.deps,
      home: "/home-alpha",
      target: { kind: "corpus", source: "gold" },
    });
    expect(clock).toBe(null);
    expect(recorded.calls).toEqual([]);
  });

  it("reads a corpus source's clock off the store's newest row for that one source", async () => {
    const recorded = recordingDeps({ storeAnswer: new Map([["linear", "2026-09-12T04:47:00.000Z"]]) });
    const clock = await readResyncClock({
      deps: recorded.deps,
      home: "/home-alpha",
      target: { kind: "corpus", source: "linear" },
    });
    expect(clock).toBe("2026-09-12T04:47:00.000Z");
    expect(recorded.calls).toEqual(["store /home-alpha linear"]);
  });

  it("answers null when the store keys the source with no row, as an empty or unreachable store does", async () => {
    const recorded = recordingDeps({ storeAnswer: new Map([["slack", null]]) });
    const clock = await readResyncClock({
      deps: recorded.deps,
      home: "/home-alpha",
      target: { kind: "corpus", source: "slack" },
    });
    expect(clock).toBe(null);
  });

  it("throws, naming the source, when the store answers no entry at all for it", async () => {
    const recorded = recordingDeps({ storeAnswer: new Map([["slack", "2026-09-12T04:47:00.000Z"]]) });
    await expect(
      readResyncClock({ deps: recorded.deps, home: "/home-alpha", target: { kind: "corpus", source: "github" } }),
    ).rejects.toThrow('readStoreNewest answered no entry for the requested source "github"');
  });

  it("reads an atlas's clock off its published manifest", async () => {
    const recorded = recordingDeps({ storeAnswer: new Map() });
    const clock = await readResyncClock({
      deps: recorded.deps,
      home: "/home-alpha",
      target: { kind: "atlas", platform: "alpha" },
    });
    expect(clock).toBe("2026-10-01T00:00:00.000Z");
    expect(recorded.calls).toEqual(["paths /home-alpha alpha", `generation ${MANIFEST}`]);
  });

  it("answers null for an atlas platform no registration names, without reading a manifest", async () => {
    const recorded = recordingDeps({ storeAnswer: new Map() });
    const clock = await readResyncClock({
      deps: recorded.deps,
      home: "/home-alpha",
      target: { kind: "atlas", platform: "bravo" },
    });
    expect(clock).toBe(null);
    expect(recorded.calls).toEqual(["paths /home-alpha bravo"]);
  });
});
