/*
 * `narrowOrReport` driven directly: each selected source's refresh slot is taken through an injected seam, and
 * a run whose every source was dropped answers NOT YET rather than success.
 */
import { describe, expect, it } from "vitest";
import { parseRefreshOptions } from "../../../../../cli/commands/refresh/core.js";
import type { RefreshDeps } from "../../../../../cli/commands/refresh/deps.js";
import { narrowOrReport } from "../../../../../cli/commands/refresh/slotNarrowing.js";
import { EXIT_DEFERRED } from "../../../../../cli/exitCodes.js";
import type { CorpusSource } from "../../../../../corpus/types.js";
import { unwrap } from "../../../../../lib/result.js";
import { fakeDeps } from "./runFakes.js";

const HOLDER = { ceilingMib: 4096, pid: 99, startedAtIso: "2026-07-20T00:00:00.000Z" };

/** A slot seam that refuses every source in `held` and admits the rest. */
function slotSeam({ held }: { held: readonly string[] }): NonNullable<RefreshDeps["acquireRefreshSlot"]> {
  return ({ source }) => {
    if (held.includes(source)) {
      return { admitted: false, holders: [HOLDER], limit: 1, obstacles: [] };
    }
    return { admitted: true, inFlight: 1, limit: 1 };
  };
}

describe("narrowOrReport", () => {
  const options = unwrap(parseRefreshOptions({ rest: [] }));

  it("keeps every source whose slot it took", () => {
    const cap = fakeDeps({ withHydration: false });
    const deps: RefreshDeps = { ...cap.deps, acquireRefreshSlot: slotSeam({ held: [] }) };

    expect(narrowOrReport({ deps, options, sources: ["slack", "github"] })).toEqual({ admitted: ["slack", "github"] });
    expect(cap.errors).toEqual([]);
  });

  it("drops only the held source while another survives", () => {
    const cap = fakeDeps({ withHydration: false });
    const deps: RefreshDeps = { ...cap.deps, acquireRefreshSlot: slotSeam({ held: ["slack"] }) };

    expect(narrowOrReport({ deps, options, sources: ["slack", "github"] })).toEqual({ admitted: ["github"] });
  });

  it("answers NOT YET when every selected source was dropped", () => {
    const cap = fakeDeps({ withHydration: false });
    const deps: RefreshDeps = { ...cap.deps, acquireRefreshSlot: slotSeam({ held: ["slack"] }) };

    expect(narrowOrReport({ deps, options, sources: ["slack"] })).toEqual({ code: EXIT_DEFERRED });
    expect(cap.errors.at(-1)).toBe(
      "refresh: every selected source was dropped — each is already being refreshed by another process, or its slot could not be taken as said above — nothing to do here",
    );
  });

  it("passes an empty selection through untouched", () => {
    const cap = fakeDeps({ withHydration: false });
    const deps: RefreshDeps = { ...cap.deps, acquireRefreshSlot: slotSeam({ held: [] }) };
    const none: readonly CorpusSource[] = [];

    expect(narrowOrReport({ deps, options, sources: none })).toEqual({ admitted: [] });
  });
});
