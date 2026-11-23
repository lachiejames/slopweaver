/**
 * Whether a Claude fallback may be prepared — `cli/commands/codex/fallbackCapRead.ts`, over a REAL plan
 * register and REAL Codex rollout lines in a throwaway home, per testing.md's fixture allowance.
 *
 * `unit/codex/fallbackCap.test.ts` holds the pure mapping down over hand-built fleet verdicts. What only this
 * file can reach is the READ underneath it: that each registered destination's own `$CODEX_HOME` is scanned
 * for its own log, so a fleet whose second account is open refuses instead of minting a receipt claiming
 * Codex was capped. The two cases differ in ONE destination's log line and nothing else.
 *
 * Every case writes its own `plans.json`, so the derived bootstrap row never fires and nothing here reads
 * the operator's own register or the ambient `$CODEX_HOME`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readFallbackGroundOver } from "../../../../../cli/commands/codex/fallbackCapRead.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../../../codexFleetCapFixture.js";
import {
  REAL_CREDITS_DEPLETED_LINE,
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_USAGE_LIMIT_REACHED_LINE,
} from "../../../../codexRolloutLines.js";
import { memoryCodexSignInPort } from "../../../../codexSignInFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

const homes: string[] = [];

/**
 * The fleet's own sentence for the two exhausted rows — the one `codex status` prints after `CAPPED:` — naming
 * plan-seven's credits and plan-six's usage limit, so the receipt cites every refusal it stands on.
 */
const REFUSING_CLAUSES =
  "plan-seven: Codex is out of credits (detected 2026-08-14T04:28:21.285Z) — bypass once with --force, or run " +
  "`slopweaver codex quota clear` once it's confirmed fixed; plan-six: Codex reported a usage limit reached " +
  "(detected 2026-09-11T07:31:24.319Z); the event names no window, so there is no reset to wait for — bypass " +
  "once with --force, or run `slopweaver codex quota clear` once it's confirmed fixed";

/** A Codex home holding one day-directory with one rollout file carrying the given line. */
function codexHomeWith({ line, root }: { line: string; root: string }): string {
  const day = join(root, "sessions", "2026", "09", "13");
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, "rollout-a.jsonl"), `${line}\n`, "utf8");
  return root;
}

/**
 * A throwaway state home whose register names two Codex destinations, each with its own log — plus, when
 * `pausedRow` is set, a third that is PAUSED and has never logged anything.
 */
