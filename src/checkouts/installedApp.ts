/**
 * Whether the installed desktop app's SOURCE differs from the upstream's — the mechanical condition behind the
 * sidebar's "new version available". The pure half; `./installedAppRead.ts` reads the bundle and runs the git these
 * arguments name.
 *
 * The fold once read "App not in origin/main's last 50" over an app whose source was
 * byte-identical to origin/main's: a mechanical condition is wanted so desktop builds never get
 * too stale, since "rebuild it when a merge touches the app" can be easily skipped or left open to
 * interpretation. The app had been installed from a pre-squash branch head, which is on no first-parent line,
 * so placing it by its sha could only say "not in the window". Comparing CONTENT judges a build from a branch, a
 * squash or a worktree the same way: the app paths (`SHELL_PATHSPEC`) at the stamped commit against the upstream tip.
 *
 * A `dirty` stamp is never compared: its build carried edits the commit does not hold, so the commit's content says
 * nothing certain about the app.
 */
import { type ShellStamp, stampInPlist } from "../desktop/buildStamp.js";
import { SHELL_PATHSPEC } from "./shellChanges.js";

/** A full commit sha. */
const SHA = /^[0-9a-f]{40}$/u;

/** What reading the installed bundle's `Info.plist` gave. */
export type InstalledPlistRead =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "failed"; readonly why: string };

/** The installed desktop app, as `checkout console --json` carries it. */
export type InstalledApp =
  /** No app is installed — a browser-only machine, which is normal. */
  | { readonly kind: "absent" }
  /** An app is there but names no build this reading could use. */
  | { readonly kind: "unreadable"; readonly why: string }
  | {
      readonly kind: "read";
      /** The stamp every comparison below was made for, so a page joins it to the app's own reading exactly. */
      readonly stamp: ShellStamp;
      /** Whether the app's source differs from the upstream tip's; `undefined` when it could not be compared. */
      readonly shellDiffers: boolean | undefined;
      /** Where the build forked from the upstream, read only when its source differs; `undefined` otherwise. */
      readonly forkSha: string | undefined;
    };

/**
 * The installed app's stamp out of its bundle read.
 *
 * @param read what reading `Info.plist` gave
 * @returns absent, unreadable with why, or the stamp
 */
export function installedStampOf({
  read,
}: {
  read: InstalledPlistRead;
}):
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: string }
  | { readonly kind: "stamped"; readonly stamp: ShellStamp } {
  if (read.kind === "absent") {
    return read;
  }
  if (read.kind === "failed") {
    return { kind: "unreadable", why: `the installed app's Info.plist could not be read: ${read.why}` };
  }
  const stamp = stampInPlist({ plist: read.text });
  if (stamp === undefined) {
    return {
      kind: "unreadable",
      why: "the installed app's Info.plist carries no build stamp this reading parses — one `slopweaver desktop install` writes one",
    };
  }
  return { kind: "stamped", stamp };
}

/**
 * The `git diff` arguments naming every app file that differs between a build's commit and the upstream tip.
 *
 * @param from the stamped commit
 * @param to the upstream tip
 * @returns the arguments after `git`
 */
export function shellDiffArgs({ from, to }: { from: string; to: string }): readonly string[] {
  return ["diff", "--name-only", from, to, "--", ...SHELL_PATHSPEC];
}

/**
 * Read a fork point out of `git merge-base`.
 *
 * @param text the command's trimmed stdout
 * @returns the sha, or `undefined` when it is not exactly one
 */
export function forkShaOf({ text }: { text: string }): string | undefined {
  return SHA.test(text) ? text : undefined;
}
