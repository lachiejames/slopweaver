import { describe, expect, it } from "vitest";

import { parseRefreshOptions } from "../../../../../cli/commands/refresh/core.js";
import {
  refreshHome,
  refreshSlotAcquirer,
  refreshUntil,
  staleThresholdMs,
} from "../../../../../cli/commands/refresh/requestDefaults.js";
import { acquireRefreshSlot } from "../../../../../corpus/refreshSlot.js";
import { unwrap } from "../../../../../lib/result.js";

const BARE = unwrap(parseRefreshOptions({ rest: [] }));

describe("refreshHome", () => {
  it("answers the install's own home when --home was not given", () => {
    expect(refreshHome({ deps: { home: () => "/install/home" }, options: BARE })).toBe("/install/home");
  });

  it("answers --home when it was given", () => {
    const options = unwrap(parseRefreshOptions({ rest: ["--home", "/named/home"] }));
    expect(refreshHome({ deps: { home: () => "/install/home" }, options })).toBe("/named/home");
  });
});

describe("staleThresholdMs", () => {
  it("answers the shipped seven days when --stale-after was not given", () => {
    expect(staleThresholdMs({ options: BARE })).toBe(604_800_000);
  });

  it("answers --stale-after when it was given alongside --if-stale", () => {
    const options = unwrap(parseRefreshOptions({ rest: ["--if-stale", "--source", "github", "--stale-after", "4h"] }));
    expect(staleThresholdMs({ options })).toBe(14_400_000);
  });
});

describe("refreshSlotAcquirer", () => {
  it("answers the production lock when no seam was injected", () => {
    expect(refreshSlotAcquirer({ deps: {} })).toBe(acquireRefreshSlot);
  });

  it("answers the injected seam when one was wired", () => {
    const injected: typeof acquireRefreshSlot = (args) => acquireRefreshSlot(args);
    expect(refreshSlotAcquirer({ deps: { acquireRefreshSlot: injected } })).toBe(injected);
  });
});

describe("refreshUntil", () => {
  it("answers tomorrow by the injected clock when --until was not given", () => {
    const deps = { nowDate: () => new Date("2026-10-14T09:00:00.000Z") };
    expect(refreshUntil({ deps, options: BARE })).toBe("2026-10-15");
  });

  it("answers --until when it was given", () => {
    const options = unwrap(parseRefreshOptions({ rest: ["--until", "2026-09-30"] }));
    const deps = { nowDate: () => new Date("2026-10-14T09:00:00.000Z") };
    expect(refreshUntil({ deps, options })).toBe("2026-09-30");
  });
});
