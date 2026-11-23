/**
 * `atlasPlatformManifestRow` in `cli/manifests/atlasPlatformMeta.ts` builds every generic atlas platform's manifest
 * row from its registration. This pins the pure half over two typed fixtures, one that answers `reset` and one that
 * does not: the six classification fields, where the summary, example and door come from, and the exact usage block.
 * Every thunk on a fixture is a plain fake that is never called, and the returned entry's loader is never awaited —
 * `devLint/manifestLoaderTests.ts` owns loader resolution.
 */
import { describe, expect, it } from "vitest";

import type { AtlasPlatformRegistration } from "../../../../atlas/registry.js";
import {
  ATLAS_KIT_FLAG_LINES,
  ATLAS_READ_COVERAGE_USAGE_LINES,
  ATLAS_RESET_USAGE_LINES,
  atlasPlatformManifestRow,
} from "../../../../cli/manifests/atlasPlatformMeta.js";
import { classificationOf } from "./_classification.js";

const neverCalled = (): Promise<never> => Promise.reject(new Error("a fixture thunk was called"));

const PLAIN: AtlasPlatformRegistration = {
  catalogue: { doorRouted: false, example: "slopweaver atlas fixture-plain read --json", summary: null },
  platform: "fixture-plain",
  readDescriptor: neverCalled,
  readSnapshot: neverCalled,
  verbs: [
    { describe: "sync the fixture", load: neverCalled, usage: ["sync [--json] [--home <dir>]"], verb: "sync" },
    {
      describe: "walk the fixture",
      load: neverCalled,
      usage: ["walk [--depth <n>]", "     [--json]"],
      verb: "walk",
    },
  ],
};

const WITH_RESET: AtlasPlatformRegistration = {
  catalogue: {
    doorRouted: true,
    example: "slopweaver atlas fixture-reset sync",
    summary: "The fixture-reset atlas holds fixture rows.",
  },
  platform: "fixture-reset",
  readDescriptor: neverCalled,
  readReset: neverCalled,
  readSnapshot: neverCalled,
  verbs: [{ describe: "list controls", load: neverCalled, usage: ["controls [--json]"], verb: "controls" }],
};

describe("atlasPlatformManifestRow", () => {
  it("classifies a platform row local-state, diagnostic and parse-safe, taking only the door from its catalogue entry", () => {
    const plain = atlasPlatformManifestRow({ registration: PLAIN });
    const withReset = atlasPlatformManifestRow({ registration: WITH_RESET });

    expect({ plain: classificationOf({ entry: plain }), withReset: classificationOf({ entry: withReset }) }).toEqual({
      plain: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      withReset: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: true,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("takes the example from the registration and states the generic kit summary when the catalogue declares none", () => {
    const plain = atlasPlatformManifestRow({ registration: PLAIN });

    expect(plain.meta.example).toBe("slopweaver atlas fixture-plain read --json");
    expect(plain.meta.summary).toContain("The fixture-plain atlas: `read` its stored entities");
  });

  it("takes the summary and example verbatim from a catalogue entry that declares them", () => {
    const withReset = atlasPlatformManifestRow({ registration: WITH_RESET });

    expect(withReset.meta.example).toBe("slopweaver atlas fixture-reset sync");
    expect(withReset.meta.summary).toBe("The fixture-reset atlas holds fixture rows.");
  });

  it("prints the sorted vocabulary without reset, then the read, kit and own lines, for a platform with no readReset", () => {
    const plain = atlasPlatformManifestRow({ registration: PLAIN });

    expect(plain.meta.usage).toBe(
      "usage: slopweaver atlas fixture-plain <coverage | read | render | restore | sync | walk>\n" +
        ATLAS_READ_COVERAGE_USAGE_LINES +
        ATLAS_KIT_FLAG_LINES +
        "  sync [--json] [--home <dir>]\n" +
        "  walk [--depth <n>]\n" +
        "       [--json]",
    );
    expect(plain.meta.usage.includes("reset")).toBe(false);
  });

  it("adds reset to the vocabulary and its flag tail exactly once for a platform with a readReset", () => {
    const withReset = atlasPlatformManifestRow({ registration: WITH_RESET });

    expect(withReset.meta.usage).toBe(
      "usage: slopweaver atlas fixture-reset <controls | coverage | read | render | reset | restore>\n" +
        ATLAS_READ_COVERAGE_USAGE_LINES +
        ATLAS_KIT_FLAG_LINES +
        ATLAS_RESET_USAGE_LINES +
        "  controls [--json]",
    );
    expect(withReset.meta.usage.split(ATLAS_RESET_USAGE_LINES).length - 1).toBe(1);
  });

  it("ends the usage block without a trailing newline and hands back a loader without calling it", () => {
    const plain = atlasPlatformManifestRow({ registration: PLAIN });

    expect(plain.meta.usage.endsWith("\n")).toBe(false);
    expect(plain.load).toBeInstanceOf(Function);
  });
});
