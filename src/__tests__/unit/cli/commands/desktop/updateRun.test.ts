/**
 * `slopweaver desktop update`'s line — wait for an ended call's lease, fast-forward, install — over a fake Mac, and
 * its leave-the-app-running step after a failure. The install and the sync are plain fakes passed in.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { cachePaths } from "../../../../../cacheHome.js";
import { DESKTOP_UPDATE_USAGE } from "../../../../../cli/commands/desktop/desktopUsage.js";
import type { InstallSeams, ProgramCall } from "../../../../../cli/commands/desktop/installSeams.js";
import { reopenIfGone, runDesktopUpdate, updateHeld } from "../../../../../cli/commands/desktop/updateRun.js";
import { desktopManifest } from "../../../../../cli/manifests/desktop.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../../../desktop/errors.js";
import { INSTALLED_BUNDLE } from "../../../../../desktop/installPlan.js";
import { CALL_END_WAIT_MS } from "../../../../../desktop/updateOutcome.js";

const HOME = "/home";
const MAIN = "/main";
const SHA = "461e873ed0f301ebbd167766265eea51f8db26be";
const START_MS = Date.parse("2026-10-10T03:30:00Z");
const HOLD = join(cachePaths().docsSite, "slopweaver-1a2b3c4d.hold");

/** The fake Mac's mutable parts: its clock, the call lease, what it printed and ran. */
interface FakeMac {
  nowMs: number;
  /** The one call lease's expiry, or `undefined` for no call. */
  leaseUntilMs: number | undefined;
  /** When the call's lease is cleared, as a hang-up's last beat would; `undefined` for a lease left to lapse. */
  clearsAtMs: number | undefined;
  readonly lines: string[];
  readonly runs: ProgramCall[];
  /** What `ps` prints. */
  ps: string;
  installed: boolean;
}

/** A Mac with no call, the app not running, and one installed. */
function macWith(over: Partial<FakeMac> = {}): FakeMac {
  return {
    clearsAtMs: undefined,
    installed: true,
    leaseUntilMs: undefined,
    lines: [],
    nowMs: START_MS,
    ps: "",
    runs: [],
    ...over,
  };
}

/** A filesystem error carrying `code`, as `node:fs` throws. */
function gone({ path }: { path: string }): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

/** The seams over a fake Mac, running from `running`. */
function seamsOf({ mac, running = MAIN }: { mac: FakeMac; running?: string }): InstallSeams {
  const leaseLive = (): boolean =>
    mac.leaseUntilMs !== undefined && (mac.clearsAtMs === undefined || mac.nowMs < mac.clearsAtMs);
  return {
    entries: () => [],
    exists: ({ path }) => path === INSTALLED_BUNDLE && mac.installed,
    mainCheckout: () => ok(MAIN),
    move: () => undefined,
    names: ({ path }) => {
      if (path === cachePaths().docsSite) {
        return ["slopweaver-1a2b3c4d.hold"];
      }
      if (path === join(HOLD, "calls") && leaseLive()) {
        return ["call.json"];
      }
      throw gone({ path });
    },
    nonce: "7",
    nowMs: () => mac.nowMs,
    out: ({ line }) => {
      mac.lines.push(line);
    },
    pause: async ({ ms }) => {
      mac.nowMs += ms;
      await Promise.resolve();
    },
    quit: () => undefined,
    readText: ({ path }) => {
      if (path === join(HOLD, "calls", "call.json") && leaseLive()) {
        return JSON.stringify({ untilMs: mac.leaseUntilMs });
      }
      throw gone({ path });
    },
    remove: () => undefined,
    run: (call) => {
      mac.runs.push(call);
      if (call.command === "git") {
        return ok(`${SHA}\n`);
      }
      if (call.command === "/bin/ps") {
        return ok(mac.ps);
      }
      return ok("");
    },
    runningRoot: () => running,
    tempFolder: () => "/tmp/build",
    writeText: () => undefined,
  };
}

/** The two slow steps, recording what they were asked. */
function stepsOf({
  synced = { lines: ["/main: fast-forwarded"], ok: true },
  installed = ok(undefined),
}: {
  synced?: { readonly ok: boolean; readonly lines: readonly string[] };
  installed?: Result<void, DesktopInstallError>;
} = {}): {
  readonly asked: string[];
  readonly steps: Parameters<typeof updateHeld>[0]["steps"];
} {
  const asked: string[] = [];
  return {
    asked,
    steps: {
      install: ({ home }) => {
        asked.push(`install ${home}`);
        return Promise.resolve(installed);
      },
      sync: ({ path }) => {
        asked.push(`sync ${path}`);
        return synced;
      },
    },
  };
}

