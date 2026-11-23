/**
 * The fake Mac every `installRun/` test file installs onto: its state, the knobs a case turns, and the fixed
 * values each build is checked against. An in-memory Applications folder whose bundles each carry a tag naming
 * the build they hold, so a case asserts which build ends up installed. It moved here when `installRun.test.ts`
 * was split by behaviour, and it touches no disk.
 */
import { join } from "node:path";

import { cachePaths } from "../../../../../../cacheHome.js";
import { APP_SUPPORT } from "../../../../../../cli/commands/desktop/installProcess.js";
import type { ProgramCall } from "../../../../../../cli/commands/desktop/installSeams.js";
import { stampArgs } from "../../../../../../desktop/buildStamp.js";
import { BUNDLE_ID } from "../../../../../../desktop/installPlan.js";
import { identityRequirement } from "../../../../../../desktop/signing.js";
import { stagedBundle, stagePaths } from "../../../../../../desktop/stagedBuild.js";

/** How the new build behaves once opened. */
type Launch = "runs" | "never";

/** The fake Mac: folders by path, each tagged with the build it holds, and running copies by pid. */
export interface FakeMac {
  readonly folders: Map<string, { tag: string; mtimeMs: number }>;
  readonly running: Map<number, string>;
  readonly lines: string[];
  /** Other builds LaunchServices still lists under the app's identifier. */
  readonly registered: Set<string>;
  /** The signing, permission and open programs run, in order, each as its command and first argument. */
  readonly calls: string[];
  /** Every `git` run, in order, as its whole argument list joined by spaces. */
  readonly gitCalls: string[];
  /** Small text files the install writes, by path. */
  readonly files: Map<string, string>;
  savedCheckout: string | undefined;
  /** The commit the checkout's HEAD names right now. */
  head: string;
}

/** What a case changes about the fake Mac's behaviour. */
export interface Behaviour {
  readonly launch: Launch;
  /** A running copy ignores being asked to quit. */
  readonly stubborn?: boolean;
  /** `yarn install` fails, so the run stops right after recovery. */
  readonly yarnFails?: boolean;
  /** Deleting this path throws. */
  readonly undeletable?: string;
  /** Moving this path throws. */
  readonly unmovable?: string;
  /** This stale build stays registered whatever `lsregister -u` is asked. */
  readonly sticky?: string;
  /** The installed app is launched while the build is being copied beside it. */
  readonly launchedDuringCopy?: boolean;
  /** codesign signs without error, but the build still reads back ad-hoc. */
  readonly signsAdHoc?: boolean;
  /** tccutil refuses to clear the grants. */
  readonly tccFails?: boolean;
  /** The build ignores the stamp flags, so its Info.plist names no commit. */
  readonly unstamped?: boolean;
  /** The checkout's desktop files differ from HEAD. */
  readonly dirtyShell?: boolean;
  /** A voice call starts while the build runs, writing its console lease. */
  readonly callDuringBuild?: boolean;
  /** The owner reopens the app and starts a call while the swapped build registers. */
  readonly callAfterSwap?: boolean;
  /** A call starts in another copy of the app as the new build is opened. */
  readonly callAtOpen?: boolean;
  /** The checkout moves to {@link MOVED_SHA} while the staged build is claimed. */
  readonly headMovesAtClaim?: boolean;
  /** Another build, stamped {@link MOVED_SHA}, takes the staged one's place as it is claimed. */
  readonly stageReplacedAtClaim?: boolean;
  /** The staged app is signed and stamped right, but its Info.plist names another app's identifier. */
  readonly stagedForeignId?: boolean;
  /** A desktop file is edited once the fresh build has compiled, so the checkout reads dirty from then on. */
  readonly editedDuringBuild?: boolean;
  /** The build comes out without its System Audio Recording helper. */
  readonly helperMissing?: boolean;
}

/** The one console hold a fake Mac's call leases sit under. */
const HOLD = "slopweaver-1a2b3c4d.hold";

/**
 * Where a console's call leases sit under the cache root's docs-site directory. Read on every call, never held in a
 * constant: the cache root is the running test file's, and the unit lane reuses a fork, so this module outlives it.
 *
 * @returns the leases' folder under the running test file's cache root
 */
export function holdsFolder(): string {
  return join(cachePaths().docsSite, HOLD, "calls");
}

/** Write one call lease on the fake Mac, the folders above it included. */
export function writeLease({ mac, untilMs }: { mac: FakeMac; untilMs: number }): void {
  const docsSite = cachePaths().docsSite;
  const holds = holdsFolder();
  for (const folder of [docsSite, join(docsSite, HOLD), holds]) {
    mac.folders.set(folder, { mtimeMs: 1, tag: "dir" });
  }
  mac.folders.set(`${holds}/call-1.json`, { mtimeMs: 1, tag: "lease" });
  mac.files.set(`${holds}/call-1.json`, JSON.stringify({ callId: "call-1", untilMs }));
}

