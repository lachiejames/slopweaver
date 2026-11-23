/**
 * `handover park`'s close: a seat closing ITSELF records its session closed before the close, since it does not
 * outlive it; any other seat records only off a close that went through.
 */
import { afterEach, describe, expect, it } from "vitest";

import { closeSeat } from "../../../../../cli/commands/handover/parkCloseSeat.js";
import { CmuxErrors } from "../../../../../cmux/errors.js";
import { err, unwrapErr } from "../../../../../lib/result.js";
import { cmuxSessionHarnessOver } from "../../../../../sessionHarness/cmuxHarness.js";
import { INSTANT_WAITS } from "../../../sessionHarness/fakeCmux.js";
import { fakeClient } from "../session/closeDoneFakeCmux.js";
import { home, openKeys, removeFixtureDirs, spawnedRow, workspace } from "../session/closeDoneHarness.js";

afterEach(removeFixtureDirs);

/** A client whose workspace resolve fails, so no close can go through, and the seam's harness over it. */
function unresolvable(): Pick<Parameters<typeof closeSeat>[0], "client" | "harness"> {
  const client = {
    ...fakeClient({ workspaces: [] }).client,
    resolveWorkspace: () =>
      Promise.resolve(err(CmuxErrors.malformedReply({ detail: "socket gone", method: "workspace.resolve" }))),
  };
  return { client, harness: cmuxSessionHarnessOver({ client, waits: INSTANT_WAITS }) };
}

describe("closeSeat", () => {
  it("records its own seat closed before a close that then fails, and says the park was journalled", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "parked-doc", workspaceRef: "workspace:1" });
    const seat = workspace();
    const closed = await closeSeat({
      callerWorkspaceId: seat.workspaceId,
      ...unresolvable(),
      forced: false,
      home: fixture.home,
      seat,
    });
    expect(closed.isErr()).toBe(true);
    expect([unwrapErr(closed).kind, openKeys({ home: fixture.home })]).toEqual(["cmux", []]);
  });

  it("leaves another seat's session open when the close fails", async () => {
    const fixture = home();
    spawnedRow({ home: fixture.home, slug: "parked-doc", workspaceRef: "workspace:1" });
    const closed = await closeSeat({
      callerWorkspaceId: undefined,
      ...unresolvable(),
      forced: false,
      home: fixture.home,
      seat: workspace(),
    });
    expect(closed.isErr()).toBe(true);
    expect([unwrapErr(closed).kind, openKeys({ home: fixture.home })]).toEqual(["cmux", ["parked-doc"]]);
  });
});
