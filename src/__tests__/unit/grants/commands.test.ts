import { describe, expect, it } from "vitest";

import { grantListCommand } from "../../../cli/commands/grant/list.js";
import { grantPerformCommand } from "../../../cli/commands/grant/perform.js";
import { grantRecordCommand } from "../../../cli/commands/grant/record.js";
import { grantRefuseCommand } from "../../../cli/commands/grant/refuse.js";
import { grantShowCommand } from "../../../cli/commands/grant/show.js";
import { grantManifest } from "../../../cli/manifests/grant.js";

describe("every grant verb the manifest advertises is reachable", () => {
  it("exports a run function per verb", () => {
    expect([
      typeof grantListCommand,
      typeof grantPerformCommand,
      typeof grantRecordCommand,
      typeof grantRefuseCommand,
      typeof grantShowCommand,
    ]).toEqual(["function", "function", "function", "function", "function"]);
  });

  it("advertises exactly the five verbs, in the order the catalog prints them", () => {
    expect(Object.keys(grantManifest)).toEqual(["list", "perform", "record", "refuse", "show"]);
  });

  it("writes only local state — a row is never a provider write", () => {
    expect(Object.values(grantManifest).map((entry) => entry.meta.effect)).toEqual([
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "local-state",
    ]);
  });

  it("marks the two verbs that REPORT a failed check as diagnostic, so a non-zero exit is a finding", () => {
    expect(
      Object.entries(grantManifest)
        .filter(([, entry]) => entry.meta.diagnostic)
        .map(([verb]) => verb),
    ).toEqual(["perform", "show"]);
  });
});
