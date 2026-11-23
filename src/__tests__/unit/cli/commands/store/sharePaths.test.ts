/**
 * `registerPathOf` — where each declared home register resolves through the state-home contract.
 *
 * Pure: `stateHomePaths({ home })` only joins strings, so a fixed fake home is enough and nothing is read.
 *
 * The door ledger is a store table now, not a shared home register.
 * deleted-with-code: doorLedgerJsonl
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { registerPathOf } from "../../../../../cli/commands/store/sharePaths.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { HOME_REGISTERS } from "../../../../../store/homeRegisters.js";

const HOME = "/fixture-home";
const paths = stateHomePaths({ home: HOME });

describe("registerPathOf", () => {
  it("resolves every register that names a path key to its relative path under the home", () => {
    const located = HOME_REGISTERS.filter((register) => register.pathKey !== undefined);
    expect(located.length).toBeGreaterThan(0);
    const mismatched = located
      .map((register) => ({
        kind: register.kind,
        resolved: registerPathOf({ paths, register }),
        wanted: join(HOME, register.relativePath),
      }))
      .filter((row) => row.resolved !== row.wanted);
    expect(mismatched).toEqual([]);
  });

  it("answers undefined for a declared-only register, which has no path", () => {
    const declaredOnly = HOME_REGISTERS.filter((register) => register.pathKey === undefined);
    expect(declaredOnly.length).toBeGreaterThan(0);
    expect(declaredOnly.map((register) => registerPathOf({ paths, register }))).toEqual(
      declaredOnly.map(() => undefined),
    );
  });

  it("routes the org-health journal through the fleet arm to its own file", () => {
    const register = HOME_REGISTERS.find((row) => row.pathKey === "orgHealthAcknowledgementsJsonl")!;
    expect(registerPathOf({ paths, register })).toBe(paths.orgHealthAcknowledgementsJsonl);
  });

  it("routes the three singleton registers through the fleet arm to their own files", () => {
    const keys = ["gmailTriageRulesJson", "browserJson", "staleSeatNoticesJson"] as const;
    const resolved = keys.map((key) =>
      registerPathOf({ paths, register: HOME_REGISTERS.find((row) => row.pathKey === key)! }),
    );
    expect(resolved).toEqual([paths.gmailTriageRulesJson, paths.browserJson, paths.staleSeatNoticesJson]);
  });

  it("resolves the landing registers moved into the store to their retired files", () => {
    const presses = HOME_REGISTERS.find((row) => row.pathKey === "landingPressesJsonl")!;
    const reads = HOME_REGISTERS.find((row) => row.pathKey === "landingReadsJson")!;
    const supersessions = HOME_REGISTERS.find((row) => row.pathKey === "codexSupersessionsJsonl")!;
    expect(registerPathOf({ paths, register: presses })).toBe(join(HOME, "landing-presses.jsonl"));
    expect(registerPathOf({ paths, register: reads })).toBe(paths.landingReadsJson);
    expect(registerPathOf({ paths, register: supersessions })).toBe(paths.codexSupersessionsJsonl);
  });

  it("resolves the owner-judgement register to its one-time import file under the judgement directory", () => {
    const judgement = HOME_REGISTERS.find((row) => row.pathKey === "ownerDirectivesJson")!;
    expect(registerPathOf({ paths, register: judgement })).toBe(join(HOME, "judgement", "owner-directives.json"));
    expect(judgement.table).toBe("owner_directive");
  });
});
