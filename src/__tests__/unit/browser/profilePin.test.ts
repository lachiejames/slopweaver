import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { chromePinScript, PIN_SCRIPT_MODE, resolveChromePin, writeChromePin } from "../../../browser/profilePin.js";
import { unwrap } from "../../../lib/result.js";
import { memoryRecordedProfilePort, unavailableRecordedProfilePort } from "../../recordedProfileFixture.js";

const BROWSER_BIN = "/opt/synthetic/Chrome.app/Contents/MacOS/Synthetic";

const dirs: string[] = [];

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-profile-pin-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("chromePinScript", () => {
  it("puts --profile-directory in front of whatever the relay appends", () => {
    const source = unwrap(chromePinScript({ directory: "Default", executablePath: BROWSER_BIN }));
    expect(source).toContain(`exec "${BROWSER_BIN}" --profile-directory="Default" --new-window "$@"`);
  });

  it("asks for a window the walk owns, so the connect page never joins the one the owner is reading in", () => {
    const source = unwrap(chromePinScript({ directory: "Default", executablePath: BROWSER_BIN }));
    expect(source).toContain('--new-window "$@"');
  });

  it("starts with a shebang so the relay can spawn it directly", () => {
    const source = unwrap(chromePinScript({ directory: "Profile 4", executablePath: BROWSER_BIN }));
    expect(source.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("keeps a profile directory with a space in one quoted word", () => {
    const source = unwrap(chromePinScript({ directory: "Profile 4", executablePath: BROWSER_BIN }));
    expect(source).toContain('--profile-directory="Profile 4"');
  });

  it("refuses a profile directory that would end its own shell quote", () => {
    const refused = chromePinScript({ directory: 'a" ; rm -rf ~ ; "b', executablePath: BROWSER_BIN });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("PIN_UNWRITABLE");
  });

  it("refuses an executable path that would end its own shell quote", () => {
    const refused = chromePinScript({ directory: "Default", executablePath: "/opt/$(whoami)/chrome" });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("PIN_UNWRITABLE");
  });
});

describe("writeChromePin", () => {
  it("writes the script owner-only, since it is a thing the machine executes", () => {
    const path = join(scratch(), "chrome-pin.sh");
    expect(unwrap(writeChromePin({ directory: "Default", executablePath: BROWSER_BIN, path }))).toBe(path);
    expect(statSync(path).mode & 0o777).toBe(PIN_SCRIPT_MODE);
  });

  it("rewrites the script, so a profile the owner moved off stops being steered at", () => {
    const path = join(scratch(), "chrome-pin.sh");
    unwrap(writeChromePin({ directory: "Default", executablePath: BROWSER_BIN, path }));
    unwrap(writeChromePin({ directory: "Profile 7", executablePath: BROWSER_BIN, path }));
    const written = readFileSync(path, "utf8");
    expect(written).toContain('--profile-directory="Profile 7"');
    expect(written).not.toContain('--profile-directory="Default"');
  });

  it("creates the directory it is asked to write into", () => {
    const path = join(scratch(), "nested", "deeper", "chrome-pin.sh");
    expect(unwrap(writeChromePin({ directory: "Default", executablePath: BROWSER_BIN, path }))).toBe(path);
  });
});

describe("resolveChromePin", () => {
  it("refuses before touching a browser when no profile has been recorded", async () => {
    const home = scratch();
    const refused = await resolveChromePin({
      home,
      path: join(home, "chrome-pin.sh"),
      profiles: memoryRecordedProfilePort(),
    });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("PROFILE_UNSET");
  });

  it("refuses a recorded document that carries no directory name", async () => {
    const home = scratch();
    writeFileSync(join(home, "browser.json"), JSON.stringify({ profileDirectory: "  " }), "utf8");
    const refused = await resolveChromePin({
      home,
      path: join(home, "chrome-pin.sh"),
      profiles: memoryRecordedProfilePort(),
    });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("PROFILE_REGISTER_MALFORMED");
  });

  it("refuses with the store's own code when the store cannot be reached, rather than guessing a profile", async () => {
    const home = scratch();
    const refused = await resolveChromePin({
      home,
      path: join(home, "chrome-pin.sh"),
      profiles: unavailableRecordedProfilePort(),
    });
    expect(refused._unsafeUnwrapErr().code).toBe("PROFILE_STORE_UNAVAILABLE");
  });
});

describe("the pin as the relay actually runs it", () => {
  /**
   * Run a generated pin whose "Chrome" is a script that records its argv and launches nothing — the same
   * technique that measured the relay's own launch. It proves what the real Chrome would be
   * handed without opening a single window in the owner's browser.
   */
  const argvThroughPin = ({ directory, url }: { directory: string; url: string }): readonly string[] => {
    const dir = scratch();
    const fakeChrome = join(dir, "fake-chrome.sh");
    const log = join(dir, "argv.txt");
    writeFileSync(fakeChrome, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\n`, {
      mode: 0o700,
    });
    const pin = join(dir, "chrome-pin.sh");
    unwrap(writeChromePin({ directory, executablePath: fakeChrome, path: pin }));
    execFileSync(pin, [url], { encoding: "utf8" });
    return readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
  };

  it("hands Chrome the profile, the window flag and the connect URL, in that order", () => {
    expect(argvThroughPin({ directory: "Default", url: "chrome-extension://abc/connect.html?token=x" })).toEqual([
      "--profile-directory=Default",
      "--new-window",
      "chrome-extension://abc/connect.html?token=x",
    ]);
  });

  it("keeps a profile name with a space as ONE argument, so the pin cannot silently unpin", () => {
    expect(argvThroughPin({ directory: "Profile 4", url: "https://example.com/" })[0]).toBe(
      "--profile-directory=Profile 4",
    );
  });

  it("passes a connect URL full of shell metacharacters through untouched", () => {
    const url = 'chrome-extension://abc/connect.html?client={"name":"Claude Code"}&t=a;b|c';
    expect(argvThroughPin({ directory: "Default", url })[2]).toBe(url);
  });
});
