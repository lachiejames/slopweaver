import { describe, expect, it } from "vitest";

import { shotPathOf } from "../../../../../cli/commands/desktop/e2eDriver.js";
import { consolePathOfUrl, freshLedger } from "../../../../../cli/commands/desktop/e2ePage.js";
import { DesktopE2eErrors } from "../../../../../desktop/e2eErrors.js";

describe("shotPathOf", () => {
  it("numbers a photograph from one, padded so the folder lists in walk order", () => {
    expect(shotPathOf({ id: "queue", index: 0, out: "/proof/run" })).toBe("/proof/run/01-queue.png");
    expect(shotPathOf({ id: "docs", index: 14, out: "/proof/run" })).toBe("/proof/run/15-docs.png");
    expect(shotPathOf({ id: "pages", index: 15, out: "/proof/run" })).toBe("/proof/run/16-pages.png");
  });
});

describe("consolePathOfUrl", () => {
  it("reads a console address as its path, query and fragment dropped", () => {
    expect(consolePathOfUrl({ url: "http://localhost:3000/queue?open=post%3Asd-1&context=work" })).toBe("/queue");
    expect(consolePathOfUrl({ url: "http://localhost:3000/fleet#settings/models" })).toBe("/fleet");
  });

  it("reads a page off the console as no path at all", () => {
    expect(consolePathOfUrl({ url: "data:text/html,<p>note</p>" })).toBeUndefined();
    expect(consolePathOfUrl({ url: "about:blank" })).toBeUndefined();
  });
});

describe("freshLedger", () => {
  it("starts a step with nothing written against it", () => {
    expect(freshLedger()).toEqual({ consoleErrors: [], pageErrors: [], serverErrors: [] });
  });
});

describe("DesktopE2eErrors", () => {
  it("refuses an old build by name, saying nothing was launched", () => {
    const refused = DesktopE2eErrors.unsupportedBuild({ path: "/Applications/Slopweaver.app" });
    expect(refused.code).toBe("UNSUPPORTED_BUILD");
    expect(refused.message).toContain("nothing was launched");
  });

  it("points a console that never showed at the verb that checks it", () => {
    const stopped = DesktopE2eErrors.consoleNeverShown({ seconds: 90 });
    expect(stopped.code).toBe("CONSOLE_NEVER_SHOWN");
    expect(stopped.message).toContain("within 90s");
    expect(stopped.message).toContain("slopweaver checkout console");
  });

  it("names the bundle a launch failed on, and why", () => {
    const failed = DesktopE2eErrors.launchFailed({ detail: "spawn ENOENT", path: "/tmp/Slopweaver.app" });
    expect(failed.code).toBe("LAUNCH_FAILED");
    expect(failed.message).toBe("could not launch /tmp/Slopweaver.app as a test instance: spawn ENOENT");
  });
});
