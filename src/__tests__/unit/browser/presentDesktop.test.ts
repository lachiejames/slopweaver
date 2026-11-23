/**
 * `browser present --page` opens a published page as a new tab in the installed desktop app (the Queue in its one
 * pinned tab), never the owner's Chrome; Chrome
 * only where the app is conclusively absent, and an unreadable installation is an error rather than a fall back.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ForegroundCommand, ForegroundRun } from "../../../browser/foreground.js";
import {
  bundleIdentifierCommand,
  type DesktopPageSeam,
  desktopOpenCommand,
  openConsolePathInDesktop,
  PresentDesktopErrors,
  readDesktopInstallation,
} from "../../../browser/presentDesktop.js";
import { runPresent } from "../../../cli/commands/browser/presentRun.js";
import type { SlackAppSeam } from "../../../cli/commands/browser/presentSlackApp.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { PublishedAmong } from "../../../pages/published.js";
import { memoryRecordedProfilePort } from "../../recordedProfileFixture.js";

const SLUG = "fleet-briefing-2-nov";
const DEEP_LINK = "slopweaver://open?path=%2Fapi%2Fpage%2Ffleet-briefing-2-nov%2Findex.html";
const REQUESTED = "http://localhost:3000/api/page/fleet-briefing-2-nov/index.html";
const PAGE_PATH = "/api/page/fleet-briefing-2-nov/index.html";
const SETTINGS_URL = "http://localhost:3000/queue#settings/appearance";
const SETTINGS_LINK = "slopweaver://open?path=%2Fqueue%23settings%2Fappearance";

/** A seam whose installation is fixed and whose every command is recorded. */
function recordingSeam({ installation }: { installation: ReturnType<DesktopPageSeam["installation"]> }): {
  seam: DesktopPageSeam;
  ran: ForegroundCommand[];
} {
  const ran: ForegroundCommand[] = [];
  return {
    ran,
    seam: {
      installation: () => installation,
      run: (command) => {
        ran.push(command);
        return "";
      },
    },
  };
}

/** A Slack seam a page present must never reach. */
const neverSlack: SlackAppSeam = {
  run: () => {
    throw new Error("the Slack app seam ran on a page present");
  },
  workspace: () => Promise.reject(new Error("the Slack workspace was read on a page present")),
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "present-desktop-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("openPublishedPageInDesktop", () => {
  it("hands the page's deep link to the desktop app by bundle, and answers that it opened there", () => {
    const { seam, ran } = recordingSeam({ installation: ok("installed") });
    const answer = unwrap(
      openConsolePathInDesktop({ deepLink: DEEP_LINK, path: PAGE_PATH, requestedUrl: REQUESTED, seam }),
    );
    expect(ran).toEqual([{ args: ["-a", "/Applications/Slopweaver.app", DEEP_LINK], file: "/usr/bin/open" }]);
    expect(answer!.openedIn).toBe("slopweaver-desktop-app");
    expect(answer!.deepLink).toBe(DEEP_LINK);
    expect(answer!.path).toBe("/api/page/fleet-briefing-2-nov/index.html");
    expect(answer!.requestedUrl).toBe(REQUESTED);
    expect(answer!.note).toBe(
      "The page opened as a new tab in front in the owner's Slopweaver desktop app; the owner's Chrome was not touched and nothing on " +
        "the page was clicked or typed.",
    );
  });

  // Told "a new tab in front" for the Queue, the voice left the owner on a duplicate tab.
  it("tells the voice a Queue address opened in the owner's one pinned Queue tab, never a second one", () => {
    const { seam } = recordingSeam({ installation: ok("installed") });
    const link = "slopweaver://open?path=%2Fqueue%3Fcontext%3Dslopweaver";
    const answer = unwrap(
      openConsolePathInDesktop({
        deepLink: link,
        path: "/queue?context=slopweaver",
        requestedUrl: "http://localhost:3000/queue?context=slopweaver",
        seam,
      }),
    );
    expect(answer!.note).toBe(
      "The page opened in the one pinned Queue tab of the owner's Slopweaver desktop app, shown in front, never a second " +
        "Queue tab; the owner's Chrome was not touched and nothing on the page was clicked or typed.",
    );
  });

  it("hands a console address's deep link to the app as given, and answers its path", () => {
    const { seam, ran } = recordingSeam({ installation: ok("installed") });
    const answer = unwrap(
      openConsolePathInDesktop({
        deepLink: SETTINGS_LINK,
        path: "/queue#settings/appearance",
        requestedUrl: SETTINGS_URL,
        seam,
      }),
    );
    expect(ran).toEqual([{ args: ["-a", "/Applications/Slopweaver.app", SETTINGS_LINK], file: "/usr/bin/open" }]);
    expect(answer!.path).toBe("/queue#settings/appearance");
    expect(answer!.requestedUrl).toBe(SETTINGS_URL);
  });

  it("answers nothing and opens nothing when the app is conclusively absent, so the caller takes Chrome", () => {
    const { seam, ran } = recordingSeam({ installation: ok("absent") });
    expect(
      unwrap(openConsolePathInDesktop({ deepLink: DEEP_LINK, path: PAGE_PATH, requestedUrl: REQUESTED, seam })),
    ).toBe(undefined);
    expect(ran).toEqual([]);
  });

  it("refuses, opening nothing, when the installation cannot be read", () => {
    const unreadable = PresentDesktopErrors.installUnreadable({
      bundle: "/Applications/Slopweaver.app",
      why: "EACCES",
    });
    const { seam, ran } = recordingSeam({ installation: err(unreadable) });
    const error = unwrapErr(
      openConsolePathInDesktop({ deepLink: DEEP_LINK, path: PAGE_PATH, requestedUrl: REQUESTED, seam }),
    );
    expect(error.code).toBe("DESKTOP_INSTALL_UNREADABLE");
    expect(error.message).toBe(
      "could not read whether the desktop app is installed at /Applications/Slopweaver.app: EACCES",
    );
    expect(ran).toEqual([]);
  });

  it("refuses when the app will not take the link, rather than falling back to the browser", () => {
    const seam: DesktopPageSeam = {
      installation: () => ok("installed"),
      run: () => {
        throw new Error("LSOpenURLsWithRole() failed with error -10814");
      },
    };
    const error = unwrapErr(
      openConsolePathInDesktop({ deepLink: DEEP_LINK, path: PAGE_PATH, requestedUrl: REQUESTED, seam }),
    );
    expect(error.code).toBe("DESKTOP_OPEN_FAILED");
    expect(error.message).toBe(
      `the desktop app at /Applications/Slopweaver.app did not take ${DEEP_LINK}: LSOpenURLsWithRole() failed with error -10814`,
    );
  });
});