/**
 * A failure shaped as `node:fs` throws one: its message, and the `code` a caller branches on.
 *
 * @returns an `Error` carrying that `code`, its message naming the code and the path
 */
export function fsError({ code, path }: { code: string; path: string }): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

export const MAIN = "/main";
export const SHA1 = "85E8D67CA8047CB356EC5B71AB28E67594A5BBDD";
export const LEAF = identityRequirement({ sha1: SHA1 });

export const NONCE = "7";
export const OUTPUT = "/tmp/build";
/** Where the fresh build's System Audio Recording helper is checked for. */
export const HELPER = `${OUTPUT}/mac-arm64/Slopweaver.app/Contents/MacOS/slopweaver-system-audio`;

/**
 * Every path at or under `root`.
 *
 * @returns the fake Mac's folder paths equal to `root` or nested inside it, in insertion order
 */
export function under({ mac, root }: { mac: FakeMac; root: string }): readonly string[] {
  return [...mac.folders.keys()].filter((path) => path === root || path.startsWith(`${root}/`));
}

export const HEAD_SHA = "461e873ed0f301ebbd167766265eea51f8db26be";
export const HEAD_ISO = "2026-10-05T16:54:25Z";
export const NOW_MS = Date.parse("2026-10-06T02:30:00Z");

/**
 * The Info.plist electron-builder writes: every `--config.mac.extendInfo.<key>=<value>` flag as a `<string>`, unless
 * the case's build drops them.
 *
 * @returns the plist text, the app's identifier first and then each stamp key in flag order
 */
export function plistOf({ behaviour, call }: { behaviour: Behaviour; call: ProgramCall }): string {
  const prefix = "--config.mac.extendInfo.";
  const keys = call.args
    .filter((arg) => arg.startsWith(prefix) && behaviour.unstamped !== true)
    .map((arg) => arg.slice(prefix.length).split("="))
    .map(([key, value]) => `\t<key>${key!}</key>\n\t<string>${value!}</string>`);
  return [
    '<plist version="1.0">',
    "<dict>",
    `\t<key>CFBundleIdentifier</key>\n\t<string>${BUNDLE_ID}</string>`,
    ...keys,
    "</dict>",
    "</plist>",
  ].join("\n");
}

/** The commit the checkout moves to in a `headMovesAtClaim` case. */
export const MOVED_SHA = "fedcba9876543210fedcba9876543210fedcba98";

/** The committed `desktop/package.json` `git show` answers: a build script reaching the root's compiler owner. */
export const DESKTOP_MANIFEST = JSON.stringify({
  scripts: { app: "yarn build && electron-builder", build: "bash ../scripts/tsc-owner.sh -- tsc -p tsconfig.json" },
});

/** Where a fresh build of a clean HEAD compiles: the export of its commit, never the checkout. */
export const EXPORTED = `${stagePaths({ appSupport: APP_SUPPORT, nonce: NONCE }).source}/desktop`;

/**
 * A fake Mac holding the given Applications folders, nothing running.
 *
 * @param folders each folder as its path, the tag naming its build, and its modification time
 * @returns a fresh fake Mac whose HEAD is {@link HEAD_SHA}, with no files, calls or saved checkout
 */
export function macWith({ folders }: { folders: readonly [string, string, number][] }): FakeMac {
  return {
    folders: new Map(folders.map(([path, tag, mtimeMs]) => [path, { mtimeMs, tag }])),
    lines: [],
    calls: [],
    gitCalls: [],
    files: new Map(),
    registered: new Set(),
    running: new Map(),
    savedCheckout: undefined,
    head: HEAD_SHA,
  };
}

/**
 * Every folder left under /Applications, with the build it holds.
 *
 * @returns one `<path> <tag>` line per folder, sorted
 */
export function applications({ mac }: { mac: FakeMac }): readonly string[] {
  return [...mac.folders]
    .filter(([path]) => path.startsWith("/Applications/"))
    .map(([path, { tag }]) => `${path} ${tag}`)
    .toSorted();
}

/** Where the prebuilt build waits, and the bundle inside it. */
export const READY = stagePaths({ appSupport: APP_SUPPORT, nonce: NONCE }).ready;
export const READY_BUNDLE = stagedBundle({ folder: READY });

/**
 * The Info.plist of a prebuilt build stamped with `sha`.
 *
 * @returns the plist a clean build of that commit carries
 */
export function stagedPlist({ sha }: { sha: string }): string {
  const stamp = { committedIso: HEAD_ISO, sha, tree: "clean" as const };
  return plistOf({ behaviour: { launch: "runs" }, call: { args: ["app", ...stampArgs({ stamp })], command: "yarn" } });
}

/** Put a prebuilt build in the stage: `tag` names its signature, as for every other bundle, and `sha` its stamp. */
export function stageBuild({ mac, tag, sha }: { mac: FakeMac; tag: string; sha: string }): void {
  mac.folders.set(READY_BUNDLE, { mtimeMs: 45, tag });
  mac.files.set(`${READY_BUNDLE}/Contents/Info.plist`, stagedPlist({ sha }));
}
