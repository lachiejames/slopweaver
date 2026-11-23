/**
 * `desktop prebuild` driven over a fake Mac: folders by path, small files by path, and scripted programs. The verb's
 * real logic runs on top, so each case asserts which build ends up ready and that the installed app is never
 * touched.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrapErr } from "#lib/result.js";
import { SIGNING_KEYCHAIN } from "../../../../../cli/commands/desktop/installProcess.js";
import type { InstallSeams, ProgramCall } from "../../../../../cli/commands/desktop/installSeams.js";
import { type PrebuildOutcome, prebuildHeld } from "../../../../../cli/commands/desktop/prebuildHeld.js";
import {
  DESKTOP_PREBUILD_FLAG_NAMES,
  parseDesktopPrebuildArgs,
  renderPrebuildOutcome,
} from "../../../../../cli/commands/desktop/prebuildRun.js";
import { DesktopInstallErrors } from "../../../../../desktop/errors.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../../../../../desktop/installPlan.js";
import { identityRequirement } from "../../../../../desktop/signing.js";
import { stagedBundle, stagePaths } from "../../../../../desktop/stagedBuild.js";

const HEAD = "461e873ed0f301ebbd167766265eea51f8db26be";
const MOVED = "7f3a0c2b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b";
const OLDER = "0123456789abcdef0123456789abcdef01234567";
const ISO = "2026-10-10T18:00:00Z";
const SHA1 = "85E8D67CA8047CB356EC5B71AB28E67594A5BBDD";
const PATHS = stagePaths({ appSupport: "/support", nonce: "7" });
/** The committed `desktop/package.json` `git show` answers: its build reaches the root's compiler owner. */
const MANIFEST = JSON.stringify({ scripts: { build: "bash ../scripts/tsc-owner.sh -- tsc -p tsconfig.json" } });

/** What a case changes about the fake Mac. */
interface Behaviour {
  /** HEAD moves to another commit while `yarn app` runs. */
  readonly moveDuringBuild?: boolean;
  /** HEAD moves to another commit as the build is moved into the ready folder. */
  readonly moveAtPlacement?: boolean;
  /** The checkout moves to another commit and back while `yarn app` runs, so every read of HEAD agrees. */
  readonly moveAwayAndBack?: boolean;
  /** `yarn app` fails. */
  readonly buildFails?: boolean;
  /** HEAD's `desktop/` tracks a symlink. */
  readonly symlink?: boolean;
  /** `git archive` leaves the compiler owner out of the export, as a committed `export-ignore` does. */
  readonly exportIgnored?: boolean;
  /** The installed app's source matches HEAD's. */
  readonly installedCurrent?: boolean;
  /** No signing keychain exists yet. */
  readonly noKeychain?: boolean;
  /** This checkout is not the declared main one. */
  readonly worktree?: boolean;
}

/** The fake Mac's state. */
interface FakeMac {
  readonly folders: Set<string>;
  readonly files: Map<string, string>;
  readonly calls: string[];
  head: string;
  /** The commit `git archive` last exported. */
  exported: string | undefined;
  /** The paths `git archive` last exported from it. */
  pathspecs: readonly string[] | undefined;
  /** The commit whose sources `yarn app` compiled: the exported one when it ran there, else the checkout's HEAD. */
  compiled: string | undefined;
}

/** An Info.plist naming a stamp. */
function plist({ sha }: { sha: string }): string {
  return [
    `<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>`,
    `<key>SlopweaverBuildSha</key><string>${sha}</string>`,
    `<key>SlopweaverBuildCommittedIso</key><string>${ISO}</string>`,
    "<key>SlopweaverBuildTree</key><string>clean</string>",
  ].join("\n");
}

/** Put an app bundle stamped with `sha` at `bundle`. */
function placeApp({ mac, bundle, sha }: { mac: FakeMac; bundle: string; sha: string }): void {
  mac.folders.add(bundle);
  mac.files.set(`${bundle}/Contents/Info.plist`, plist({ sha }));
}

/** One program run as the fake Mac answers it. */
type Script = (run: { mac: FakeMac; call: ProgramCall; behaviour: Behaviour }) => ReturnType<InstallSeams["run"]>;

/** `yarn app`: build HEAD's app into the building folder, recording whose sources it compiled. */
const yarnApp: Script = ({ mac, call, behaviour }) => {
  if (behaviour.buildFails === true) {
    return err(DesktopInstallErrors.stepFailed({ command: "yarn app", detail: "exit 1" }));
  }
  // The checkout as the compiler finds it: moved away, for a case that moves it away and back.
  const checkout = behaviour.moveAwayAndBack === true ? MOVED : mac.head;
  mac.compiled = call.cwd === `${PATHS.source}/desktop` ? mac.exported : checkout;
  placeApp({ bundle: stagedBundle({ folder: PATHS.building }), mac, sha: mac.head });
  if (behaviour.moveDuringBuild === true) {
    mac.head = MOVED;
  }
  return ok("");
};

