/**
 * The three `store authored-*` rows and `store slack-asks`, split out of the store manifest: each prints the usage
 * its verb refuses with, and the store manifest still carries all four.
 */
import { describe, expect, it } from "vitest";

import {
  AUTHORED_LIST_USAGE,
  AUTHORED_RESTORE_USAGE,
  AUTHORED_SHOW_USAGE,
  SLACK_ASKS_USAGE,
} from "../../../../cli/commands/store/authoredUsage.js";
import { storeManifest } from "../../../../cli/manifests/store.js";
import { storeAuthoredManifest } from "../../../../cli/manifests/storeAuthored.js";

describe("storeAuthoredManifest", () => {
  it("prints each verb's own usage, and is spread whole into the store manifest", () => {
    expect(storeAuthoredManifest["authored-list"]!.meta.usage).toBe(AUTHORED_LIST_USAGE);
    expect(storeAuthoredManifest["authored-show"]!.meta.usage).toBe(AUTHORED_SHOW_USAGE);
    expect(storeAuthoredManifest["authored-restore"]!.meta.usage).toBe(AUTHORED_RESTORE_USAGE);
    expect(storeAuthoredManifest["slack-asks"]!.meta.usage).toBe(SLACK_ASKS_USAGE);
    expect(Object.keys(storeAuthoredManifest).filter((verb) => storeManifest[verb] === undefined)).toEqual([]);
    expect(Object.keys(storeAuthoredManifest).toSorted()).toEqual([
      "authored-list",
      "authored-restore",
      "authored-show",
      "slack-asks",
    ]);
  });
});
