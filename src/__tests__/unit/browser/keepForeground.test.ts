import { describe, expect, it } from "vitest";

import { CHROME_BUNDLE_ID, type ForegroundCommand, type ForegroundRun } from "../../../browser/foreground.js";
import {
  attachInBackground,
  attachRestoreAction,
  BACKGROUND_ATTACH_ARGS,
  releaseInBackground,
} from "../../../browser/keepForeground.js";
import { ATTACH_FOREGROUND_COMMANDS_MAX, RELEASE_FOREGROUND_COMMANDS_MAX } from "../../../browser/lookBudget.js";

const SLACK = "com.tinyspeck.slackmacgap";

/** The read of Chrome's window order, front to back. */
const WINDOW_IDS =
  'osascript -e if application "Google Chrome" is running then tell application "Google Chrome" to get id of every window';

/* The raise as the fake sees it: hide the window, then show it again. */
function raiseLine({ windowId }: { windowId: number }): string {
  const window = `window id ${String(windowId)}`;
  return `osascript -e tell application "Google Chrome" -e set visible of ${window} to false -e set visible of ${window} to true -e end tell`;
}

/** A fake macOS: one front app, and Chrome's windows front to back — the first is Chrome's front window. */
interface Screen {
  bundleId: string;
  order: number[];
}

/* Move one window to the top of Chrome's own stack. */
function toTop({ screen, windowId }: { screen: Screen; windowId: number }): void {
  screen.order = [windowId, ...screen.order.filter((id) => id !== windowId)];
}

/**
 * A foreground seam over a fake screen that records every command it is asked to run, and obeys the two
 * restores the way macOS does. A raise reorders Chrome's windows and activates nothing, as measured.
 */
function fakeMac({ screen, log }: { screen: Screen; log: string[] }): ForegroundRun {
  return (command: ForegroundCommand) => {
    const line = [command.file, ...command.args].join(" ");
    log.push(line);
    if (command.file === "lsappinfo" && command.args[0] === "front") {
      return "ASN:0x0-0x1:\n";
    }
    if (command.file === "lsappinfo") {
      return `"CFBundleIdentifier"="${screen.bundleId}"\n`;
    }
    if (command.file === "open") {
      screen.bundleId = command.args[1]!;
      return "";
    }
    const raised = /set visible of window id (\d+) to true -e end tell$/u.exec(line);
    if (raised !== null) {
      toTop({ screen, windowId: Number(raised[1]) });
      return "";
    }
    if (line === WINDOW_IDS) {
      return `${screen.order.join(", ")}\n`;
    }
    return `${String(screen.order[0])}\n`;
  };
}

/** What the attach does to the screen: Chrome activates and the extension focuses the agent window, 42. */
const stealFocus =
  ({ screen, log }: { screen: Screen; log: string[] }) =>
  (): string => {
    log.push("ATTACH");
    screen.bundleId = CHROME_BUNDLE_ID;
    toTop({ screen, windowId: 42 });
    return "attached";
  };

describe("the open path asks for no focus", () => {
  it("attaches with exactly the extension relay and no other argument", () => {
    expect(BACKGROUND_ATTACH_ARGS).toEqual(["attach", "--extension=chrome"]);
  });

  it("sends nothing but read-only probes before the attach, and nothing at all to the screen when the attach took nothing", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const run = fakeMac({ log, screen });
    attachInBackground({
      attach: () => {
        log.push("ATTACH");
        return "attached";
      },
      placement: "background",
      run,
    });
    expect(log).toEqual([
      "lsappinfo front",
      "lsappinfo info -only bundleid ASN:0x0-0x1:",
      WINDOW_IDS,
      "ATTACH",
      "lsappinfo front",
      "lsappinfo info -only bundleid ASN:0x0-0x1:",
      WINDOW_IDS,
    ]);
    expect(screen).toEqual({ bundleId: SLACK, order: [7] });
  });
});

