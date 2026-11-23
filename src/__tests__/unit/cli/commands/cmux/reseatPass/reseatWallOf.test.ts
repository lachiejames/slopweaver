/** `reseatWallOf` over a fake client: which wall, if any, a screen and its session's boot put a seat behind. */
import { describe, expect, it } from "vitest";

import { reseatWallOf } from "../../../../../../cli/commands/cmux/reseatPass.js";
import { ok } from "../../../../../../lib/result.js";
import { LOGGED_OUT, OFF_PLAN, SEAT_ID, workspace } from "./fixtures.js";
import { world } from "./harness.js";

describe("reseatWallOf", () => {
  it("names the banner and never reads the boot when the screen shows one", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map() });

    const wall = await reseatWallOf({
      deps: { ...deps, client },
      screen: LOGGED_OUT,
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(wall).toStrictEqual({ kind: "logged-out" });
    expect(journal).toEqual([]);
  });

  it("walls a clean screen whose session booted off-plan, and not one on a plan", async () => {
    const journal: string[] = [];
    const { client, deps } = world({
      boots: new Map([[SEAT_ID, { kind: "off-plan", why: OFF_PLAN }]]),
      journal,
      screens: new Map(),
    });

    const walls = [
      await reseatWallOf({
        deps: { ...deps, client },
        screen: "> ",
        workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
      }),
      await reseatWallOf({
        deps: { ...deps, client },
        screen: "> ",
        workspace: workspace({ id: "ws-chair", ref: "workspace:1" }),
      }),
    ];

    expect(walls).toStrictEqual([{ kind: "off-plan", why: OFF_PLAN }, undefined]);
  });

  it("leaves a seat alone whose session cannot be found in its tab", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map() });

    const wall = await reseatWallOf({
      deps: { ...deps, client, readRegistry: () => ok([]) },
      screen: "> ",
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(wall).toBe(undefined);
    expect(journal).toEqual([]);
  });
});