describe("desktopOpenCommand", () => {
  it("names the bundle and /usr/bin/open by path, so no other app or PATH entry receives the console path", () => {
    expect(desktopOpenCommand({ deepLink: DEEP_LINK })).toEqual({
      args: ["-a", "/Applications/Slopweaver.app", DEEP_LINK],
      file: "/usr/bin/open",
    });
  });
});

describe("readDesktopInstallation", () => {
  /** A runner that answers every identifier read with `identifier`, recording what it was asked. */
  function identifierRun({ identifier }: { identifier: string }): { run: ForegroundRun; ran: ForegroundCommand[] } {
    const ran: ForegroundCommand[] = [];
    return {
      ran,
      run: (command) => {
        ran.push(command);
        return `${identifier}\n`;
      },
    };
  }

  it("is absent off macOS, whatever is on disk", () => {
    const { run, ran } = identifierRun({ identifier: "ai.slopweaver.desktop" });
    expect(unwrap(readDesktopInstallation({ bundle: home, platform: "linux", run }))).toBe("absent");
    expect(ran).toEqual([]);
  });

  it("is installed when the bundle there identifies as ai.slopweaver.desktop", () => {
    const { run, ran } = identifierRun({ identifier: "ai.slopweaver.desktop" });
    expect(unwrap(readDesktopInstallation({ bundle: home, platform: "darwin", run }))).toBe("installed");
    expect(ran).toEqual([bundleIdentifierCommand({ bundle: home })]);
  });

  it("refuses a foreign bundle at the path, so a decoy never receives a console path and Chrome is not taken", () => {
    const { run } = identifierRun({ identifier: "com.acme.decoy" });
    const error = unwrapErr(readDesktopInstallation({ bundle: home, platform: "darwin", run }));
    expect(error.code).toBe("DESKTOP_INSTALL_FOREIGN");
    expect(error.message).toBe(
      `the app at ${home} identifies as "com.acme.decoy", not ai.slopweaver.desktop; reinstall with slopweaver desktop install`,
    );
  });

  it("refuses an identifier padded with whitespace, which is not ours however it trims", () => {
    const { run } = identifierRun({ identifier: " ai.slopweaver.desktop " });
    expect(unwrapErr(readDesktopInstallation({ bundle: home, platform: "darwin", run })).code).toBe(
      "DESKTOP_INSTALL_FOREIGN",
    );
  });

  it("refuses a malformed identifier PlistBuddy still prints, rather than calling it absent", () => {
    const { run } = identifierRun({ identifier: "1" });
    expect(unwrapErr(readDesktopInstallation({ bundle: home, platform: "darwin", run })).code).toBe(
      "DESKTOP_INSTALL_FOREIGN",
    );
  });

  it("refuses when the bundle's identifier cannot be read, rather than calling it absent", () => {
    const run: ForegroundRun = () => {
      throw new Error('Print: Entry, ":CFBundleIdentifier", Does Not Exist');
    };
    const error = unwrapErr(readDesktopInstallation({ bundle: home, platform: "darwin", run }));
    expect(error.code).toBe("DESKTOP_INSTALL_UNREADABLE");
    expect(error.message).toContain("CFBundleIdentifier");
  });

  it("reads the identifier off the bundle's own Info.plist", () => {
    expect(bundleIdentifierCommand({ bundle: "/Applications/Slopweaver.app" })).toEqual({
      args: ["-c", "Print :CFBundleIdentifier", "/Applications/Slopweaver.app/Contents/Info.plist"],
      file: "/usr/libexec/PlistBuddy",
    });
  });

  it("refuses a dangling symlink at the bundle's path rather than calling it absent", () => {
    const dangling = join(home, "Slopweaver.app");
    symlinkSync(join(home, "Slopweaver-old.app"), dangling);
    const { run, ran } = identifierRun({ identifier: "ai.slopweaver.desktop" });
    const error = unwrapErr(readDesktopInstallation({ bundle: dangling, platform: "darwin", run }));
    expect(error.code).toBe("DESKTOP_INSTALL_UNREADABLE");
    expect(error.message).toContain("a symlink, not the installed bundle itself");
    expect(ran).toEqual([]);
  });

  it("refuses a LIVE symlink to a real bundle, whose target could be swapped before the open", () => {
    const target = join(home, "Current.app");
    mkdirSync(target);
    const link = join(home, "Slopweaver.app");
    symlinkSync(target, link);
    const { run, ran } = identifierRun({ identifier: "ai.slopweaver.desktop" });
    const error = unwrapErr(readDesktopInstallation({ bundle: link, platform: "darwin", run }));
    expect(error.code).toBe("DESKTOP_INSTALL_UNREADABLE");
    expect(error.message).toBe(
      `could not read whether the desktop app is installed at ${link}: a symlink, not the installed bundle itself`,
    );
    expect(ran).toEqual([]);
  });

  it("refuses a regular file at the bundle's path rather than calling it absent", () => {
    const file = join(home, "Slopweaver.app");
    writeFileSync(file, "not a bundle");
    const { run, ran } = identifierRun({ identifier: "ai.slopweaver.desktop" });
    const error = unwrapErr(readDesktopInstallation({ bundle: file, platform: "darwin", run }));
    expect(error.code).toBe("DESKTOP_INSTALL_UNREADABLE");
    expect(error.message).toBe(
      `could not read whether the desktop app is installed at ${file}: not an app bundle directory`,
    );
    expect(ran).toEqual([]);
  });

  it("is absent when nothing is at the bundle's path", () => {
    const { run, ran } = identifierRun({ identifier: "ai.slopweaver.desktop" });
    expect(unwrap(readDesktopInstallation({ bundle: join(home, "Slopweaver.app"), platform: "darwin", run }))).toBe(
      "absent",
    );
    expect(ran).toEqual([]);
  });
});

