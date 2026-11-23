import { describe, expect, it } from "vitest";
import { checksForLane, type LintCheck, lintChecks } from "../../../../devLint/devLint.js";

describe("checksForLane", () => {
  const ciOwned: LintCheck = { args: ["."], cmd: "/bin/prettier", name: "prettier" };
  const offRepo: LintCheck = { args: ["x"], cmd: "/bin/bash", name: "hygiene", offRepoState: true };
  const alsoCiOwned: LintCheck = { args: ["x"], cmd: "/bin/tsx", name: "house-rules" };

  it("runs the whole plan on the full lane", () => {
    expect(checksForLane({ checks: [ciOwned, offRepo, alsoCiOwned], lane: "full" }).map((c) => c.name)).toEqual([
      "prettier",
      "hygiene",
      "house-rules",
    ]);
  });

  it("keeps only the off-repo-state checks on the local lane, in plan order", () => {
    expect(checksForLane({ checks: [ciOwned, offRepo, alsoCiOwned], lane: "local" }).map((c) => c.name)).toEqual([
      "hygiene",
    ]);
  });

  it("runs nothing on the local lane when no check claims off-repo state", () => {
    expect(checksForLane({ checks: [ciOwned, alsoCiOwned], lane: "local" })).toEqual([]);
  });

  it("returns nothing for an empty plan", () => {
    expect(checksForLane({ checks: [], lane: "local" })).toEqual([]);
  });

  it("resolves the REAL plan's local lane to exactly the five gates CI cannot see", () => {
    // The converse of the flag pin above: that one catches a flag added, this one catches the filter
    // inverted back, which is the change that would silently put 58 gates on every push again.
    const all = lintChecks({ cwd: "/repo" });
    const local = checksForLane({ checks: all, lane: "local" });
    expect(local.map((c) => c.name)).toEqual([
      "hygiene",
      "corpus-hygiene",
      "register-hygiene",
      "secrets-registry",
      "derived-card-voice",
    ]);
    expect(all.length).toBeGreaterThan(local.length);
  });

  it("leaves exactly the REAL plan's whole-project gates out of the seat lane, keeping oxlint to narrow", () => {
    // The seat lane's own registry pin: a new `exclusive` row shows up here, and so does a filter that stopped
    // keeping oxlint for `projectSeatChecks` to narrow.
    const all = lintChecks({ cwd: "/repo" });
    const seat = new Set(checksForLane({ checks: all, lane: "seat" }).map((c) => c.name));
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((c) => !seat.has(c.name)).map((c) => c.name)).toEqual([
      "prettier",
      "knip",
      "named-object-params",
    ]);
    expect(seat.has("oxlint")).toBe(true);
    // The three a split pull request went red on at the lap, which a seat must catch before handback, and
    // internal-exports, measured under the bespoke-gate slot (its row in `gateGroups.ts`).
    expect(
      ["untested-modules", "test-enshittification", "door-coverage", "internal-exports"].map((name) => seat.has(name)),
    ).toEqual([true, true, true, true]);
  });
});
