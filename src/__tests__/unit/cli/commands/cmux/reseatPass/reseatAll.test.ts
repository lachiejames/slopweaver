/** `cmux reseat --all` over a fake client: the walled chair first, then each walled worker. */
import { describe, expect, it } from "vitest";

import { reseatAll } from "../../../../../../cli/commands/cmux/reseatPass.js";
import { LOGGED_OUT, SEAT_ID, workspace } from "./fixtures.js";
import { world } from "./harness.js";

describe("reseatAll", () => {
  it("reseats the walled chair FIRST and without pacing, then each walled worker", async () => {
    const journal: string[] = [];
    const screens = new Map([
      ["ws-seat", LOGGED_OUT],
      ["ws-chair", LOGGED_OUT],
    ]);
    const { client, deps } = world({ journal, screens });

    const outcomes = await reseatAll({
      deps: { ...deps, client },
      workspaces: [workspace({ id: "ws-seat", ref: "workspace:4" }), workspace({ id: "ws-chair", ref: "workspace:1" })],
    });

    expect(journal.filter((entry) => !entry.startsWith("boot ")).map((entry) => entry.split(":")[0])).toEqual([
      "route ws-chair",
      "stop 75277",
      "send ws-chair",
      "route ws-seat",
      "boot-slot",
      "stop 393",
      "send ws-seat",
    ]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["reseated", "reseated"]);
  });

  it("leaves a healthy seat alone, and reports a screen it could not read", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", "> "]]) });

    const outcomes = await reseatAll({
      deps: { ...deps, client },
      workspaces: [workspace({ id: "ws-seat", ref: "workspace:4" }), workspace({ id: "ws-chair", ref: "workspace:1" })],
    });

    expect(journal).toEqual([`boot ${SEAT_ID}`]);
    expect(outcomes).toEqual([expect.objectContaining({ kind: "refused", workspaceRef: "workspace:1" })]);
  });
});
