/**
 * The `plans` noun's manifest, checked for the three properties a manifest can silently get wrong.
 *
 * `CommandMeta` is owned here and by nothing else (`.claude/rules/area-cli.md`), so these assertions are the
 * only thing standing between a wrong `effect` and a verb the door-coverage gate stops asking about.
 */
import { describe, expect, it } from "vitest";

import { plansUsage } from "../../../../cli/commands/plans/plansUsage.js";
import { plansManifest } from "../../../../cli/manifests/plans.js";
import { NOUN_GROUPS } from "../../../../cli/nounGroups.js";

describe("plansManifest", () => {
  it("declares exactly the register verbs, every additive one with the verb that takes it away", () => {
    expect(Object.keys(plansManifest).toSorted()).toStrictEqual([
      "add",
      "adopt",
      "clear-lapse",
      "connect",
      "connect-cancel",
      "connect-worker",
      "connections",
      "lapse",
      "list",
      "pause",
      "pin",
      "remove",
      "resume",
      "set-email",
      "set-store-dir",
      "set-thresholds",
      "set-usage-limit",
      "sync-accounts",
      "unpin",
      "usage",
      "validate",
    ]);
  });

  it("claims local-state on every verb but sync-accounts, the one provider read, and routes none through the door", () => {
    const entries = Object.values(plansManifest);
    expect(entries.length).toBe(21);
    const external = Object.entries(plansManifest)
      .filter(([, entry]) => entry.meta.effect !== "local-state")
      .map(([verb, entry]) => `${verb}:${entry.meta.effect}`);
    expect(external).toStrictEqual(["sync-accounts:external-read"]);
    expect(entries.filter((entry) => entry.meta.doorRouted)).toStrictEqual([]);
    expect(entries.filter((entry) => !entry.meta.dryParseSafe)).toStrictEqual([]);
  });

  it("marks validate, and only validate, as the diagnostic whose non-zero exit is a finding", () => {
    const diagnostics = Object.entries(plansManifest)
      .filter(([, entry]) => entry.meta.diagnostic)
      .map(([verb]) => verb);
    expect(diagnostics).toStrictEqual(["validate"]);
  });

  it("carries the usage line the parser itself derives, so the two cannot disagree", () => {
    expect(plansManifest["pause"]!.meta.usage).toBe(plansUsage({ verb: "pause" }));
    expect(plansManifest["pause"]!.meta.usage).toContain("--reason <value>");
    expect(plansManifest["set-thresholds"]!.meta.usage).toBe(plansUsage({ verb: "set-thresholds" }));
    expect(plansManifest["set-thresholds"]!.meta.usage).toContain("[--reset <value>]");
    expect(plansManifest["set-thresholds"]!.meta.usage).toContain("[--route-at-percent <value>]");
  });

  it("spells every example's store directory ABSOLUTE, because the verb refuses anything else", () => {
    const relative = Object.values(plansManifest)
      .map((entry) => entry.meta.example)
      .filter((example): example is string => example !== null)
      .filter((example) => example.includes("--store-dir"))
      .filter((example) => !example.includes("--store-dir /"));
    expect(relative).toStrictEqual([]);
  });

  it("is registered on the noun barrel, so every verb is dispatchable by name", () => {
    expect(Object.keys(NOUN_GROUPS["plans"]!).toSorted()).toStrictEqual(Object.keys(plansManifest).toSorted());
  });
});
