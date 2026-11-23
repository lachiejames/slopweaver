/**
 * `cmux spawn`'s routing edge — `cli/commands/cmux/codexSeat.ts` — over a REAL plan register in a throwaway
 * home, per testing.md's fixture allowance.
 *
 * `unit/cmux/codexSeatRouting.test.ts` already holds the pure pick down over hand-built rankings. What is
 * only observable here is the wiring: that the register on disk is what the ranker sees, that a paused row
 * is skipped rather than ranked, and that a `--plan` naming one is refused with an exit code rather than
 * routed. Every case passes an explicit `home`, so nothing here reads the operator's own register.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveCodexSeat } from "../../../../../cli/commands/cmux/codexSeat.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { ParsedFlags } from "../../../../../cli/parseFlags.js";
import type { CodexSeatRoute } from "../../../../../cmux/seatRoute.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../../../codexFleetCapFixture.js";
import { memoryCodexSignInPort } from "../../../../codexSignInFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const PAUSED_SINCE = "2026-09-20T00:00:00.000Z";

const homes: string[] = [];

/**
 * A throwaway state home carrying a register with one healthy Codex row and one paused one. Both stores
 * exist, because a store that does not is excluded as a login away (`codex/rank.ts`) before any other rule.
 */
function homeWithRegister(): string {
  const home = mkdtempSync(join(tmpdir(), "codex-seat-route-"));
  homes.push(home);
  mkdirSync(join(home, "plan-six", ".codex"), { recursive: true });
  mkdirSync(join(home, "plan-seven", ".codex"), { recursive: true });
  writeFileSync(
    stateHomePaths({ home }).plansJson,
    JSON.stringify({
      rows: [
        { alias: "plan-six", pinned: true, provider: "codex", storeDir: join(home, "plan-six", ".codex") },
        {
          alias: "plan-seven",
          paused: { reason: "the owner took it out of the fleet", sinceIso: PAUSED_SINCE },
          provider: "codex",
          storeDir: join(home, "plan-seven", ".codex"),
        },
      ],
      version: 1,
    }),
    "utf8",
  );
  return home;
}

/** The verb's parsed flags, with only the ones this edge reads. */
function flags({ plan }: { plan: string | undefined }): ParsedFlags {
  return { positionals: [], values: plan === undefined ? {} : { plan } };
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("resolving which Codex account a visible seat boots against", () => {
  it("routes a claude seat nowhere at all, so its boot line is unchanged", async () => {
    const seat = await resolveCodexSeat({
      fleetCap: memoryCodexFleetCapPort(),
      driver: "claude",
      home: homeWithRegister(),
      parsed: flags({ plan: undefined }),
      port: unavailablePlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
    });

    // A store outage cannot touch a Claude seat here: this edge never reads the register for one.
    expect(seat).toBeUndefined();
  });

  it("ranks the register ON DISK and skips the row the owner paused", async () => {
    const seat = await resolveCodexSeat({
      fleetCap: memoryCodexFleetCapPort(),
      driver: "codex",
      home: homeWithRegister(),
      parsed: flags({ plan: undefined }),
      port: memoryPlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
    });

    const route = seat as CodexSeatRoute;
    expect(route.destination.alias).toBe("plan-six");
    expect(route.destination.codexHome).toContain(join("plan-six", ".codex"));
  });

  // The falsifiable partner to the case above: the paused row IS in the same register, so naming it proves
  // the skip was a decision about that row rather than a register the reader never saw.
  it("refuses a --plan naming the paused row rather than seating it", async () => {
    const seat = await resolveCodexSeat({
      fleetCap: memoryCodexFleetCapPort(),
      driver: "codex",
      home: homeWithRegister(),
      parsed: flags({ plan: "plan-seven" }),
      port: memoryPlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
  });

  it("refuses a --plan no row carries", async () => {
    const seat = await resolveCodexSeat({
      fleetCap: memoryCodexFleetCapPort(),
      driver: "codex",
      home: homeWithRegister(),
      parsed: flags({ plan: "plan-nine" }),
      port: memoryPlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
  });

  it("refuses a codex seat when the register store cannot be read, rather than booting on the ambient home", async () => {
    const seat = await resolveCodexSeat({
      fleetCap: memoryCodexFleetCapPort(),
      driver: "codex",
      home: homeWithRegister(),
      parsed: flags({ plan: undefined }),
      port: unavailablePlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
  });
});