/** The programs the fake Mac scripts, by command and first argument. */
const SCRIPTS: Readonly<Record<string, Script>> = {
  "/usr/bin/codesign -d": () => ok(`# designated => ${identityRequirement({ sha1: SHA1 })}\n`),
  "/usr/bin/security find-certificate": () => ok(`SHA-1 hash: ${SHA1}\n`),
  "git archive": ({ mac, call, behaviour }) => {
    const separator = call.args.indexOf("--");
    mac.exported = call.args[separator - 1]!;
    mac.pathspecs = call.args.slice(separator + 1);
    for (const pathspec of mac.pathspecs) {
      const path = pathspec.replace(/^:\(literal\)/u, "");
      if (!(behaviour.exportIgnored === true && path === "scripts/tsc-owner.sh")) {
        mac.folders.add(`${PATHS.source}/${path}`);
      }
    }
    return ok("");
  },
  "git diff": ({ behaviour }) => ok(behaviour.installedCurrent === true ? "" : "desktop/src/main.ts\n"),
  "git log": ({ call }) => ok(`${call.args.at(-1)!}\u001f${ISO}\n`),
  "git ls-tree": ({ behaviour }) =>
    ok(
      [
        "100644 blob 1111111111111111111111111111111111111111\tdesktop/package.json",
        ...(behaviour.symlink === true
          ? ["120000 blob 2222222222222222222222222222222222222222\tscripts/tsc-owner.sh"]
          : ["100755 blob 3333333333333333333333333333333333333333\tscripts/tsc-owner.sh"]),
      ].join("\n"),
    ),
  "git show": () => ok(MANIFEST),
  "git status": ({ mac }) => ok(`# branch.oid ${mac.head}\n# branch.head main\n`),
  "yarn app": yarnApp,
};

/** One scripted program run. */
function program({
  mac,
  call,
  behaviour,
}: {
  mac: FakeMac;
  call: ProgramCall;
  behaviour: Behaviour;
}): ReturnType<InstallSeams["run"]> {
  const key = `${call.command} ${call.args[0]!}`;
  mac.calls.push(key);
  const script = SCRIPTS[key];
  if (script !== undefined) {
    return script({ behaviour, call, mac });
  }
  if (call.command === "/usr/bin/plutil") {
    return ok(BUNDLE_ID);
  }
  return ok(call.command === "git" ? "42\n" : "");
}

/** Every path at or under `root`. */
function under({ mac, root }: { mac: FakeMac; root: string }): readonly string[] {
  return [...mac.folders, ...mac.files.keys()].filter((path) => path === root || path.startsWith(`${root}/`));
}

/** The seams over a fake Mac. */
function fakeSeams({ mac, behaviour }: { mac: FakeMac; behaviour: Behaviour }): InstallSeams {
  return {
    entries: () => [],
    exists: ({ path }) => mac.folders.has(path) || mac.files.has(path),
    mainCheckout: () => ok(behaviour.worktree === true ? "/main" : "/repo"),
    move: ({ from, to }) => {
      if (behaviour.moveAtPlacement === true && to === PATHS.ready) {
        mac.head = MOVED;
      }
      for (const path of under({ mac, root: from })) {
        const moved = `${to}${path.slice(from.length)}`;
        if (mac.folders.delete(path)) {
          mac.folders.add(moved);
        }
        const text = mac.files.get(path);
        if (text !== undefined) {
          mac.files.delete(path);
          mac.files.set(moved, text);
        }
      }
    },
    names: ({ path }) =>
      [...mac.folders]
        .filter((folder) => folder.startsWith(`${path}/`) && !folder.slice(path.length + 1).includes("/"))
        .map((folder) => folder.slice(path.length + 1)),
    nonce: "7",
    nowMs: () => Date.parse(ISO),
    out: () => {},
    pause: async () => {},
    quit: () => {},
    readText: ({ path }) => mac.files.get(path)!,
    remove: ({ path }) => {
      for (const inside of under({ mac, root: path })) {
        mac.folders.delete(inside);
        mac.files.delete(inside);
      }
    },
    run: (call) => program({ behaviour, call, mac }),
    runningRoot: () => "/repo",
    tempFolder: () => "/tmp/unused",
    writeText: ({ path, text }) => {
      mac.files.set(path, text);
    },
  };
}

