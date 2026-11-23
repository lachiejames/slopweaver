import { describe, expect, it } from "vitest";

import { classifySurfaces } from "../../../appSurfaces/classify.js";
import type { ModuleTaint } from "../../../appSurfaces/taint.js";

/** A module that imports the package and uses it in its own statements. */
const SEED: ModuleTaint = { exports: new Set(), from: new Set(), seed: true, sideEffect: true, used: true };

/** Two unimported seeds: an app's start-up module, and a library module nothing in the checkout loads. */
const { surfaces, deadEnds } = classifySurfaces({
  input: {
    factsOf: () => undefined,
    importersOf: () => [],
    routeModules: [],
    state: new Map([
      ["apps/server/src/main.ts", SEED],
      ["packages/lib/src/unused.ts", SEED],
    ]),
    tracked: new Set([
      "apps/server/package.json",
      "apps/server/src/main.ts",
      "packages/lib/package.json",
      "packages/lib/src/unused.ts",
    ]),
  },
});

describe("classifySurfaces roots", () => {
  it("reads an unimported start-up module as its app at start-up", () => {
    expect(surfaces.map((surface) => [surface.kind, surface.where])).toEqual([
      ["root", "server at start-up (src/main.ts)"],
    ]);
  });

  it("calls an unimported library module a dead end, since no app loads it", () => {
    expect(deadEnds).toEqual([
      {
        module: "packages/lib/src/unused.ts",
        why: "nothing in the checkout imports this library module, so no app loads it",
      },
    ]);
  });
});