describe("updateHeld", () => {
  it("fast-forwards the main checkout, installs, and answers the commit the new app is built from", async () => {
    const mac = macWith();
    const { asked, steps } = stepsOf();
    const done = await updateHeld({ home: HOME, seams: seamsOf({ mac }), steps });
    expect(unwrap(done)).toBe(SHA);
    expect(asked).toEqual(["sync /main", "install /home"]);
    expect(mac.lines).toEqual(["/main: fast-forwarded"]);
  });

  it("waits for a call the app has just ended to let go of the console, then goes on", async () => {
    const mac = macWith({ clearsAtMs: START_MS + 4_000, leaseUntilMs: START_MS + 60_000 });
    const { asked, steps } = stepsOf();
    const done = await updateHeld({ home: HOME, seams: seamsOf({ mac }), steps });
    expect(unwrap(done)).toBe(SHA);
    expect(mac.nowMs).toBe(START_MS + 4_000);
    expect(asked).toEqual(["sync /main", "install /home"]);
  });

  it("refuses a call that never lets go, touching nothing", async () => {
    const mac = macWith({ leaseUntilMs: START_MS + 10 * 60_000 });
    const { asked, steps } = stepsOf();
    const refused = unwrapErr(await updateHeld({ home: HOME, seams: seamsOf({ mac }), steps }));
    expect(refused.code).toBe("CALL_STILL_LIVE");
    expect(refused.message).toBe(
      "a voice call still held the console 75s after the update asked it to end, so nothing was touched and the " +
        "app kept running — end the call, then press update again",
    );
    expect(mac.nowMs).toBe(START_MS + CALL_END_WAIT_MS);
    expect(asked).toEqual([]);
  });

  it("refuses to run from anywhere but the main checkout, before the sync", async () => {
    const mac = macWith();
    const { asked, steps } = stepsOf();
    const refused = unwrapErr(await updateHeld({ home: HOME, seams: seamsOf({ mac, running: "/worktree" }), steps }));
    expect(refused.code).toBe("NOT_MAIN_CHECKOUT");
    expect(asked).toEqual([]);
  });

  it("builds nothing when the checkout cannot be brought up to date", async () => {
    const mac = macWith();
    const { asked, steps } = stepsOf({ synced: { lines: ["/main: REFUSED — the working tree is dirty"], ok: false } });
    const refused = unwrapErr(await updateHeld({ home: HOME, seams: seamsOf({ mac }), steps }));
    expect(refused.code).toBe("SYNC_REFUSED");
    expect(refused.message).toContain("/main: REFUSED — the working tree is dirty");
    expect(asked).toEqual(["sync /main"]);
  });

  it("carries the install's own failure whole", async () => {
    const mac = macWith();
    const rolledBack = DesktopInstallErrors.rolledBack({ cause: "the new build never ran", grantsCleared: false });
    const { steps } = stepsOf({ installed: err(rolledBack) });
    const refused = unwrapErr(await updateHeld({ home: HOME, seams: seamsOf({ mac }), steps }));
    expect(refused.code).toBe("INSTALL_FAILED");
    expect(refused.message).toBe(rolledBack.message);
  });
});

describe("reopenIfGone", () => {
  it("opens what is installed on the main checkout when no copy is running", () => {
    const mac = macWith();
    expect(reopenIfGone({ home: HOME, seams: seamsOf({ mac }) })).toBe(
      `reopen: no copy was running, so ${INSTALLED_BUNDLE} was opened again`,
    );
    expect(mac.runs.at(-1)).toEqual({
      args: [INSTALLED_BUNDLE, "--args", "--checkout", MAIN],
      command: "/usr/bin/open",
    });
  });

  it("leaves a running copy alone", () => {
    const mac = macWith({ ps: ` 412 ${INSTALLED_BUNDLE}/Contents/MacOS/Slopweaver --checkout /main` });
    expect(reopenIfGone({ home: HOME, seams: seamsOf({ mac }) })).toBe(undefined);
    expect(mac.runs.map((call) => call.command)).toEqual(["/bin/ps"]);
  });

  it("opens nothing when nothing is installed", () => {
    const mac = macWith({ installed: false });
    expect(reopenIfGone({ home: HOME, seams: seamsOf({ mac }) })).toBe(undefined);
    expect(mac.runs.map((call) => call.command)).toEqual(["/bin/ps"]);
  });
});

describe("runDesktopUpdate", () => {
  it("refuses an argument that is not the verb's before touching anything", async () => {
    expect(await runDesktopUpdate(["node", "slopweaver", "desktop", "update", "--bogus"])).toBe(2);
  });

  it("refuses a relative outcome path, which the launching app would read from another folder", async () => {
    expect(await runDesktopUpdate(["node", "slopweaver", "desktop", "update", "--outcome", "out.json"])).toBe(2);
  });
});

describe("desktopManifest", () => {
  it("declares update as a local-state verb whose usage is the verb's own", () => {
    expect(desktopManifest["update"]!.meta.effect).toBe("local-state");
    expect(desktopManifest["update"]!.meta.usage).toBe(DESKTOP_UPDATE_USAGE);
  });
});
