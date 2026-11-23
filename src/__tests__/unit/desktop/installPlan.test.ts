/**
 * The install's pure decisions: which hosts it builds on, the hidden swap names, which other registered copies
 * it unregisters, which processes are the app, and what Spotlight's status and the app's saved state say.
 */
import { describe, expect, it } from "vitest";

import {
  BUNDLE_ID,
  desktopInstallArgs,
  hostSupported,
  INSTALLED_BUNDLE,
  leftoverPlan,
  openVerdict,
  registeredBundles,
  rememberedCheckout,
  runningPids,
  spotlightLine,
  spotlightState,
  staleRegistrations,
  swapPaths,
} from "../../../desktop/installPlan.js";
import { unwrapErr } from "../../../lib/result.js";

describe("hostSupported", () => {
  it("builds on macOS on Apple silicon", () => {
    expect(hostSupported({ arch: "arm64", platform: "darwin" }).isOk()).toBe(true);
  });

  it("names any other host", () => {
    expect(unwrapErr(hostSupported({ arch: "x64", platform: "darwin" })).message).toBe(
      "the desktop app is built for macOS on Apple silicon, and this is darwin/x64",
    );
  });
});

describe("swapPaths", () => {
  it("stages, backs up and discards under hidden names that are not apps", () => {
    expect(swapPaths({ applications: "/Applications", nonce: "42" })).toEqual({
      backup: "/Applications/.Slopweaver-previous-42",
      discard: "/Applications/.Slopweaver-discarded-42",
      installed: "/Applications/Slopweaver.app",
      staged: "/Applications/.Slopweaver-installing-42",
    });
  });
});

describe("leftoverPlan", () => {
  const entries = [
    { mtimeMs: 100, name: ".Slopweaver-previous-11" },
    { mtimeMs: 300, name: ".Slopweaver-previous-33" },
    { mtimeMs: 200, name: ".Slopweaver-installing-22" },
  ];

  it("puts the oldest backup back, since every newer one is a build overlapping installs never validated", () => {
    expect(leftoverPlan({ entries })).toEqual({
      remove: [".Slopweaver-previous-33", ".Slopweaver-installing-22"],
      restore: ".Slopweaver-previous-11",
    });
  });

  it("only deletes a staged copy when no backup survived", () => {
    expect(leftoverPlan({ entries: [{ mtimeMs: 1, name: ".Slopweaver-installing-9" }] })).toEqual({
      remove: [".Slopweaver-installing-9"],
      restore: undefined,
    });
  });

  it("deletes a discarded backup and never restores it, since its replacement was already trusted", () => {
    expect(leftoverPlan({ entries: [{ mtimeMs: 1, name: ".Slopweaver-discarded-7" }] })).toEqual({
      remove: [".Slopweaver-discarded-7"],
      restore: undefined,
    });
  });

  it("restores nothing on a first install with nothing left behind", () => {
    expect(leftoverPlan({ entries: [] })).toEqual({ remove: [], restore: undefined });
  });
});

/** One `lsregister -dump` record, in the shape macOS 27 prints it. */
function dumpRecord({ path, identifier }: { path: string; identifier: string }): string {
  return [
    "bundle id:                  Slopweaver (0x73c)",
    "isOnRootVolume:             true ",
    `path:                       ${path} (0x1648)`,
    "directory:                  /Applications",
    "name:                       Slopweaver",
    `identifier:                 ${identifier}`,
    "codeInfoID:                 x",
  ].join("\n");
}

const DUMP = [
  dumpRecord({ identifier: BUNDLE_ID, path: "/Users/me/repo/desktop/dist/mac-arm64/Slopweaver.app" }),
  dumpRecord({ identifier: BUNDLE_ID, path: INSTALLED_BUNDLE }),
  dumpRecord({ identifier: BUNDLE_ID, path: "/Users/me/repo/desktop/dist/mac-arm64/Slopweaver.app" }),
  dumpRecord({
    identifier: `${BUNDLE_ID}.helper`,
    path: "/Applications/Slopweaver.app/Contents/Frameworks/Slopweaver Helper.app",
  }),
  dumpRecord({ identifier: "com.example.archive", path: "/Users/me/Archive/Slopweaver.app" }),
].join(`\n${"-".repeat(80)}\n`);

describe("registeredBundles", () => {
  it("pairs each record's path with its own identifier", () => {
    expect(registeredBundles({ dump: DUMP }).map(({ identifier }) => identifier)).toEqual([
      BUNDLE_ID,
      BUNDLE_ID,
      BUNDLE_ID,
      `${BUNDLE_ID}.helper`,
      "com.example.archive",
    ]);
  });

  it("skips a record with no identifier", () => {
    expect(registeredBundles({ dump: "path:   /Applications/Slopweaver.app (0x1)" })).toEqual([]);
  });
});

describe("staleRegistrations", () => {
  it("lists every other copy carrying the app's identifier once, never the install, a helper or a namesake", () => {
    expect(
      staleRegistrations({
        bundles: registeredBundles({ dump: DUMP }),
        identifier: BUNDLE_ID,
        installed: INSTALLED_BUNDLE,
      }),
    ).toEqual(["/Users/me/repo/desktop/dist/mac-arm64/Slopweaver.app"]);
  });

  it("lists nothing when the install is the only copy", () => {
    const bundles = [{ identifier: BUNDLE_ID, path: INSTALLED_BUNDLE }];
    expect(staleRegistrations({ bundles, identifier: BUNDLE_ID, installed: INSTALLED_BUNDLE })).toEqual([]);
  });
});

