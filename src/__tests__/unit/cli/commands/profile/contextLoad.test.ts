/**
 * `loadContextIntoCache` is a forwarding wrapper: it derives the cache path from the home, passes the bound
 * and the instant through untouched, and returns — or rejects with — whatever the loader does. A recording
 * fake loader stands in for the store, and the instant is a fixed string rather than the real clock.
 */
import { describe, expect, it } from "vitest";

import { loadContextIntoCache } from "../../../../../cli/commands/profile/contextLoad.js";
import type { LoadedContext } from "../../../../../context/load.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const HOME = "/state/home";
const NOW = "2026-10-13T09:00:00.000Z";
const LOADED: LoadedContext = { lines: ["## About the owner", "- prefers terse"], origin: "cache", reason: "no store" };

/** One call the loader received. */
interface LoadCall {
  readonly boundMs: number;
  readonly cachePath: string;
  readonly nowIso: string;
}

describe("loadContextIntoCache", () => {
  it("calls the loader with the bound, the home's context cache path and the instant, and returns its result", async () => {
    const calls: LoadCall[] = [];

    const loaded = await loadContextIntoCache({
      boundMs: 1500,
      home: HOME,
      load: (call) => {
        calls.push(call);
        return Promise.resolve(LOADED);
      },
      nowIso: NOW,
    });

    expect(loaded).toBe(LOADED);
    expect(calls).toEqual([
      { boundMs: 1500, cachePath: stateHomePaths({ home: HOME }).profileContextJson, nowIso: NOW },
    ]);
    expect(calls[0]!.cachePath).toBe("/state/home/profile/context.json");
  });

  it("forwards a zero bound as zero rather than reinterpreting it", async () => {
    const bounds: number[] = [];

    await loadContextIntoCache({
      boundMs: 0,
      home: HOME,
      load: ({ boundMs }) => {
        bounds.push(boundMs);
        return Promise.resolve(LOADED);
      },
      nowIso: NOW,
    });

    expect(bounds).toEqual([0]);
  });

  it("rejects with the loader's own error, owning no fallback of its own", async () => {
    const broken = new Error("cache directory unwritable");

    await expect(
      loadContextIntoCache({ boundMs: 1500, home: HOME, load: () => Promise.reject(broken), nowIso: NOW }),
    ).rejects.toBe(broken);
  });
});
