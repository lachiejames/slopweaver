/**
 * The other copies of the app `desktop install` has to deal with: stale builds LaunchServices still lists,
 * unregistered or named when they stay, and running copies that must quit before the swap, looked for again
 * after the slow copy.
 */
import { describe, expect, it } from "vitest";

import { register } from "../../../../../../cli/commands/desktop/installAfterSwap.js";
import { installHeld } from "../../../../../../cli/commands/desktop/installRun.js";
import { INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { applications, type Behaviour, macWith } from "./fakeMac.js";
import { fakeSeams } from "./seams.js";

describe("installHeld", () => {
  it("names a stale build that stays registered, after unregistering the rest", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    mac.registered.add("/repo/desktop/dist/mac-arm64/Slopweaver.app");
    mac.registered.add("/wt/desktop/dist/mac-arm64/Slopweaver.app");
    const behaviour: Behaviour = { launch: "runs", sticky: "/wt/desktop/dist/mac-arm64/Slopweaver.app" };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("STALE_COPIES_KEPT");
    expect(mac.lines).toContain(
      "registered: and unregistered 1 other build(s), left on disk: /repo/desktop/dist/mac-arm64/Slopweaver.app; still registered: /wt/desktop/dist/mac-arm64/Slopweaver.app",
    );
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
  });

  it("stops before touching the install when a running copy will not quit", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    mac.running.set(500, INSTALLED_BUNDLE);
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", stubborn: true }, mac }),
    });
    expect(unwrapErr(done).code).toBe("STILL_RUNNING");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
  });

  it("looks for running copies after the slow copy, so one launched during it stops the swap", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", launchedDuringCopy: true, stubborn: true }, mac }),
    });
    expect(unwrapErr(done).code).toBe("STILL_RUNNING");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
  });
});

describe("register", () => {
  it("leaves the install registered and reports nothing else to drop", () => {
    const mac = macWith({ folders: [] });
    const registered = register({
      installed: INSTALLED_BUNDLE,
      seams: fakeSeams({ behaviour: { launch: "runs" }, mac }),
    });
    expect(unwrap(registered)).toEqual({ kept: [], line: "registered: no other Slopweaver build to unregister" });
  });
});
