/**
 * `desktop install` never interrupts a voice call: a live console lease refuses the run before anything is
 * quit, it is read again before the quit and after the swap, a lapsed or swept lease holds nothing, and a
 * folder or lease that cannot be read refuses rather than counting as no call.
 */
import { describe, expect, it } from "vitest";

import { installHeld } from "../../../../../../cli/commands/desktop/installRun.js";
import type { InstallSeams } from "../../../../../../cli/commands/desktop/installSeams.js";
import { refuseDuringCall } from "../../../../../../cli/commands/desktop/installStamp.js";
import { DesktopInstallErrors } from "../../../../../../desktop/errors.js";
import { INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { applications, type Behaviour, fsError, holdsFolder, macWith, NOW_MS, writeLease } from "./fakeMac.js";
import { fakeSeams } from "./seams.js";

const HOLDS = holdsFolder();

describe("installHeld", () => {
  it("refuses while a voice call holds a lease, before recovering or quitting anything", async () => {
    const mac = macWith({
      folders: [
        [INSTALLED_BUNDLE, "old", 1],
        ["/Applications/.Slopweaver-previous-3", "older", 1],
      ],
    });
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
    mac.running.set(29179, INSTALLED_BUNDLE);
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(unwrapErr(done).code).toBe("CALL_LIVE");
    expect(mac.running.get(29179)).toBe(INSTALLED_BUNDLE);
    expect(applications({ mac })).toEqual([`/Applications/.Slopweaver-previous-3 older`, `${INSTALLED_BUNDLE} old`]);
  });

  it("installs past a call lease that has lapsed", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    writeLease({ mac, untilMs: NOW_MS - 1 });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
  });

  it("reads the leases again before the quit, so a call started during the build keeps its app", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    mac.running.set(29179, INSTALLED_BUNDLE);
    const behaviour: Behaviour = { callDuringBuild: true, launch: "runs" };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("CALL_LIVE");
    expect(mac.running.get(29179)).toBe(INSTALLED_BUNDLE);
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
  });

  it("never quits a call started after the swap, neither in the second quit nor in a rollback", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { callAfterSwap: true, launch: "runs" };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("CALL_LIVE");
    expect(mac.running.get(777)).toBe(INSTALLED_BUNDLE);
    expect(mac.calls).not.toContain("open");
  });

  it("says why the new build failed when a call started since refuses its rollback", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { callAtOpen: true, launch: "never" };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("CALL_LIVE");
    expect(mac.running.get(778)).toBe("/Users/owner/Desktop/Slopweaver.app");
    expect(
      mac.lines.filter((line) => line.startsWith("rollback: not done, and the new build had failed: ")),
    ).toHaveLength(1);
  });
});

describe("refuseDuringCall", () => {
  it("counts every live lease, and none that lapsed", () => {
    const mac = macWith({ folders: [] });
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
    mac.folders.set(`${HOLDS}/call-2.json`, { mtimeMs: 1, tag: "lease" });
    mac.files.set(`${HOLDS}/call-2.json`, JSON.stringify({ callId: "call-2", untilMs: NOW_MS - 1 }));
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    expect(unwrapErr(refuseDuringCall({ home: "/home", seams }))).toEqual(DesktopInstallErrors.callLive({ calls: 1 }));
  });

  it("reads a hold folder removed while it is listed as holding no call", () => {
    const mac = macWith({ folders: [] });
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    const vanishing: InstallSeams = {
      ...seams,
      names: ({ path }) => {
        if (path === HOLDS) {
          mac.folders.delete(HOLDS);
          throw fsError({ code: "ENOENT", path });
        }
        return seams.names({ path });
      },
    };
    expect(refuseDuringCall({ home: "/home", seams: vanishing }).isOk()).toBe(true);
  });

  it("refuses rather than reading no call when a folder cannot be listed, though existsSync calls it absent", () => {
    const mac = macWith({ folders: [] });
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    // A folder whose parent lost its execute bit: listing it is EACCES, and `existsSync` answers false.
    const unlistable: InstallSeams = {
      ...seams,
      exists: ({ path }) => path !== HOLDS && seams.exists({ path }),
      names: ({ path }) => {
        if (path === HOLDS) {
          throw fsError({ code: "EACCES", path });
        }
        return seams.names({ path });
      },
    };
    const refused = unwrapErr(refuseDuringCall({ home: "/home", seams: unlistable }));
    expect(refused.code).toBe("STEP_FAILED");
    expect(refused.message).toContain(`EACCES: ${HOLDS}`);
  });

  it("refuses rather than reading no call when a listed lease cannot be read", () => {
    const mac = macWith({ folders: [] });
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    const unreadable: InstallSeams = {
      ...seams,
      readText: ({ path }) => {
        throw fsError({ code: "EMFILE", path });
      },
    };
    const refused = unwrapErr(refuseDuringCall({ home: "/home", seams: unreadable }));
    expect(refused.code).toBe("STEP_FAILED");
    expect(refused.message).toContain(`EMFILE: ${HOLDS}/call-1.json`);
  });

  it("reads a lease swept between the listing and the read as holding nothing", () => {
    const mac = macWith({ folders: [] });
    writeLease({ mac, untilMs: NOW_MS + 30_000 });
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    const swept: InstallSeams = {
      ...seams,
      readText: ({ path }) => {
        throw fsError({ code: "ENOENT", path });
      },
    };
    expect(refuseDuringCall({ home: "/home", seams: swept }).isOk()).toBe(true);
  });

  it("never reads the heartbeat's temporary file beside a lease as one", () => {
    const mac = macWith({ folders: [] });
    writeLease({ mac, untilMs: NOW_MS - 1 });
    mac.folders.set(`${HOLDS}/call-1.json.4242.tmp`, { mtimeMs: 1, tag: "lease" });
    mac.files.set(`${HOLDS}/call-1.json.4242.tmp`, JSON.stringify({ callId: "call-1", untilMs: NOW_MS + 30_000 }));
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    expect(refuseDuringCall({ home: "/home", seams }).isOk()).toBe(true);
  });
});
