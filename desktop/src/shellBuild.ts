/**
 * Which commit this app was built from, and which one is installed now — what the console's sidebar compares with
 * origin/main, so a landing that changed the app says so instead of hiding behind the page's own fresh build. Pure;
 * `main.ts` reads the two files and answers the console window's `slopweaver:shell-build`.
 *
 * The sidebar's "one commit behind origin/main, rebuilt 1.7 hours ago" is true of the page, not of this app, which a
 * landing may not have rebuilt; the owner needs confidence about which build is running and what it is missing.
 *
 * `slopweaver desktop install` writes the stamp into the bundle's `Info.plist` (`src/desktop/buildStamp.ts`, which
 * owns the keys — restated here because `desktop/` is another project; a test pins them). The RUNNING stamp is read
 * once at launch from this process's own bundle: an install quits every copy before it swaps, so no swap lands
 * between the launch and that read. The INSTALLED stamp is read afresh on every ask: when it differs, the app on disk
 * is newer than the one running and a relaunch runs it.
 */
import { dirname, join } from "node:path";

/** The `Info.plist` keys a stamp is written under, as `src/desktop/buildStamp.ts` writes them. */
export const STAMP_KEYS = {
  committedIso: "SlopweaverBuildCommittedIso",
  sha: "SlopweaverBuildSha",
  tree: "SlopweaverBuildTree",
} as const;

/** The installed app's `Info.plist`, where `slopweaver desktop install` puts every build. */
export const INSTALLED_INFO_PLIST = "/Applications/Slopweaver.app/Contents/Info.plist";

/** The commit a build was made from, and whether the checkout's desktop files carried changes beyond it. */
export interface ShellStamp {
  readonly sha: string;
  readonly committedIso: string;
  readonly tree: "clean" | "dirty";
}

/**
 * What the console window is told: whether this is a run from source, and the running and installed stamps.
 * `null` rather than absent, so the page can tell "no stamp" from a shell that never sent the field.
 */
export interface ShellBuildWire {
  readonly dev: boolean;
  readonly running: ShellStamp | null;
  readonly installed: ShellStamp | null;
}

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/u;

/**
 * One string value out of an XML `Info.plist`.
 *
 * @returns the value, or `undefined` when the key is absent or not a `<string>`
 */
function plistString({ plist, key }: { plist: string; key: string }): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(plist)?.[1];
}

/**
 * The stamp an `Info.plist` carries.
 *
 * @param plist the file's text, `undefined` when it could not be read
 * @returns the stamp, or `undefined` for a build made before stamps, or a file that could not be read
 */
export function stampOfPlist({ plist }: { plist: string | undefined }): ShellStamp | undefined {
  if (plist === undefined) {
    return undefined;
  }
  const sha = plistString({ key: STAMP_KEYS.sha, plist });
  const committedIso = plistString({ key: STAMP_KEYS.committedIso, plist });
  const tree = plistString({ key: STAMP_KEYS.tree, plist });
  if (sha === undefined || !SHA.test(sha) || committedIso === undefined || Number.isNaN(Date.parse(committedIso))) {
    return undefined;
  }
  if (tree !== "clean" && tree !== "dirty") {
    return undefined;
  }
  return { committedIso, sha, tree };
}

/**
 * This process's own `Info.plist`, from its executable's path (`<bundle>/Contents/MacOS/<name>`).
 *
 * @param execPath `process.execPath`
 * @returns `<bundle>/Contents/Info.plist`
 */
export function ownInfoPlist({ execPath }: { execPath: string }): string {
  return join(dirname(dirname(execPath)), "Info.plist");
}

/**
 * The answer to the console window's ask.
 *
 * @param dev a run from source, which has no stamp and is never compared
 * @param running this process's stamp, read at launch
 * @param installed the stamp on disk in /Applications now
 * @returns the wire form
 */
export function shellBuildWire({
  dev,
  running,
  installed,
}: {
  dev: boolean;
  running: ShellStamp | undefined;
  installed: ShellStamp | undefined;
}): ShellBuildWire {
  if (dev) {
    return { dev, installed: null, running: null };
  }
  return { dev, installed: onWire({ stamp: installed }), running: onWire({ stamp: running }) };
}

/** A stamp as the wire carries it: JSON has no `undefined`, so an absent stamp crosses as `null`. */
function onWire({ stamp }: { stamp: ShellStamp | undefined }): ShellStamp | null {
  if (stamp === undefined) {
    return null;
  }
  return stamp;
}
