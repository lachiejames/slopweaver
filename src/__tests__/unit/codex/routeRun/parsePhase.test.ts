/*
 * `codex route`'s parse phase through the real verb: `--help`, an unknown flag, a register with no Codex row, an
 * unreadable register store, and the three flags its usage advertises.
 */
import { describe, expect, it } from "vitest";

import {
  parseCodexRouteArgs,
  ROUTE_USAGE,
  runCodexRoute,
  runCodexRouteOver,
} from "../../../../cli/commands/codex/routeRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { unwrap } from "../../../../lib/result.js";
import { memoryCodexFleetCapPort } from "../../../codexFleetCapFixture.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../planRegisterFixture.js";
import { homeWith, useRouteRunHomes } from "./harness.js";

useRouteRunHomes();

describe("the route verb's parse phase", () => {
  it("answers --help with usage and exit 0", async () => {
    expect(await runCodexRoute(["node", "slopweaver", "codex", "route", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an unknown flag with EXIT_USAGE rather than ignoring it", async () => {
    expect(await runCodexRoute(["node", "slopweaver", "codex", "route", "--to"])).toBe(EXIT_USAGE);
  });

  it("runs against a home whose register names no Codex row, and exits 0", async () => {
    const home = homeWith({ rows: [] });
    const argv = ["node", "slopweaver", "codex", "route", "--home", home, "--json"];

    expect(
      await runCodexRouteOver({
        argv,
        fleetCap: memoryCodexFleetCapPort(),
        port: memoryPlanRegisterPort(),
        signInPort: memoryCodexSignInPort(),
      }),
    ).toBe(EXIT_OK);
  });

  it("exits EXIT_ERROR, never an empty fleet, when the register store cannot be read", async () => {
    const home = homeWith({ rows: [] });
    const argv = ["node", "slopweaver", "codex", "route", "--home", home, "--json"];

    expect(
      await runCodexRouteOver({
        argv,
        fleetCap: memoryCodexFleetCapPort(),
        port: unavailablePlanRegisterPort(),
        signInPort: memoryCodexSignInPort(),
      }),
    ).toBe(EXIT_ERROR);
  });

  it("accepts the three flags its usage advertises, through the REAL parser", () => {
    const parsed = parseCodexRouteArgs({ rest: ["--home", "/somewhere", "--json", "--full"] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).values["home"]).toBe("/somewhere");
    expect(unwrap(parsed).values["json"]).toBe(true);
    expect(unwrap(parsed).values["full"]).toBe(true);
    expect(ROUTE_USAGE).toContain("[--full]");
  });
});