describe("runPresent on a console page", () => {
  /** A store that publishes the one test page, so the slug resolves. */
  const slugPublished: PublishedAmong = async () => ok(new Set([SLUG]));

  it("opens a published page in the desktop app and never reads the Chrome profile", async () => {
    const { seam, ran } = recordingSeam({ installation: ok("installed") });
    const exit = await runPresent({
      desktopPage: seam,
      publishedAmong: slugPublished,
      destination: undefined,
      home,
      page: SLUG,
      profiles: memoryRecordedProfilePort(),
      slackApp: neverSlack,
      url: undefined,
    });
    expect(exit).toBe(EXIT_OK);
    expect(ran).toEqual([{ args: ["-a", "/Applications/Slopweaver.app", DEEP_LINK], file: "/usr/bin/open" }]);
  });

  it("opens the console's own Settings address in the desktop app — an open once refused", async () => {
    const { seam, ran } = recordingSeam({ installation: ok("installed") });
    const exit = await runPresent({
      desktopPage: seam,
      publishedAmong: slugPublished,
      destination: undefined,
      home,
      page: undefined,
      profiles: memoryRecordedProfilePort(),
      slackApp: neverSlack,
      url: SETTINGS_URL,
    });
    expect(exit).toBe(EXIT_OK);
    expect(ran).toEqual([{ args: ["-a", "/Applications/Slopweaver.app", SETTINGS_LINK], file: "/usr/bin/open" }]);
  });

  it("refuses a console API address before reaching the app or Chrome", async () => {
    const { seam, ran } = recordingSeam({ installation: ok("installed") });
    const exit = await runPresent({
      desktopPage: seam,
      publishedAmong: slugPublished,
      destination: undefined,
      home,
      page: undefined,
      profiles: memoryRecordedProfilePort(),
      slackApp: neverSlack,
      url: "http://localhost:3000/api/live/depth",
    });
    expect(exit).toBe(EXIT_USAGE);
    expect(ran).toEqual([]);
  });

  it("fails without touching Chrome when the installation cannot be read", async () => {
    const { seam, ran } = recordingSeam({
      installation: err(PresentDesktopErrors.installUnreadable({ bundle: "/Applications/Slopweaver.app", why: "EIO" })),
    });
    const exit = await runPresent({
      desktopPage: seam,
      publishedAmong: slugPublished,
      destination: undefined,
      home,
      page: SLUG,
      profiles: memoryRecordedProfilePort(),
      slackApp: neverSlack,
      url: undefined,
    });
    expect(exit).toBe(EXIT_ERROR);
    expect(ran).toEqual([]);
  });
});
