/*
 * The foreground commands as argv rather than shell: the four programs named, no argument joined into a shell
 * line, and a raise that never uses `set index`.
 */
import { describe, expect, it } from "vitest";

import {
  activateAppCommand,
  bundleIdCommand,
  chromeFrontWindowCommand,
  chromeWindowIdsCommand,
  frontAsnCommand,
  raiseChromeWindowCommand,
} from "../../../../browser/foreground.js";

describe("the commands, as argv rather than shell", () => {
  it("names the four programs and never joins an argument into a shell line", () => {
    expect(frontAsnCommand()).toEqual({ args: ["front"], file: "lsappinfo" });
    expect(bundleIdCommand({ asn: "ASN:0x0-0x18018:" })).toEqual({
      args: ["info", "-only", "bundleid", "ASN:0x0-0x18018:"],
      file: "lsappinfo",
    });
    expect(chromeFrontWindowCommand()).toEqual({
      args: ["-e", 'tell application "Google Chrome" to get id of window 1'],
      file: "osascript",
    });
    expect(raiseChromeWindowCommand({ windowId: 2109125256 })).toEqual({
      args: [
        "-e",
        'tell application "Google Chrome"',
        "-e",
        "set visible of window id 2109125256 to false",
        "-e",
        "set visible of window id 2109125256 to true",
        "-e",
        "end tell",
      ],
      file: "osascript",
    });
    expect(activateAppCommand({ bundleId: "com.tinyspeck.slackmacgap" })).toEqual({
      args: ["-b", "com.tinyspeck.slackmacgap"],
      file: "open",
    });
    expect(chromeWindowIdsCommand()).toEqual({
      args: [
        "-e",
        'if application "Google Chrome" is running then tell application "Google Chrome" to get id of every window',
      ],
      file: "osascript",
    });
  });

  it("never raises with set index, which Chrome ignores while a screen-share bar holds index 1", () => {
    expect(raiseChromeWindowCommand({ windowId: 2109125256 }).args.join(" ")).not.toContain("set index");
    expect(raiseChromeWindowCommand({ windowId: 2109125256 }).args.join(" ")).toContain("window id 2109125256");
  });
});
