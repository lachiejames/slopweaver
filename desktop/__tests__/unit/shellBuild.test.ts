/**
 * The app reads the commit it was built from out of its own Info.plist, in exactly the keys the install writes.
 */
import { describe, expect, it } from "vitest";

import { stampArgs, STAMP_KEYS as WRITTEN_KEYS } from "../../../src/desktop/buildStamp.js";
import { ownInfoPlist, STAMP_KEYS, shellBuildWire, stampOfPlist } from "../../src/shellBuild";

const SHA = "461e873ed0f301ebbd167766265eea51f8db26be";
const ISO = "2026-10-05T16:54:25Z";
const STAMP = { committedIso: ISO, sha: SHA, tree: "clean" as const };

/** An Info.plist in electron-builder's XML layout, with the install's stamp flags written in as `<string>`s. */
const stampedPlist = ({ args }: { args: readonly string[] }): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>CFBundleIdentifier</key>\n\t<string>ai.slopweaver.desktop</string>",
    ...args
      .map((arg) => arg.slice("--config.mac.extendInfo.".length).split("="))
      .map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`),
    "</dict>",
    "</plist>",
  ].join("\n");

describe("STAMP_KEYS", () => {
  it("are the keys the install writes", () => {
    expect(STAMP_KEYS).toEqual(WRITTEN_KEYS);
  });
});

describe("stampOfPlist", () => {
  it("reads the stamp the install writes", () => {
    expect(stampOfPlist({ plist: stampedPlist({ args: stampArgs({ stamp: STAMP }) }) })).toEqual(STAMP);
  });

  it("reads a build from before stamps, or an unreadable file, as no stamp", () => {
    expect(stampOfPlist({ plist: stampedPlist({ args: [] }) })).toBe(undefined);
    expect(stampOfPlist({ plist: undefined })).toBe(undefined);
  });

  it("refuses a malformed sha", () => {
    const args = stampArgs({ stamp: { ...STAMP, sha: "461e873" } });
    expect(stampOfPlist({ plist: stampedPlist({ args }) })).toBe(undefined);
  });
});

describe("ownInfoPlist", () => {
  it("is the Info.plist of the bundle the executable sits in", () => {
    expect(ownInfoPlist({ execPath: "/Applications/Slopweaver.app/Contents/MacOS/Slopweaver" })).toBe(
      "/Applications/Slopweaver.app/Contents/Info.plist",
    );
  });
});

describe("shellBuildWire", () => {
  it("sends both stamps for the packaged app, null where there is none", () => {
    expect(shellBuildWire({ dev: false, installed: STAMP, running: undefined })).toEqual({
      dev: false,
      installed: STAMP,
      running: null,
    });
  });

  it("sends no stamp for a run from source", () => {
    expect(shellBuildWire({ dev: true, installed: STAMP, running: STAMP })).toEqual({
      dev: true,
      installed: null,
      running: null,
    });
  });
});
