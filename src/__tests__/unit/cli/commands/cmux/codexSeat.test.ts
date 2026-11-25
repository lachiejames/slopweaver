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

import { resolveCodexSeat, resolveContinuingCodexSeat } from "../../../../../cli/commands/cmux/codexSeat.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { ParsedFlags } from "../../../../../cli/parseFlags.js";
import type { CodexSeatRoute } from "../../../../../cmux/seatRoute.js";
import type { Logger } from "../../../../../lib/logger.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../../../codexFleetCapFixture.js";
import { memoryCodexSignInPort } from "../../../../codexSignInFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";
import { cacheOf, stampInstall } from "../../../codexPlugin/fleetFixture.js";

const PAUSED_SINCE = "2026-09-20T00:00:00.000Z";
const INSTALLED_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const homes: string[] = [];

/** A logger that records what a resolver printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    out,
  };
}

/** The healthy row's Codex home inside a state home. */
function planSixOf({ home }: { home: string }): string {
  return join(home, "plan-six", ".codex");
}

/** The exact line a spawn prints when the routed home carries no Slopweaver install. */
function missingInstallLine({ codexHome }: { codexHome: string }): string {
  const stampPath = join(cacheOf({ codexHome, marketplace: "*" }), ".codex-plugin", "source.json");
  return (
    `cmux spawn: the Codex home ${codexHome} has no Slopweaver plugin installed (no ${stampPath}), so a seat there ` +
    "would boot without Slopweaver's skills and hooks — run `slopweaver codex plugin-sync` from the main checkout, " +
    "then spawn again"
  );
}

/**
 * A throwaway state home carrying a register with one healthy Codex row and one paused one. Both stores
 * exist, because a store that does not is excluded as a login away (`codex/rank.ts`) before any other rule.
 * The healthy row's home carries an install unless `installed` is false; no marketplace file exists anywhere,
 * because the preflight reads only the home.
 */
function homeWithRegister({ installed = true }: { installed?: boolean } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "codex-seat-route-"));
  homes.push(home);
  mkdirSync(join(home, "plan-six", ".codex"), { recursive: true });
  mkdirSync(join(home, "plan-seven", ".codex"), { recursive: true });
  if (installed) {
    stampInstall({ codexHome: planSixOf({ home }), commit: INSTALLED_COMMIT });
  }
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

/** The ports every resolver call here shares: an in-memory fleet read over `home`. */
function seatPorts({ home }: { home: string }): {
  fleetCap: ReturnType<typeof memoryCodexFleetCapPort>;
  home: string;
  signInPort: ReturnType<typeof memoryCodexSignInPort>;
} {
  return { fleetCap: memoryCodexFleetCapPort(), home, signInPort: memoryCodexSignInPort() };
}

describe("resolving which Codex account a visible seat boots against", () => {
  it("routes a claude seat nowhere at all, so its boot line is unchanged", async () => {
    const home = homeWithRegister({ installed: false });
    const { errs, log } = captureLogger();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "claude",
      log,
      parsed: flags({ plan: undefined }),
      port: unavailablePlanRegisterPort(),
    });

    // A store outage, or a missing install, cannot touch a Claude seat: this edge reads neither for one.
    expect(seat).toBeUndefined();
    expect(errs).toEqual([]);
  });

  it("ranks the register ON DISK and skips the row the owner paused", async () => {
    const home = homeWithRegister();
    const { log, out } = captureLogger();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "codex",
      log,
      parsed: flags({ plan: undefined }),
      port: memoryPlanRegisterPort(),
    });

    const route = seat as CodexSeatRoute;
    expect(route.destination.alias).toBe("plan-six");
    expect(route.destination.codexHome).toBe(planSixOf({ home }));
    expect(out).toEqual([`cmux spawn: codex seat on plan-six (CODEX_HOME=${planSixOf({ home })}) — ${route.why}`]);
  });

  // The falsifiable partner to the case above: the paused row IS in the same register, so naming it proves
  // the skip was a decision about that row rather than a register the reader never saw.
  it("refuses a --plan naming the paused row rather than seating it", async () => {
    const home = homeWithRegister();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "codex",
      log: captureLogger().log,
      parsed: flags({ plan: "plan-seven" }),
      port: memoryPlanRegisterPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
  });

  it("refuses a --plan no row carries", async () => {
    const home = homeWithRegister();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "codex",
      log: captureLogger().log,
      parsed: flags({ plan: "plan-nine" }),
      port: memoryPlanRegisterPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
  });

  it("refuses a codex seat when the register store cannot be read, rather than booting on the ambient home", async () => {
    const home = homeWithRegister();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "codex",
      log: captureLogger().log,
      parsed: flags({ plan: undefined }),
      port: unavailablePlanRegisterPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
  });

  it("refuses a routed seat whose home carries no Slopweaver install, printing only the refusal", async () => {
    const home = homeWithRegister({ installed: false });
    const { errs, log, out } = captureLogger();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "codex",
      log,
      parsed: flags({ plan: undefined }),
      port: memoryPlanRegisterPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
    expect(errs).toEqual([missingInstallLine({ codexHome: planSixOf({ home }) })]);
    // Refused BEFORE the seat is announced, so no route line suggests it booted.
    expect(out).toEqual([]);
  });

  it("refuses under --force too, which reaches only the quota decision and never the install check", async () => {
    const home = homeWithRegister({ installed: false });
    const { errs, log } = captureLogger();
    const seat = await resolveCodexSeat({
      ...seatPorts({ home }),
      driver: "codex",
      log,
      parsed: { positionals: [], values: { force: true } },
      port: memoryPlanRegisterPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
    expect(errs).toEqual([missingInstallLine({ codexHome: planSixOf({ home }) })]);
  });
});

describe("a seat continuing an app session", () => {
  it("is refused on a home with no Slopweaver install, so a continuation cannot route around the check", async () => {
    const home = homeWithRegister({ installed: false });
    const { errs, log, out } = captureLogger();
    const seat = await resolveContinuingCodexSeat({
      ...seatPorts({ home }),
      continuing: { codexHome: planSixOf({ home }), sessionId: "0b5e" },
      log,
      parsed: flags({ plan: undefined }),
      port: memoryPlanRegisterPort(),
    });

    expect(seat).toBe(EXIT_ERROR);
    expect(errs).toEqual([missingInstallLine({ codexHome: planSixOf({ home }) })]);
    expect(out).toEqual([]);
  });

  it("boots on a home carrying an install, behind HEAD or not", async () => {
    const home = homeWithRegister();
    const seat = await resolveContinuingCodexSeat({
      ...seatPorts({ home }),
      continuing: { codexHome: planSixOf({ home }), sessionId: "0b5e" },
      log: captureLogger().log,
      parsed: flags({ plan: undefined }),
      port: memoryPlanRegisterPort(),
    });

    const continued = seat as { seat: CodexSeatRoute };
    expect(continued.seat.destination.codexHome).toBe(planSixOf({ home }));
  });
});
