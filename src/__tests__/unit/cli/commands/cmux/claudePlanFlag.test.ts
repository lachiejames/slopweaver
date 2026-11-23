/**
 * `--plan` on a Claude seat — `cli/commands/cmux/claudePlanFlag.ts` — over a REAL plan register in a throwaway
 * home, per testing.md's fixture allowance.
 *
 * `unit/claude/requestedPlan.test.ts` holds the decision down over hand-built accounts. What is only observable
 * here is the wiring: that the register on disk is what the resolver sees, that a paused or Codex row refuses
 * as the caller's mistake, and that a register that will not read refuses as a fact about the machine. Every
 * case passes an explicit `home`, so nothing here reads the operator's own register.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { claudePlanStoreFor, claudeSeatNamedStore } from "../../../../../cli/commands/cmux/claudePlanFlag.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { ParsedFlags } from "../../../../../cli/parseFlags.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const homes: string[] = [];

/** A throwaway home whose register file holds exactly `text`. */
function homeWith({ text }: { text: string }): string {
  const home = mkdtempSync(join(tmpdir(), "claude-plan-flag-"));
  homes.push(home);
  writeFileSync(stateHomePaths({ home }).plansJson, text, "utf8");
  return home;
}

/** A register with two healthy Claude plans, one paused one, and one Codex row. */
function homeWithRegister(): string {
  return homeWith({
    text: JSON.stringify({
      rows: [
        { alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" },
        {
          alias: "plan-two",
          paused: { reason: "a bounced charge", sinceIso: "2026-09-21T00:00:00.000Z" },
          provider: "claude",
          storeDir: "/stores/plan-two",
        },
        { alias: "plan-three", provider: "claude", storeDir: "/stores/plan-three" },
        { alias: "codex-two", provider: "codex", storeDir: "/codex/two" },
      ],
      version: 1,
    }),
  });
}

/** The verb's parsed flags, with only the one this edge reads. */
function flags({ plan }: { plan: string | undefined }): ParsedFlags {
  return { positionals: [], values: plan === undefined ? {} : { plan } };
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("claudePlanStoreFor — the store a named Claude plan boots against", () => {
  it("answers the named row's store off the register on disk", async () => {
    const store = await claudePlanStoreFor({
      alias: "plan-three",
      command: "cmux reseat",
      home: homeWithRegister(),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBe("/stores/plan-three");
  });

  // The falsifiable partner: plan-two IS a Claude row in the same register, so the refusal is about its pause.
  it("refuses a paused plan as the caller's to change", async () => {
    const store = await claudePlanStoreFor({
      alias: "plan-two",
      command: "cmux reseat",
      home: homeWithRegister(),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBe(EXIT_USAGE);
  });

  it("refuses a Codex alias, which no Claude seat can boot on", async () => {
    const store = await claudePlanStoreFor({
      alias: "codex-two",
      command: "cmux spawn",
      home: homeWithRegister(),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBe(EXIT_USAGE);
  });

  it("refuses a register that will not read as a fact about this machine, not a usage mistake", async () => {
    const store = await claudePlanStoreFor({
      alias: "plan-one",
      command: "cmux spawn",
      home: homeWith({ text: "{ not" }),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBe(EXIT_ERROR);
  });

  it("refuses an unreachable register store as a fact about this machine, not a usage mistake", async () => {
    const store = await claudePlanStoreFor({
      alias: "plan-one",
      command: "cmux spawn",
      home: homeWithRegister(),
      port: unavailablePlanRegisterPort(),
    });

    expect(store).toBe(EXIT_ERROR);
  });

  // One unpaused Claude plan of two is a valid register now: the live row boots, and the
  // paused one is still the caller's to change.
  it("answers the live row and refuses the paused one when only one of two plans is unpaused", async () => {
    const home = homeWith({
      text: JSON.stringify({
        rows: [
          { alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" },
          {
            alias: "plan-two",
            paused: { reason: "a bounced charge", sinceIso: "2026-09-21T00:00:00.000Z" },
            provider: "claude",
            storeDir: "/stores/plan-two",
          },
        ],
        version: 1,
      }),
    });

    expect(
      await claudePlanStoreFor({ alias: "plan-one", command: "cmux spawn", home, port: memoryPlanRegisterPort() }),
    ).toBe("/stores/plan-one");
    expect(
      await claudePlanStoreFor({ alias: "plan-two", command: "cmux spawn", home, port: memoryPlanRegisterPort() }),
    ).toBe(EXIT_USAGE);
  });
});

describe("claudeSeatNamedStore — cmux spawn's Claude half of --plan", () => {
  it("names nothing for a Codex seat, which reads the same flag in its own edge", async () => {
    const store = await claudeSeatNamedStore({
      driver: "codex",
      home: homeWithRegister(),
      parsed: flags({ plan: "plan-one" }),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBeUndefined();
  });

  it("names nothing when --plan is absent, so routing decides", async () => {
    const store = await claudeSeatNamedStore({
      driver: "claude",
      home: homeWithRegister(),
      parsed: flags({ plan: undefined }),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBeUndefined();
  });

  it("names the store a claude seat was pointed at", async () => {
    const store = await claudeSeatNamedStore({
      driver: "claude",
      home: homeWithRegister(),
      parsed: flags({ plan: "plan-one" }),
      port: memoryPlanRegisterPort(),
    });

    expect(store).toBe("/stores/plan-one");
  });
});