describe("attachInBackground", () => {
  it("hands the foreground straight back to the app the owner was in, then raises their Chrome window over the agent's", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const result = attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "background",
      run: fakeMac({ log, screen }),
    });
    expect(result).toBe("attached");
    expect(log.slice(-3)).toEqual([`open -b ${SLACK}`, WINDOW_IDS, raiseLine({ windowId: 7 })]);
    expect(screen).toEqual({ bundleId: SLACK, order: [7, 42] });
  });

  it("raises the OWNER's Chrome window back over the agent's when they were reading Chrome, and raises nothing twice", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: CHROME_BUNDLE_ID, order: [7] };
    attachInBackground({ attach: stealFocus({ log, screen }), placement: "background", run: fakeMac({ log, screen }) });
    expect(log.slice(-2)).toEqual([raiseLine({ windowId: 7 }), WINDOW_IDS]);
    expect(screen).toEqual({ bundleId: CHROME_BUNDLE_ID, order: [7, 42] });
  });

  it("raises the owner's window over the agent's when they are in another app and Chrome was never activated", () => {
    const log: string[] = [];
    const cmux = "com.cmuxterm.app";
    const screen: Screen = { bundleId: cmux, order: [7] };
    attachInBackground({
      attach: () => {
        log.push("ATTACH");
        toTop({ screen, windowId: 42 });
        return "attached";
      },
      placement: "background",
      run: fakeMac({ log, screen }),
    });
    expect(log.filter((line) => line.startsWith("open"))).toEqual([]);
    expect(log.at(-1)).toBe(raiseLine({ windowId: 7 }));
    expect(screen).toEqual({ bundleId: cmux, order: [7, 42] });
  });

  it("raises nothing when a failed attach leaves Chrome activated on the OWNER's window, the top already", () => {
    const log: string[] = [];
    const cmux = "com.cmuxterm.app";
    const screen: Screen = { bundleId: cmux, order: [7, 55] };
    const activatesOnly = (): string => {
      log.push("ATTACH");
      screen.bundleId = CHROME_BUNDLE_ID;
      throw new Error("extension did not connect");
    };
    expect(() =>
      attachInBackground({ attach: activatesOnly, placement: "background", run: fakeMac({ log, screen }) }),
    ).toThrow("extension did not connect");
    expect(log.filter((line) => line.includes("set visible"))).toEqual([]);
    expect(screen).toEqual({ bundleId: cmux, order: [7, 55] });
  });

  it("leaves the agent window where it is when the owner was already watching it", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: CHROME_BUNDLE_ID, order: [42, 7] };
    attachInBackground({ attach: stealFocus({ log, screen }), placement: "background", run: fakeMac({ log, screen }) });
    expect(log.filter((line) => line.startsWith("open") || line.includes("set visible"))).toEqual([]);
    expect(screen).toEqual({ bundleId: CHROME_BUNDLE_ID, order: [42, 7] });
  });

  it("still gives the foreground back when the attach throws, and lets the throw through", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const failing = (): string => {
      stealFocus({ log, screen })();
      throw new Error("extension did not connect");
    };
    expect(() =>
      attachInBackground({ attach: failing, placement: "background", run: fakeMac({ log, screen }) }),
    ).toThrow("extension did not connect");
    expect(screen.bundleId).toBe(SLACK);
  });
});

describe("a run that chose to show its window", () => {
  it("runs the attach and nothing else — no probe, no restore, no raise", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const result = attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "foreground",
      run: fakeMac({ log, screen }),
    });
    expect(result).toBe("attached");
    expect(log).toEqual(["ATTACH"]);
    expect(screen).toEqual({ bundleId: CHROME_BUNDLE_ID, order: [42, 7] });
  });
});

