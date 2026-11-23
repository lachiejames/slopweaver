/**
 * The `store` noun's detective ladder metadata: which rungs advertise the human-only bot scope.
 *
 * The search rungs filter bot-authored rows by default and the reading rungs never do, so the usage strings
 * have to say the same: a reading rung advertising `--include-bots` would offer a flag its parser refuses.
 */
import { describe, expect, it } from "vitest";

import {
  AROUND_USAGE,
  GROUPS_USAGE,
  HITS_USAGE,
  OPEN_USAGE,
  PEEK_USAGE,
  PROBE_USAGE,
} from "../../../../cli/commands/store/probeUsage.js";
import {
  aroundMeta,
  detectMeta,
  groupsMeta,
  hitsMeta,
  openMeta,
  peekMeta,
  probeMeta,
} from "../../../../cli/manifests/storeDetectiveMeta.js";

const SEARCH_RUNGS = [probeMeta, groupsMeta, hitsMeta];
const READING_RUNGS = [peekMeta, openMeta, aroundMeta];

describe("the shells' own usage text agrees with the manifest on bot scope", () => {
  it("names the bot flags on every search rung's usage", () => {
    const search = [PROBE_USAGE, GROUPS_USAGE, HITS_USAGE];
    expect(search.length).toBe(3);
    expect(search.filter((usage) => !usage.includes("[--include-bots|--exclude-bots]"))).toEqual([]);
  });

  it("names no bot flag on a reading rung's usage", () => {
    const reading = [PEEK_USAGE, OPEN_USAGE, AROUND_USAGE];
    expect(reading.length).toBe(3);
    expect(reading.filter((usage) => usage.includes("bots"))).toEqual([]);
  });
});

describe("the detective ladder's bot scope", () => {
  it("advertises --include-bots and --exclude-bots on every search rung", () => {
    expect(SEARCH_RUNGS.length).toBe(3);
    expect(SEARCH_RUNGS.filter((meta) => !meta.usage.includes("[--include-bots|--exclude-bots]"))).toEqual([]);
  });

  it("offers no bot flag on a reading rung, which shows bots always", () => {
    expect(READING_RUNGS.length).toBe(3);
    expect(READING_RUNGS.filter((meta) => meta.usage.includes("bots"))).toEqual([]);
  });

  it("keeps every rung read-shaped, opening no door", () => {
    expect([...SEARCH_RUNGS, ...READING_RUNGS].map((meta) => meta.effect)).toEqual([
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
    ]);
  });

  it("lets detect write its brief, so it reports local-state", () => {
    expect(detectMeta.effect).toBe("local-state");
    expect(detectMeta.usage.startsWith("usage: slopweaver store detect <question>")).toBe(true);
  });
});
