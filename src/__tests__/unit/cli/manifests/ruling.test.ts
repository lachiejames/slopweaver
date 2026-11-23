/**
 * The `ruling` noun's manifest: the writers and the view claim `local-state`, the list claims nothing, and each verb
 * quotes the usage line its own command prints.
 */
import { describe, expect, it } from "vitest";

import {
  RULING_LIST_USAGE,
  RULING_RECORD_USAGE,
  RULING_SEED_USAGE,
  RULING_VIEW_USAGE,
} from "../../../../cli/commands/ruling/rulingUsage.js";
import { rulingManifest } from "../../../../cli/manifests/ruling.js";
import { NOUN_GROUPS } from "../../../../cli/nounGroups.js";

describe("rulingManifest", () => {
  it("declares exactly list, record, seed and view", () => {
    expect(Object.keys(rulingManifest).toSorted()).toStrictEqual(["list", "record", "seed", "view"]);
  });

  it("claims local-state on every verb but list, routing none through the door", () => {
    const effects = Object.entries(rulingManifest)
      .map(([verb, entry]) => `${verb}:${entry.meta.effect}`)
      .toSorted();
    expect(effects).toStrictEqual(["list:none", "record:local-state", "seed:local-state", "view:local-state"]);
    expect(Object.values(rulingManifest).filter((entry) => entry.meta.doorRouted)).toStrictEqual([]);
  });

  it("quotes each verb's usage leaf, so the manifest and the command print one line", () => {
    expect(rulingManifest["record"]!.meta.usage).toBe(RULING_RECORD_USAGE);
    expect(rulingManifest["list"]!.meta.usage).toBe(RULING_LIST_USAGE);
    expect(rulingManifest["seed"]!.meta.usage).toBe(RULING_SEED_USAGE);
    expect(rulingManifest["view"]!.meta.usage).toBe(RULING_VIEW_USAGE);
  });

  it("is registered on the noun barrel, so every verb is dispatchable by name", () => {
    expect(Object.keys(NOUN_GROUPS["ruling"]!).toSorted()).toStrictEqual(Object.keys(rulingManifest).toSorted());
  });

  it("loads one real command for every verb", async () => {
    const loaded = await Promise.all(Object.values(rulingManifest).map(async (entry) => entry.load()));
    expect(loaded.map((command) => typeof command)).toStrictEqual(["function", "function", "function", "function"]);
    expect(new Set(loaded).size).toBe(1);
  });
});