describe("a restore macOS refuses is said, never swallowed", () => {
  /** The owner's Mac with Automation for Chrome withdrawn: every window raise and app activation is refused. */
  const refusingMac = ({ screen, log }: { screen: Screen; log: string[] }): ForegroundRun => {
    const mac = fakeMac({ log, screen });
    return (command) => {
      if (command.file === "open" || command.args.some((arg) => arg.includes("set visible"))) {
        log.push(`REFUSED ${command.file}`);
        throw new Error("Not authorised to send Apple events to Google Chrome. (-1743)");
      }
      return mac(command);
    };
  };

  it("reports an attach whose restore and raise were both refused, and the agent window is left on top", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: CHROME_BUNDLE_ID, order: [7] };
    const result = attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "background",
      report: (line) => said.push(line),
      run: refusingMac({ log, screen }),
    });
    expect(result).toBe("attached");
    expect(screen.order).toEqual([42, 7]);
    expect(said).toEqual([
      "browser: an agent Chrome window may still be in front of yours — the restore command failed: Not authorised to send Apple events to Google Chrome. (-1743)",
      "browser: your Chrome window could not be raised over the agent's, so switching to Chrome may land on it — the restore command failed: Not authorised to send Apple events to Google Chrome. (-1743)",
    ]);
  });

  it("reports a close whose restore was refused", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    releaseInBackground({
      release: () => {
        screen.bundleId = CHROME_BUNDLE_ID;
        return [];
      },
      report: (line) => said.push(line),
      run: refusingMac({ log, screen }),
    });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("the restore command failed");
  });

  it("reports a restore that threw a value with no string form", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const mac = fakeMac({ log, screen });
    attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "background",
      report: (line) => said.push(line),
      run: (command) => {
        if (command.file === "open") {
          throw Object.create(null);
        }
        return mac(command);
      },
    });
    expect(said).toEqual([
      "browser: an agent Chrome window may still be in front of yours — the restore command failed: a thrown object that is not an Error",
    ]);
  });

  it("still puts the owner's app back when Chrome refuses to name its window after the attach, and says their window could not be raised", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const mac = fakeMac({ log, screen });
    const refusesWindowQuery: ForegroundRun = (command) => {
      if (command.file === "osascript") {
        throw new Error("Not authorised to send Apple events to Google Chrome. (-1743)");
      }
      return mac(command);
    };
    attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "background",
      report: (line) => said.push(line),
      run: refusesWindowQuery,
    });
    expect(log.at(-1)).toBe(`open -b ${SLACK}`);
    expect(screen.bundleId).toBe(SLACK);
    expect(said).toEqual([
      "browser: Chrome would not name the agent's window, so yours could not be raised over it — switching to Chrome may land on it",
    ]);
  });

  it("says their window could not be raised when the owner is in another app and Chrome will not list its windows", () => {
    const log: string[] = [];
    const said: string[] = [];
    const cmux = "com.cmuxterm.app";
    const screen: Screen = { bundleId: cmux, order: [7] };
    const mac = fakeMac({ log, screen });
    attachInBackground({
      attach: () => {
        toTop({ screen, windowId: 42 });
        return "attached";
      },
      placement: "background",
      report: (line) => said.push(line),
      run: (command) => {
        if (command.file === "osascript") {
          throw new Error("Not authorised to send Apple events to Google Chrome. (-1743)");
        }
        return mac(command);
      },
    });
    expect(screen).toEqual({ bundleId: cmux, order: [42, 7] });
    expect(said).toEqual([
      "browser: Chrome would not name the agent's window, so yours could not be raised over it — switching to Chrome may land on it",
    ]);
  });

  it("says so when the owner was in Chrome and Chrome will not name any window, so a change cannot be seen", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: CHROME_BUNDLE_ID, order: [7] };
    const mac = fakeMac({ log, screen });
    const refusesWindowQuery: ForegroundRun = (command) => {
      if (command.file === "osascript") {
        throw new Error("Not authorised to send Apple events to Google Chrome. (-1743)");
      }
      return mac(command);
    };
    attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "background",
      report: (line) => said.push(line),
      run: refusesWindowQuery,
    });
    expect(said).toEqual([
      "browser: Chrome would not name its front window, so whether an agent window is in front of yours could not be checked",
    ]);
  });

  it("says so when the foreground cannot be read at all", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const noLsappinfo: ForegroundRun = (command) => {
      log.push(command.file);
      throw new Error("spawnSync lsappinfo ENOENT");
    };
    attachInBackground({
      attach: stealFocus({ log, screen }),
      placement: "background",
      report: (line) => said.push(line),
      run: noLsappinfo,
    });
    expect(said).toEqual([
      "browser: the macOS foreground could not be read, so whether an agent window is in front of yours could not be checked",
    ]);
  });

  it("says nothing when the restore decided to leave the screen alone", () => {
    const said: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    releaseInBackground({
      release: () => [],
      report: (line) => said.push(line),
      run: refusingMac({ log: [], screen }),
    });
    expect(said).toEqual([]);
  });
});