/** A main checkout at HEAD with a keychain, an older app installed, and an empty stage. */
function freshMac({ behaviour }: { behaviour: Behaviour }): FakeMac {
  const mac: FakeMac = {
    calls: [],
    compiled: undefined,
    exported: undefined,
    files: new Map(),
    pathspecs: undefined,
    folders: new Set([PATHS.root]),
    head: HEAD,
  };
  placeApp({ bundle: INSTALLED_BUNDLE, mac, sha: OLDER });
  if (behaviour.noKeychain !== true) {
    mac.folders.add(SIGNING_KEYCHAIN);
  }
  return mac;
}

/** Run one prebuild over a fresh fake Mac, after `arrange` changes it. */
function prebuildOn({
  behaviour = {},
  arrange = () => {},
}: {
  behaviour?: Behaviour;
  arrange?: (mac: FakeMac) => void;
}): { mac: FakeMac; outcome: PrebuildOutcome } {
  const mac = freshMac({ behaviour });
  arrange(mac);
  const outcome = prebuildHeld({ home: "/home", paths: PATHS, seams: fakeSeams({ behaviour, mac }) });
  return { mac, outcome };
}

describe("prebuildHeld", () => {
  it("builds, signs and verifies HEAD into the ready folder, leaving the installed app alone", () => {
    const { mac, outcome } = prebuildOn({});
    expect(outcome).toEqual({ did: "built", sha: HEAD });
    expect(mac.files.get(`${stagedBundle({ folder: PATHS.ready })}/Contents/Info.plist`)).toBe(plist({ sha: HEAD }));
    expect(mac.files.get(`${INSTALLED_BUNDLE}/Contents/Info.plist`)).toBe(plist({ sha: OLDER }));
    expect(under({ mac, root: PATHS.building })).toEqual([]);
    expect(mac.calls).toContain("/usr/bin/codesign --verify");
  });

  it("never quits, opens or registers the app", () => {
    const { mac } = prebuildOn({});
    expect(mac.calls.filter((call) => /open|lsregister|ps|ditto/.test(call))).toEqual([]);
  });

  it("replaces a ready build of an older commit", () => {
    const { mac, outcome } = prebuildOn({
      arrange: (fake) => {
        placeApp({ bundle: stagedBundle({ folder: PATHS.ready }), mac: fake, sha: OLDER });
      },
    });
    expect(outcome.did).toBe("built");
    expect(mac.files.get(`${stagedBundle({ folder: PATHS.ready })}/Contents/Info.plist`)).toBe(plist({ sha: HEAD }));
  });

  it("deletes what a killed build or install left in the stage before building", () => {
    const { mac } = prebuildOn({
      arrange: (fake) => {
        fake.folders.add(`${PATHS.root}/building-3`);
        fake.folders.add(`${PATHS.root}/claimed-4`);
      },
    });
    expect([...mac.folders].filter((path) => /building-3|claimed-4/.test(path))).toEqual([]);
  });

  it("discards the build and the older ready one when HEAD moved while it ran", () => {
    const { mac, outcome } = prebuildOn({
      arrange: (fake) => {
        placeApp({ bundle: stagedBundle({ folder: PATHS.ready }), mac: fake, sha: OLDER });
      },
      behaviour: { moveDuringBuild: true },
    });
    expect(outcome).toEqual({ did: "moved", from: HEAD, to: MOVED });
    expect(under({ mac, root: PATHS.ready })).toEqual([]);
    expect(under({ mac, root: PATHS.building })).toEqual([]);
  });

  it("compiles the commit it stamps, not the checkout, so a move away and back cannot change what it built", () => {
    const { mac, outcome } = prebuildOn({ behaviour: { moveAwayAndBack: true } });
    expect(outcome).toEqual({ did: "built", sha: HEAD });
    expect(mac.exported).toBe(HEAD);
    expect(mac.compiled).toBe(HEAD);
    expect(under({ mac, root: PATHS.source })).toEqual([]);
  });

  it("exports the root files the committed desktop scripts reach beside desktop/, each as a literal pathspec", () => {
    const { mac, outcome } = prebuildOn({});
    expect(outcome).toEqual({ did: "built", sha: HEAD });
    expect(mac.pathspecs).toEqual([":(literal)desktop", ":(literal)scripts/tsc-owner.sh"]);
  });

  it("refuses a commit tracking a symlink in any exported path, exporting and building nothing", () => {
    const { mac, outcome } = prebuildOn({ behaviour: { symlink: true } });
    expect(renderPrebuildOutcome({ outcome })).toBe(
      "desktop prebuild: failed — it tracks symlinks (scripts/tsc-owner.sh), which can reach outside the exported " +
        "commit — from `git ls-tree -r 461e873ed -- :(literal)desktop :(literal)scripts/tsc-owner.sh`",
    );
    expect(mac.exported).toBe(undefined);
    expect(mac.calls.filter((call) => call.startsWith("yarn"))).toEqual([]);
    expect(under({ mac, root: PATHS.ready })).toEqual([]);
  });

  it("refuses an export the archive left a script-named path out of, building nothing", () => {
    const { mac, outcome } = prebuildOn({ behaviour: { exportIgnored: true } });
    expect(renderPrebuildOutcome({ outcome })).toBe(
      "desktop prebuild: failed — the export left out scripts/tsc-owner.sh, which the desktop scripts reach — from " +
        "`git archive 461e873ed -- :(literal)desktop :(literal)scripts/tsc-owner.sh`",
    );
    expect(mac.calls.filter((call) => call.startsWith("yarn"))).toEqual([]);
    expect(under({ mac, root: PATHS.ready })).toEqual([]);
  });

  it("discards the build it just placed when HEAD moved as it was placed", () => {
    const { mac, outcome } = prebuildOn({ behaviour: { moveAtPlacement: true } });
    expect(outcome).toEqual({ did: "moved", from: HEAD, to: MOVED });
    expect(under({ mac, root: PATHS.ready })).toEqual([]);
    expect(under({ mac, root: PATHS.building })).toEqual([]);
  });

  it("keeps the ready one when the build fails", () => {
    const { mac } = prebuildOn({
      arrange: (fake) => {
        placeApp({ bundle: stagedBundle({ folder: PATHS.ready }), mac: fake, sha: OLDER });
      },
      behaviour: { buildFails: true },
    });
    expect(mac.files.get(`${stagedBundle({ folder: PATHS.ready })}/Contents/Info.plist`)).toBe(plist({ sha: OLDER }));
  });

  it("deletes a failed build and names the step", () => {
    const { mac, outcome } = prebuildOn({ behaviour: { buildFails: true } });
    expect(renderPrebuildOutcome({ outcome })).toBe("desktop prebuild: failed — exit 1 — from `yarn app`");
    expect(under({ mac, root: PATHS.building })).toEqual([]);
  });

  it("builds nothing when HEAD is already ready", () => {
    const { mac, outcome } = prebuildOn({
      arrange: (fake) => {
        placeApp({ bundle: stagedBundle({ folder: PATHS.ready }), mac: fake, sha: HEAD });
      },
    });
    expect(outcome).toEqual({ did: "skipped", why: "461e873ed is already built and waiting" });
    expect(mac.calls.filter((call) => call.startsWith("yarn"))).toEqual([]);
  });

  it("builds nothing when the installed app's source already matches HEAD", () => {
    const { outcome } = prebuildOn({ behaviour: { installedCurrent: true } });
    expect(outcome).toEqual({ did: "skipped", why: "the installed app already matches 461e873ed" });
  });

  it("builds nothing outside the declared main checkout", () => {
    const { outcome } = prebuildOn({ behaviour: { worktree: true } });
    expect(outcome).toEqual({ did: "skipped", why: "not a declared main checkout" });
  });

  it("never mints the signing identity", () => {
    const { mac, outcome } = prebuildOn({ behaviour: { noKeychain: true } });
    expect(outcome.did).toBe("skipped");
    expect(mac.calls.filter((call) => call.startsWith("/usr/bin/security"))).toEqual([]);
  });
});

describe("renderPrebuildOutcome", () => {
  it("says a due build runs in the background and where its log is", () => {
    expect(
      renderPrebuildOutcome({
        outcome: { did: "due", log: PATHS.log, why: "building 461e873ed so Update now has it ready" },
      }),
    ).toBe(
      "desktop prebuild: building 461e873ed so Update now has it ready, in the background (log /support/staged/prebuild.log)",
    );
  });

  it("says a built one is waiting for Update now", () => {
    expect(renderPrebuildOutcome({ outcome: { did: "built", sha: HEAD } })).toBe(
      "desktop prebuild: 461e873ed is built, signed and waiting for Update now",
    );
  });
});

describe("parseDesktopPrebuildArgs", () => {
  it("names exactly the hook's two halves and --home", () => {
    expect(DESKTOP_PREBUILD_FLAG_NAMES).toEqual(["--decide", "--home", "--log"]);
  });

  it("refuses a flag it does not know", () => {
    expect(unwrapErr(parseDesktopPrebuildArgs({ rest: ["--force"] }))).toEqual(["unknown flag: --force"]);
  });
});
