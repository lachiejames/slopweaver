/**
 * Where the chair's successor boots, as `supervisor tick close` and `tick-record` resolve it: the plan register is read
 * ONCE, and only for a hand-off; a Codex pick is confirmed against the live seat decision `cmux spawn` makes; and a
 * register that cannot be read, or a seat that would not open, leaves the sweep armed under a line naming why.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { CODEX_MODEL } from "../../../../../../codex/profiles.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { PlanRegisterErrors } from "../../../../../../plans/errors.js";
import { CODEX_ONLY, countedRegisterRead, derivedPlans, ONE_CLAUDE } from "../../../../../chairSuccessorFixture.js";
import { LEAN_LANES } from "../../../../plans/laneFixtures.js";
import { READ_CHAIR } from "../tickFixtures.js";
import { GAUGE_AT_THE_WALL } from "./gauges.js";
import { chairOn, dir, fake, root, seatAndOpen, useWorkdir } from "./harness.js";

useWorkdir();

describe("the successor's host, as the close resolves it", () => {
  it("hands a registered Codex-only install's chair to Codex, reading the register and the live seat once", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const register = countedRegisterRead({ snapshot: CODEX_ONLY });
    const seatAsked: string[] = [];
    const readCodexSeat = ({ home }: { home: string }): Promise<Result<unknown, string>> => {
      seatAsked.push(home);
      return Promise.resolve(ok("codex-one"));
    };
    const run = fake({
      cadenceReads: { ...chairOn({ alias: "plan-one" }), readCodexSeat, readPlanRegister: register.read },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(register.asked).toStrictEqual([join(root, "home")]);
    expect(seatAsked).toStrictEqual([join(root, "home")]);
    expect(run.out[0]).toContain(
      `\`slopweaver cmux spawn fresh-supervisor-handoff-9293 --driver codex --model ${CODEX_MODEL}\``,
    );
    expect(run.out[0]).not.toContain("fable");
    expect(run.diagnostics).toContain(
      "supervisor tick close:   route currently picks plan-three for a Fable spawn; the successor boots on Codex, the registered provider that can take it.",
    );
  });

  it("carries a close's named --home onto the spawn, so it routes against the register its host was judged on", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const home = join(root, "home");
    const register = countedRegisterRead({ snapshot: CODEX_ONLY });
    const run = fake({
      cadenceReads: { ...chairOn({ alias: "plan-one" }), readPlanRegister: register.read },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--home", home] })).toBe(EXIT_OK);
    expect(register.asked).toStrictEqual([home]);
    expect(run.out[0]).toContain(
      `\`slopweaver cmux spawn fresh-supervisor-handoff-9293 --driver codex --model ${CODEX_MODEL} --home ${home}\``,
    );
  });

  it("keeps the sweep armed under the register's own error when the register cannot be read", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const error = PlanRegisterErrors.registerUnreadable({ path: "/home/plans.json" });
    const run = fake({
      cadenceReads: { ...chairOn({ alias: "plan-one" }), readPlanRegister: () => Promise.resolve(err(error)) },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.appended).toHaveLength(1);
    expect(run.out[0]!.split("\n")[0]).toBe(
      `HAND-OFF TARGET UNAVAILABLE — the plan register could not be read, so no successor can be seated: ${error.message}`,
    );
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
  });

  it("prints the unavailable target alone, re-arming no sweep, for an event-woken chair", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const error = PlanRegisterErrors.registerUnreadable({ path: "/home/plans.json" });
    const run = fake({
      cadenceReads: { ...chairOn({ alias: "plan-one" }), readPlanRegister: () => Promise.resolve(err(error)) },
      evidence: { ...READ_CHAIR, lanes: LEAN_LANES },
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.out).toStrictEqual([
      `HAND-OFF TARGET UNAVAILABLE — the plan register could not be read, so no successor can be seated: ${error.message}`,
    ]);
    expect(run.diagnostics.some((line) => line.startsWith("supervisor tick close: no sweep prompt printed — "))).toBe(
      true,
    );
  });

  it("keeps the sweep armed when the live Codex seat would refuse the spawn the register picked", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const refusal = "refusing — codex-one is at its usage limit (weekly 100%)";
    const run = fake({
      cadenceReads: {
        ...chairOn({ alias: "plan-one" }),
        readCodexSeat: () => Promise.resolve(err(refusal)),
        readPlanRegister: () => Promise.resolve(ok(CODEX_ONLY)),
      },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.out[0]!.split("\n")[0]).toBe(
      `HAND-OFF TARGET UNAVAILABLE — no Claude plan takes the successor, and \`cmux spawn --driver codex\` would not open its seat: ${refusal}`,
    );
    expect(run.out[0]).not.toContain("cmux spawn fresh-supervisor-handoff-9293");
    expect(run.out[0]).toContain("/checkout/skills/supervisor/reference/sweep-contract.md");
  });

  it("never asks for a Codex seat when the register hands the chair to Claude", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const run = fake({
      cadenceReads: {
        ...chairOn({ alias: "plan-one" }),
        readCodexSeat: () => {
          throw new Error("a Claude successor must never start a Codex fleet read");
        },
      },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.out[0]).toContain("`slopweaver cmux spawn fresh-supervisor-handoff-9293 --driver claude --model fable`");
  });

  it("boots an unadopted install's successor on ambient Claude only when the spawn reads its Claude side unconfigured", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const run = fake({
      cadenceReads: {
        ...chairOn({ alias: "plan-one" }),
        readClaudeSide: () => Promise.resolve(ok("unconfigured" as const)),
        readCodexSeat: () => {
          throw new Error("an ambient Claude successor must never start a Codex fleet read");
        },
        readPlanRegister: () => Promise.resolve(ok(derivedPlans({ claudeRows: [] }))),
      },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.out[0]).toContain("`slopweaver cmux spawn fresh-supervisor-handoff-9293 --driver claude --model fable`");
  });

  it("keeps the sweep armed when an unadopted install's present-but-empty accounts file would refuse the ambient boot", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const run = fake({
      cadenceReads: {
        ...chairOn({ alias: "plan-one" }),
        readClaudeSide: () => Promise.resolve(ok("configured" as const)),
        readPlanRegister: () => Promise.resolve(ok(derivedPlans({ claudeRows: [] }))),
      },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(run.out[0]!.split("\n")[0]).toBe(
      "HAND-OFF TARGET UNAVAILABLE — nothing is adopted and no Claude plan is configured, yet a Claude accounts file " +
        "is present, so `cmux spawn --driver claude` would refuse rather than boot on the ambient credential — " +
        "`slopweaver plans adopt` registers a plan",
    );
    expect(run.out[0]).not.toContain("cmux spawn fresh-supervisor-handoff-9293");
  });

  it("never reads the register for a chair told to stay", async () => {
    await seatAndOpen({ gauge: GAUGE_AT_THE_WALL });
    const register = countedRegisterRead({ snapshot: ONE_CLAUDE });
    const run = fake({
      cadenceReads: { ...chairOn({ alias: "plan-three" }), readPlanRegister: register.read },
      evidence: READ_CHAIR,
    });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(register.asked).toStrictEqual([]);
  });
});