function fleetHome({ pausedRow = false, sixLine }: { pausedRow?: boolean; sixLine: string }): string {
  const home = mkdtempSync(join(tmpdir(), "codex-fallback-cap-"));
  homes.push(home);
  // The OLDER exhausted reading sits on the FIRST row, so evidence naming `plan-six` proves the
  // freshest was picked rather than the first one found.
  const seven = codexHomeWith({ line: REAL_CREDITS_DEPLETED_LINE, root: join(home, "plan-seven", ".codex") });
  const six = codexHomeWith({ line: sixLine, root: join(home, "plan-six", ".codex") });
  const unread = join(home, "plan-two", ".codex");
  mkdirSync(unread, { recursive: true });
  const paused = pausedRow
    ? [
        {
          alias: "plan-two",
          paused: { reason: "renamed to plan-three", sinceIso: "2026-09-12T00:00:00.000Z" },
          provider: "codex",
          storeDir: unread,
        },
      ]
    : [];
  writeFileSync(
    stateHomePaths({ home }).plansJson,
    JSON.stringify({
      rows: [
        { alias: "plan-seven", provider: "codex", storeDir: seven },
        { alias: "plan-six", provider: "codex", storeDir: six },
        ...paused,
      ],
      version: 1,
    }),
    "utf8",
  );
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("reading whether the registered Codex fleet is capped, before a fallback captures anything", () => {
  it("REFUSES while one registered destination's own log still reads healthy", async () => {
    const home = fleetHome({ sixLine: REAL_HEALTHY_WEEKLY_LINE });

    expect(
      await readFallbackGroundOver({
        fleetCap: memoryCodexFleetCapPort(),
        home,
        port: memoryPlanRegisterPort(),
        signInPort: memoryCodexSignInPort(),
        verb: "review",
      }),
    ).toBe(EXIT_ERROR);
  });

  // The falsifiable partner: the SAME register, with that one destination's log replaced by an exhausted
  // reading, must produce evidence — otherwise the refusal above would be green against a module that never
  // lets a fallback through at all, and rule 9's cap path would be unreachable.
  it("returns the FRESHEST blocked reading as evidence once every registered destination is exhausted", async () => {
    const home = fleetHome({ sixLine: REAL_USAGE_LIMIT_REACHED_LINE });

    const evidence = await readFallbackGroundOver({
      fleetCap: memoryCodexFleetCapPort(),
      home,
      port: memoryPlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
      verb: "review",
    });

    expect(evidence).toEqual({
      evidence: {
        blockedBy: `all 2 registered Codex destination(s) are unavailable and 2 refusing — ${REFUSING_CLAUSES}`,
        limitId: "premium",
        observedAtIso: "2026-09-11T07:31:24.319Z",
        reachedType: null,
      },
      kind: "cap",
    });
  });

  it("asks the same question for the PLAN verb, which reads its own hatch row and the same register", async () => {
    const home = fleetHome({ sixLine: REAL_HEALTHY_WEEKLY_LINE });

    expect(
      await readFallbackGroundOver({
        fleetCap: memoryCodexFleetCapPort(),
        home,
        port: memoryPlanRegisterPort(),
        signInPort: memoryCodexSignInPort(),
        verb: "plan",
      }),
    ).toBe(EXIT_ERROR);
  });

  // The incident over a REAL register: a paused row that never logged beside two exhausted ones is a
  // cap, the same answer `codex route` gives, rather than a refusal naming the paused row as unread.
  it("returns evidence when the only unread destination is PAUSED", async () => {
    const home = fleetHome({ pausedRow: true, sixLine: REAL_USAGE_LIMIT_REACHED_LINE });

    const evidence = await readFallbackGroundOver({
      fleetCap: memoryCodexFleetCapPort(),
      home,
      port: memoryPlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
      verb: "review",
    });

    expect(evidence).toEqual({
      evidence: {
        blockedBy: `all 3 registered Codex destination(s) are unavailable and 2 refusing — ${REFUSING_CLAUSES}`,
        limitId: "premium",
        observedAtIso: "2026-09-11T07:31:24.319Z",
        reachedType: null,
      },
      kind: "cap",
    });
  });

  // A Claude-only install: the ADOPTED register holds no Codex row, so the fallback is the configured route
  // and its ground says so — never a cap reading.
  it("returns the provider-unregistered ground when the adopted register carries no Codex row", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-fallback-unregistered-"));
    homes.push(home);
    writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify({ rows: [], version: 1 }), "utf8");

    const ground = await readFallbackGroundOver({
      fleetCap: memoryCodexFleetCapPort(),
      home,
      port: memoryPlanRegisterPort(),
      signInPort: memoryCodexSignInPort(),
      verb: "plan",
    });

    expect(ground).toMatchObject({ evidence: { kind: "codex-provider-unregistered" }, kind: "unregistered" });
  });

  // An exhausted fleet the store cannot be read for is NOT a cap: a store outage is no evidence, so the
  // fallback is refused rather than prepared on a fleet nobody read.
  it("REFUSES when the register store cannot be read, even over logs that would read exhausted", async () => {
    const home = fleetHome({ sixLine: REAL_USAGE_LIMIT_REACHED_LINE });

    expect(
      await readFallbackGroundOver({
        fleetCap: memoryCodexFleetCapPort(),
        home,
        port: unavailablePlanRegisterPort(),
        signInPort: memoryCodexSignInPort(),
        verb: "review",
      }),
    ).toBe(EXIT_ERROR);
  });
});
