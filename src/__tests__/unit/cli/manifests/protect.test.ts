/**
 * The `protect` noun's manifest: the two writers claim `local-state`, the two readers claim nothing, and each verb
 * quotes the usage line its own command prints.
 */
import { describe, expect, it } from "vitest";

import {
  PROTECT_ADD_USAGE,
  PROTECT_CHECK_USAGE,
  PROTECT_LIST_USAGE,
  PROTECT_REMOVE_USAGE,
} from "../../../../cli/commands/protect/protectUsage.js";
import { protectManifest } from "../../../../cli/manifests/protect.js";
import { NOUN_GROUPS } from "../../../../cli/nounGroups.js";

describe("protectManifest", () => {
  it("declares exactly add, check, list and remove", () => {
    expect(Object.keys(protectManifest).toSorted()).toStrictEqual(["add", "check", "list", "remove"]);
  });

  it("claims local-state on the two writers and none on the two readers, routing none through the door", () => {
    const effects = Object.entries(protectManifest)
      .map(([verb, entry]) => `${verb}:${entry.meta.effect}`)
      .toSorted();
    expect(effects).toStrictEqual(["add:local-state", "check:none", "list:none", "remove:local-state"]);
    expect(Object.values(protectManifest).filter((entry) => entry.meta.doorRouted)).toStrictEqual([]);
  });

  it("marks only the readers dry-parse-safe", () => {
    const safe = Object.entries(protectManifest)
      .filter(([, entry]) => entry.meta.dryParseSafe)
      .map(([verb]) => verb)
      .toSorted();
    expect(safe).toStrictEqual(["check", "list"]);
  });

  it("quotes each verb's usage leaf, so the manifest and the command print one line", () => {
    expect(protectManifest["add"]!.meta.usage).toBe(PROTECT_ADD_USAGE);
    expect(protectManifest["remove"]!.meta.usage).toBe(PROTECT_REMOVE_USAGE);
    expect(protectManifest["list"]!.meta.usage).toBe(PROTECT_LIST_USAGE);
    expect(protectManifest["check"]!.meta.usage).toBe(PROTECT_CHECK_USAGE);
  });

  it("is registered on the noun barrel, so every verb is dispatchable by name", () => {
    expect(Object.keys(NOUN_GROUPS["protect"]!).toSorted()).toStrictEqual(Object.keys(protectManifest).toSorted());
  });
});
