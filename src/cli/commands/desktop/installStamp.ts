/**
 * The two install steps `../../../desktop/buildStamp.ts` decides: refuse while a voice call is live, and stamp each
 * build with the commit it was made from, checked on the built bundle before anything installed is touched.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { SHELL_PATHSPEC } from "../../../checkouts/shellChanges.js";
import {
  HEAD_STAMP_FORMAT,
  headOfStatus,
  headStampOf,
  liveCallLeases,
  type ShellStamp,
  stampInPlist,
} from "../../../desktop/buildStamp.js";
import { readCallLeases } from "../../../desktop/callLeases.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import type { InstallSeams } from "./installSeams.js";

/**
 * Refuse while a voice call is live: the install quits the app, and the call with it. It runs FIRST, before even
 * recovering an interrupted install, because that recovery can quit the app too.
 *
 * @param home the state home whose consoles' call leases are read
 * @returns nothing when no call holds a lease, else `CALL_LIVE`, or the step that could not read the leases
 */
export function refuseDuringCall({
  seams,
  home,
}: {
  seams: InstallSeams;
  home: string;
}): Result<void, DesktopInstallError> {
  const leases = readCallLeases({ home, seams });
  if (leases.isErr()) {
    const { detail, path } = leases.error;
    return err(DesktopInstallErrors.stepFailed({ command: `read the voice call leases at ${path}`, detail }));
  }
  const calls = liveCallLeases({ leases: leases.value, nowMs: seams.nowMs() });
  if (calls > 0) {
    return err(DesktopInstallErrors.callLive({ calls }));
  }
  return ok(undefined);
}

/**
 * The stamp for the checkout being built: its HEAD, and whether the app's own files differ from it. Both come from ONE
 * status, which names the commit it compared against (`headOfStatus`), so the pair is true of the checkout at one
 * instant; the commit time is then read by sha, which nothing can move.
 *
 * @param root the checkout whose `desktop/` is built
 * @returns the stamp, or the step that could not read it
 */
export function readHeadStamp({
  seams,
  root,
}: {
  seams: InstallSeams;
  root: string;
}): Result<ShellStamp, DesktopInstallError> {
  // Untracked files named explicitly: a new source file is compiled in, whatever `status.showUntrackedFiles` says.
  const status = seams.run({
    args: ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "--", ...SHELL_PATHSPEC],
    command: "git",
    cwd: root,
  });
  if (status.isErr()) {
    return err(status.error);
  }
  const head = headOfStatus({ status: status.value });
  if (head === undefined) {
    return err(DesktopInstallErrors.stepFailed({ command: "git status --branch", detail: "named no commit" }));
  }
  const log = seams.run({ args: ["log", "-1", `--format=${HEAD_STAMP_FORMAT}`, head.sha], command: "git", cwd: root });
  if (log.isErr()) {
    return err(log.error);
  }
  const stamp = headStampOf({ log: log.value, status: head.changes });
  if (stamp === undefined || stamp.sha !== head.sha) {
    return err(DesktopInstallErrors.stepFailed({ command: `git log -1 ${head.sha}`, detail: "printed no commit" }));
  }
  return ok(stamp);
}

/**
 * Read HEAD again after a build of the live checkout, and refuse when it no longer matches the stamp the build
 * carries — a commit, a checkout or an edit that landed while it compiled. A tree already dirty stays dirty, which
 * claims no particular bytes, so further edits to it pass.
 *
 * @param root the checkout that was built
 * @param stamp the stamp read before the build, which the bundle carries
 * @returns nothing when HEAD still reads as that stamp, else the step that changed or could not be read
 */
export function sameHead({
  seams,
  root,
  stamp,
}: {
  seams: InstallSeams;
  root: string;
  stamp: ShellStamp;
}): Result<void, DesktopInstallError> {
  return readHeadStamp({ root, seams }).andThen((now) => {
    if (now.sha === stamp.sha && now.tree === stamp.tree) {
      return ok(undefined);
    }
    const detail = `the checkout moved from ${stamp.sha.slice(0, 9)} (${stamp.tree}) to ${now.sha.slice(0, 9)} (${now.tree}) while the app built, so the build is of neither — run it again`;
    return err(DesktopInstallErrors.stepFailed({ command: "git status after the build", detail }));
  });
}

/**
 * The stamp an app bundle carries in its Info.plist.
 *
 * @param bundle a `Slopweaver.app`, installed or staged
 * @returns the stamp, or `undefined` when there is no bundle there or it carries none
 */
export function bundleStamp({ seams, bundle }: { seams: InstallSeams; bundle: string }): ShellStamp | undefined {
  const plist = join(bundle, "Contents", "Info.plist");
  if (!seams.exists({ path: plist })) {
    return undefined;
  }
  try {
    return stampInPlist({ plist: seams.readText({ path: plist }) });
  } catch {
    // An Info.plist removed between the check and the read is a bundle with no stamp to compare.
    return undefined;
  }
}

/**
 * Whether the app's own source differs between a commit and HEAD — the same comparison the sidebar makes
 * (`installedApp`), so a landing that did not touch the app never reads as a new build.
 *
 * @param root the checkout to compare in
 * @param from the commit a build was made from
 * @returns true when it differs, or when git could not say
 */
export function appSourceDiffers({ seams, root, from }: { seams: InstallSeams; root: string; from: string }): boolean {
  const diff = seams.run({
    args: ["diff", "--name-only", from, "HEAD", "--", ...SHELL_PATHSPEC],
    command: "git",
    cwd: root,
  });
  return diff.isErr() || diff.value.trim() !== "";
}

/**
 * Check a built bundle carries exactly the stamp it was built with, before it is signed or swapped in.
 *
 * @param bundle the built `Slopweaver.app`
 * @param stamp what the build was asked to carry
 * @returns nothing when it does, else `STAMP_MISSING`
 */
export function verifyStamp({
  seams,
  bundle,
  stamp,
}: {
  seams: InstallSeams;
  bundle: string;
  stamp: ShellStamp;
}): Result<void, DesktopInstallError> {
  let plist: string;
  try {
    plist = seams.readText({ path: join(bundle, "Contents", "Info.plist") });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "its Info.plist could not be read";
    return err(DesktopInstallErrors.stampMissing({ detail, path: bundle }));
  }
  const carried = stampInPlist({ plist });
  if (carried === undefined) {
    return err(DesktopInstallErrors.stampMissing({ detail: "its Info.plist names no commit", path: bundle }));
  }
  if (carried.sha !== stamp.sha || carried.committedIso !== stamp.committedIso || carried.tree !== stamp.tree) {
    return err(
      DesktopInstallErrors.stampMissing({ detail: `it names ${carried.sha}, not ${stamp.sha}`, path: bundle }),
    );
  }
  return ok(undefined);
}
