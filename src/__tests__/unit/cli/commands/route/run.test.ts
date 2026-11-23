/** `route plan` keeps parsing pure and profile reads explicit. */
import { describe, expect, it } from "vitest";

import { parseRoutePlanArgs, routePlanCommand, runRoutePlan } from "../../../../../cli/commands/route/run.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { routeManifest } from "../../../../../cli/manifests/route.js";
import { unwrapErr } from "../../../../../lib/result.js";

describe("route plan", () => {
  it("accepts the machine-readable question and explicit private-profile path", () => {
    const parsed = parseRoutePlanArgs({
      rest: ["--question", "what is current?", "--profile", "/tmp/capabilities.json", "--json"],
    });

    expect(parsed.isOk()).toBe(true);
  });

  it("refuses an unknown flag before any profile read", () => {
    expect(unwrapErr(parseRoutePlanArgs({ rest: ["--unknown"] }))).toEqual(["unknown flag: --unknown"]);
  });

  it("requires the explicit JSON hand-off mode", async () => {
    expect(await runRoutePlan(["node", "slopweaver", "route", "plan", "--question", "what is current?"])).toBe(
      EXIT_USAGE,
    );
  });

  it("fails loudly when an explicitly named private profile cannot be read", async () => {
    expect(
      await runRoutePlan([
        "node",
        "slopweaver",
        "route",
        "plan",
        "--question",
        "what is current?",
        "--profile",
        "/definitely/missing/capabilities.json",
        "--json",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("exposes the manifest-selected command with no external effect", () => {
    expect(routePlanCommand).toBe(runRoutePlan);
    expect(routeManifest["plan"]?.meta.effect).toBe("none");
  });
});