describe("attachRestoreAction decides from ONE reading after the attach", () => {
  const slack = { bundleId: SLACK, chromeWindowId: null };

  it("puts the owner's app back when that reading shows the agent's Chrome window in front", () => {
    const now = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 42 };
    expect(attachRestoreAction({ before: slack, now })).toEqual({ bundleId: SLACK, kind: "activate-app" });
  });

  it("raises the owner's own Chrome window when they were already reading Chrome", () => {
    const before = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 7 };
    const now = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 42 };
    expect(attachRestoreAction({ before, now })).toEqual({ kind: "raise-window", windowId: 7 });
  });

  it("leaves the owner's window alone when the attach did not take it", () => {
    const before = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 7 };
    expect(attachRestoreAction({ before, now: before }).kind).toBe("leave");
  });

  it("puts the owner's app back when Chrome is in front but will not name its window", () => {
    const now = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: null };
    expect(attachRestoreAction({ before: slack, now })).toEqual({ bundleId: SLACK, kind: "activate-app" });
  });

  it("does nothing when the attach moved nothing", () => {
    expect(attachRestoreAction({ before: slack, now: slack }).kind).toBe("leave");
  });
});

describe("releaseInBackground", () => {
  it("puts back the app the close moved the owner off", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    const closed = releaseInBackground({
      release: () => {
        screen.bundleId = CHROME_BUNDLE_ID;
        return ["closed"];
      },
      run: fakeMac({ log, screen }),
    });
    expect(closed).toEqual(["closed"]);
    expect(log.at(-1)).toBe(`open -b ${SLACK}`);
    expect(screen.bundleId).toBe(SLACK);
  });

  it("says nothing and raises nothing when the close took the window the owner was watching", () => {
    const log: string[] = [];
    const said: string[] = [];
    const screen: Screen = { bundleId: CHROME_BUNDLE_ID, order: [42, 7] };
    releaseInBackground({
      release: () => {
        screen.order = [7];
        return [];
      },
      report: (line) => said.push(line),
      run: fakeMac({ log, screen }),
    });
    expect(said).toEqual([]);
    expect(log.filter((line) => line.includes("set visible"))).toEqual([]);
    expect(log.at(-1)).toBe(WINDOW_IDS);
  });

  it("touches nothing when the close moved nothing", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: SLACK, order: [7] };
    releaseInBackground({ release: () => [], run: fakeMac({ log, screen }) });
    expect(log.filter((line) => line.startsWith("open") || line.startsWith("osascript"))).toEqual([]);
  });
});

/* How many foreground commands one wrapper ran, the client's own step left out. */
function foregroundCount({ log }: { log: readonly string[] }): number {
  return log.filter((line) => line !== "ATTACH").length;
}

describe("the foreground commands a deadline has to count", () => {
  it("runs no more around an attach than ATTACH_FOREGROUND_COMMANDS_MAX, whichever app the owner was in", () => {
    const counts = [SLACK, CHROME_BUNDLE_ID].map((bundleId) => {
      const log: string[] = [];
      const screen: Screen = { bundleId, order: [7] };
      attachInBackground({
        attach: stealFocus({ log, screen }),
        placement: "background",
        run: fakeMac({ log, screen }),
      });
      return foregroundCount({ log });
    });
    expect(counts).toEqual([9, 9]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(ATTACH_FOREGROUND_COMMANDS_MAX);
  });

  it("runs no more around a close than RELEASE_FOREGROUND_COMMANDS_MAX when the close moved the owner's window", () => {
    const log: string[] = [];
    const screen: Screen = { bundleId: CHROME_BUNDLE_ID, order: [7, 42] };
    releaseInBackground({
      release: () => {
        toTop({ screen, windowId: 42 });
        return [];
      },
      run: fakeMac({ log, screen }),
    });
    expect(foregroundCount({ log })).toBe(8);
    expect(foregroundCount({ log })).toBeLessThanOrEqual(RELEASE_FOREGROUND_COMMANDS_MAX);
  });
});
