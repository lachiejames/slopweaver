/*
 * The edge a monitor card's sign-in page opens through: the launch shape is pure and asserted exactly, and an
 * install with no recorded work profile refuses before anything launches — a page must never open in whichever
 * profile Chrome last used.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openInWorkChrome, pinLaunchCommand } from "../../../browser/openInWorkChrome.js";
import { unwrapErr } from "../../../lib/result.js";
import { memoryRecordedProfilePort } from "../../recordedProfileFixture.js";

describe("pinLaunchCommand", () => {
  it("backgrounds the pin on the page through a shell, both as positional parameters", () => {
    expect(
      pinLaunchCommand({ pin: "/home/.slopweaver/chrome-pin.sh", url: "https://app.datadoghq.com/account/login" }),
    ).toEqual({
      args: [
        "-c",
        'nohup "$0" "$1" >/dev/null 2>&1 &',
        "/home/.slopweaver/chrome-pin.sh",
        "https://app.datadoghq.com/account/login",
      ],
      program: "/bin/sh",
    });
  });

  it("never splices a page carrying shell syntax into the script", () => {
    const url = "https://example.com/?a=1&b=$(touch /tmp/x)";
    expect(pinLaunchCommand({ pin: "/p", url }).args).toEqual(["-c", 'nohup "$0" "$1" >/dev/null 2>&1 &', "/p", url]);
  });
});

describe("openInWorkChrome", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("refuses, launching nothing, when the install has recorded no work profile", async () => {
    const home = mkdtempSync(join(tmpdir(), "open-work-chrome-"));
    homes.push(home);
    const opened = await openInWorkChrome({
      home,
      profiles: memoryRecordedProfilePort(),
      url: "https://app.datadoghq.com/account/login",
    });
    expect(unwrapErr(opened)).toContain("no work Chrome pin to open it through");
  });
});
