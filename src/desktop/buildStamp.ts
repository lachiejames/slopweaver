/**
 * Which commit a desktop app build was made from, written into its `Info.plist` — and whether a voice call is live,
 * which an install would end. Pure; `cli/commands/desktop/installRun.ts` does the reading and writing.
 *
 * The requirement: the owner can tell which build is running and what it is missing. A sidebar line such as "one
 * commit behind origin/main, rebuilt 1.7 hours ago" is true only of the console's page, which rebuilds on every
 * landing; the app around it is built once and nothing rebuilds it, so the owner can see an old shell under a fresh
 * page. So every build carries its commit where both the running app and the installed bundle can be read
 * (`desktop/src/shellBuild.ts` reads it; keep the keys in step), and the sidebar compares it with origin/main.
 *
 * `Info.plist` rather than the packaged `package.json`: it is a plain file outside `app.asar`, replaced whole by a
 * swap, so the installed bundle's stamp is one ordinary read — never one through Electron's asar layer.
 */
import { isRecord } from "../lib/parsers.js";

/** The `Info.plist` keys a build's stamp is written under; `desktop/src/shellBuild.ts` restates them. */
export const STAMP_KEYS = {
  committedIso: "SlopweaverBuildCommittedIso",
  sha: "SlopweaverBuildSha",
  tree: "SlopweaverBuildTree",
} as const;

/** The commit a build was made from, and whether the app's own files carried changes it does not hold. */
export interface ShellStamp {
  readonly sha: string;
  readonly committedIso: string;
  /** `dirty` when the checkout's desktop files differed from that commit, so the build is not exactly it. */
  readonly tree: "clean" | "dirty";
}

/** The `git log -1` format {@link headStampOf} reads: sha, then committer time. */
export const HEAD_STAMP_FORMAT = "%H%x1f%cI";

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/u;

/**
 * The stamp for the checkout being built.
 *
 * @param log `git log -1 --format=${HEAD_STAMP_FORMAT} <commit>`'s stdout
 * @param status the change lines of a status over the app's paths: anything there is a change the build carries
 * @returns the stamp, or `undefined` when the log is not one commit
 */
export function headStampOf({ log, status }: { log: string; status: string }): ShellStamp | undefined {
  const [sha, committedIso, ...rest] = log.trim().split("\u001f");
  if (sha === undefined || !SHA.test(sha) || committedIso === undefined || rest.length > 0) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(committedIso))) {
    return undefined;
  }
  let tree: ShellStamp["tree"] = "clean";
  if (status.trim() !== "") {
    tree = "dirty";
  }
  return { committedIso, sha, tree };
}

/**
 * The commit a `git status --porcelain=v2 --branch` compared the tree against, and the changes it found. One process
 * resolves HEAD once and compares against that, so the pair is true of the checkout at one instant — which two
 * commands, a `git log` of HEAD and a status, can never promise, however they are bracketed (HEAD moving A→B→A around the
 * status would read as a clean A).
 *
 * @param status the command's stdout: `# branch.*` headers, then one line per change
 * @returns the commit and the change lines, or `undefined` when no commit is named (an unborn branch)
 */
export function headOfStatus({ status }: { status: string }): { sha: string; changes: string } | undefined {
  const lines = status.split("\n").filter((line) => line !== "");
  const oid = lines.find((line) => line.startsWith("# branch.oid "));
  if (oid === undefined) {
    return undefined;
  }
  const sha = oid.slice("# branch.oid ".length).trim();
  if (!SHA.test(sha)) {
    return undefined;
  }
  return { changes: lines.filter((line) => !line.startsWith("#")).join("\n"), sha };
}

/**
 * The electron-builder flags that write a stamp into the bundle's `Info.plist`. The CLI's `--config.*` flags are
 * deep-merged into `desktop/package.json`'s `build`, so these join the `extendInfo` keys it already declares.
 *
 * @returns one `--config.mac.extendInfo.<key>=<value>` flag per field
 */
export function stampArgs({ stamp }: { stamp: ShellStamp }): readonly string[] {
  return [
    `--config.mac.extendInfo.${STAMP_KEYS.sha}=${stamp.sha}`,
    `--config.mac.extendInfo.${STAMP_KEYS.committedIso}=${stamp.committedIso}`,
    `--config.mac.extendInfo.${STAMP_KEYS.tree}=${stamp.tree}`,
  ];
}

/**
 * One string value out of an XML `Info.plist`.
 *
 * @returns the value, or `undefined` when the key is absent or not a `<string>`
 */
function plistString({ plist, key }: { plist: string; key: string }): string | undefined {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "u").exec(plist);
  return match?.[1];
}

/**
 * The stamp a built bundle carries. A value the command line coerced to a number lands as `<integer>`, and reads as
 * no stamp — so the install refuses it rather than installing a build it cannot name.
 *
 * @param plist the bundle's `Contents/Info.plist`, as XML
 * @returns the stamp, or `undefined` when any field is absent or malformed
 */
export function stampInPlist({ plist }: { plist: string }): ShellStamp | undefined {
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
 * How many voice calls hold a lease now — the same test `scripts/docs-site.sh`'s `live_calls` makes before it
 * restarts a console under one: a lease is live while its `untilMs` is in the future. A lease that does not parse
 * holds nothing, as there.
 *
 * @param leases the text of each lease file under any console's `<record>.hold/calls/`
 * @param nowMs the clock to judge them by
 * @returns the count of live leases
 */
export function liveCallLeases({ leases, nowMs }: { leases: readonly string[]; nowMs: number }): number {
  let live = 0;
  for (const text of leases) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }
    const until = parsed["untilMs"];
    if (typeof until === "number" && until > nowMs) {
      live += 1;
    }
  }
  return live;
}