describe("desktopInstallArgs", () => {
  it("reads no arguments, help, and one --home", () => {
    expect([
      desktopInstallArgs({ args: [] }),
      desktopInstallArgs({ args: ["-h"] }),
      desktopInstallArgs({ args: ["--home", "/tmp/h"] }),
    ]).toEqual([
      { help: false, home: undefined },
      { help: true, home: undefined },
      { help: false, home: "/tmp/h" },
    ]);
  });

  it("refuses a flag as --home's value, a missing value, a stray argument and a repeat", () => {
    expect([
      desktopInstallArgs({ args: ["--home", "--unknown"] }),
      desktopInstallArgs({ args: ["--home"] }),
      desktopInstallArgs({ args: ["now"] }),
      desktopInstallArgs({ args: ["--home", "/a", "--home", "/b"] }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("openVerdict", () => {
  const up = { running: true, saved: true };
  const down = { running: false, saved: false };

  it("trusts a build only once it has run for the whole hold with the checkout saved", () => {
    expect([
      openVerdict({ deadline: 9, hold: 3, polls: [up, up] }),
      openVerdict({ deadline: 9, hold: 3, polls: [up, up, up] }),
      openVerdict({ deadline: 9, hold: 3, polls: [up, down, up, up] }),
    ]).toEqual([undefined, "ready", undefined]);
  });

  it("judges at the deadline: never seen, stopped, or still running without the checkout", () => {
    const unsaved = { running: true, saved: false };
    expect([
      openVerdict({ deadline: 2, hold: 3, polls: [down, down] }),
      openVerdict({ deadline: 2, hold: 3, polls: [up, down] }),
      openVerdict({ deadline: 2, hold: 3, polls: [down, unsaved] }),
    ]).toEqual(["never-ran", "stopped", "not-saved"]);
  });

  it("waits before the first poll", () => {
    expect(openVerdict({ deadline: 2, hold: 1, polls: [] })).toBe(undefined);
  });
});

describe("runningPids", () => {
  const ps = [
    "  10902 /Applications/Slopweaver.app/Contents/MacOS/Slopweaver --checkout /Users/me/slopweaver",
    "  11376 /Applications/Slopweaver.app/Contents/Frameworks/Slopweaver Helper.app/Contents/MacOS/Slopweaver Helper --type=gpu-process",
    "  20001 /Users/me/repo/desktop/dist/mac-arm64/Slopweaver.app/Contents/MacOS/Slopweaver",
    "  30003 /usr/bin/grep /x/Slopweaver.app/Contents/MacOS/Slopweaverish",
  ].join("\n");

  it("finds the main process of every copy and no helper", () => {
    expect(runningPids({ ps })).toEqual([10902, 20001]);
  });

  it("finds only the copy running from one bundle when asked", () => {
    expect(runningPids({ bundle: INSTALLED_BUNDLE, ps })).toEqual([10902]);
  });

  it("finds a copy whose executable path is preceded by a near miss of itself", () => {
    const nested = "  123 /tmp/x/Slopweaver.app/Contents/MacOS/Slopweaver-old/Slopweaver.app/Contents/MacOS/Slopweaver";
    expect(runningPids({ ps: nested })).toEqual([123]);
  });

  it("never takes a near miss of the installed executable as the installed copy, whatever else the line names", () => {
    const decoy =
      "  123 /Applications/Slopweaver.app/Contents/MacOS/Slopweaver-old /tmp/Slopweaver.app/Contents/MacOS/Slopweaver";
    expect(runningPids({ bundle: INSTALLED_BUNDLE, ps: decoy })).toEqual([]);
  });

  it("skips a line with no pid", () => {
    expect(runningPids({ ps: "/Applications/Slopweaver.app/Contents/MacOS/Slopweaver\n  \n" })).toEqual([]);
  });
});

describe("spotlightState", () => {
  it("reads both spellings of a switched-off index as disabled, then enabled, then anything else as unknown", () => {
    expect([
      spotlightState({ mdutil: "/:\n\tIndexing and searching disabled.\n" }),
      spotlightState({ mdutil: "/:\n\tSpotlight server is disabled.\n" }),
      spotlightState({ mdutil: "/:\n\tIndexing enabled.\n" }),
      spotlightState({ mdutil: "/:\n\tError: unknown indexing state.\n" }),
    ]).toEqual(["disabled", "disabled", "enabled", "unknown"]);
  });
});

describe("spotlightLine", () => {
  it("says when indexing is switched off, and where the app is listed instead", () => {
    expect(spotlightLine({ mdutil: "/:\n\tSpotlight server is disabled.\n", state: "disabled" })).toBe(
      "spotlight: indexing is switched off on this Mac, so Spotlight search lists nothing new — Launchpad, Raycast and the Finder list the app",
    );
  });

  it("says it asked when indexing is on", () => {
    expect(spotlightLine({ mdutil: "/:\n\tIndexing enabled.\n", state: "enabled" })).toBe(
      "spotlight: asked to index the app",
    );
  });

  it("quotes a status it cannot read", () => {
    expect(spotlightLine({ mdutil: "/:\n\tError: unknown indexing state.\n", state: "unknown" })).toBe(
      "spotlight: indexing state unread (Error: unknown indexing state.) — asked to index the app",
    );
  });
});

describe("rememberedCheckout", () => {
  it("reads the saved checkout", () => {
    expect(rememberedCheckout({ text: '{"checkout":"/Users/me/slopweaver","version":1}' })).toBe(
      "/Users/me/slopweaver",
    );
  });

  it("reads none from a null checkout, a missing field or a file that is not JSON", () => {
    expect([
      rememberedCheckout({ text: '{"checkout":null}' }),
      rememberedCheckout({ text: "{}" }),
      rememberedCheckout({ text: "not json" }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
