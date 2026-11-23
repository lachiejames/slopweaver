/**
 * The install's moves in the Applications folder: recovering what an interrupted install left, swapping the new
 * build in, putting the previous app back, and discarding it once the new one is trusted. The swap is not atomic:
 * between its two moves the install path is briefly absent, so a kill in that instant leaves the previous app at
 * its hidden backup name, and the next install puts it back before it builds (`leftoverPlan`).
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import type { DesktopInstallError } from "../../../desktop/errors.js";
import { APPLICATIONS, INSTALLED_BUNDLE, leftoverPlan, swapPaths } from "../../../desktop/installPlan.js";
import { attempt, LSREGISTER, quitRunning } from "./installProcess.js";
import type { InstallSeams } from "./installSeams.js";
import { bundleRequirement, resetGrants } from "./installSigning.js";

/**
 * Move whatever is installed to `aside` and the backup into its place. When the backup will not move, the build
 * moved aside goes straight back, so one failed rename never leaves the Applications folder without the app; the
 * backup stays where it is for the next install's recovery.
 */
function restoreBackup({
  seams,
  backup,
  aside,
}: {
  seams: InstallSeams;
  backup: string;
  aside: string;
}): Result<void, DesktopInstallError> {
  const hadInstalled = seams.exists({ path: INSTALLED_BUNDLE });
  if (hadInstalled) {
    const moved = attempt({
      act: () => {
        seams.move({ from: INSTALLED_BUNDLE, to: aside });
      },
      what: "could not move the installed build aside to put the previous app back",
    });
    if (moved.isErr()) {
      return err(moved.error);
    }
  }
  const restored = attempt({
    act: () => {
      seams.move({ from: backup, to: INSTALLED_BUNDLE });
    },
    what: `could not put the previous app back from ${backup}, so the installed build stays and the next install tries again`,
  });
  if (restored.isErr() && hadInstalled) {
    attempt({
      act: () => {
        seams.move({ from: aside, to: INSTALLED_BUNDLE });
      },
      what: "could not put the installed build back either",
    });
  }
  return restored;
}

/**
 * {@link restoreBackup}, then clear the app's macOS grants when the build put back is signed differently from the one
 * it displaced: that build may have run long enough to be granted, under a requirement the build put back does not
 * carry. Every copy is already quit. The clear is never recorded, so the next install decides afresh.
 *
 * @returns a `permissions:` line when the grants were cleared or the clear failed, else `undefined`
 */
function restoreWithGrants({
  seams,
  backup,
  aside,
}: {
  seams: InstallSeams;
  backup: string;
  aside: string;
}): Result<string | undefined, DesktopInstallError> {
  const displaced = bundleRequirement({ bundle: INSTALLED_BUNDLE, seams });
  const restored = restoreBackup({ aside, backup, seams });
  if (restored.isErr()) {
    return err(restored.error);
  }
  if (bundleRequirement({ bundle: INSTALLED_BUNDLE, seams }) === displaced) {
    return ok(undefined);
  }
  const reset = resetGrants({ seams });
  if (!reset.cleared) {
    return ok(reset.line);
  }
  return ok(
    "permissions: the app put back is signed differently from the build it displaced, so its macOS grants were cleared and it asks for the microphone, System Audio Recording and Screen Recording once more",
  );
}

/**
 * Put back what an install killed part way left behind, before this one touches anything: a surviving backup
 * replaces whatever is installed, since that was never seen running, and every other hidden staging, discarded or
 * backup folder is deleted.
 *
 * @param home the state home whose console call leases a quit reads
 * @returns the lines to print — none when there was nothing to put back
 */
export async function recoverLeftovers({
  seams,
  home,
}: {
  seams: InstallSeams;
  home: string;
}): Promise<Result<readonly string[], DesktopInstallError>> {
  const planned = attempt({
    act: () =>
      leftoverPlan({
        entries: seams.entries({ path: APPLICATIONS }).filter(({ name }) => name.startsWith(".Slopweaver-")),
      }),
    what: "could not read what an earlier interrupted install left behind",
  });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const { remove, restore } = planned.value;
  let permissions: string | undefined;
  const aside = swapPaths({ applications: APPLICATIONS, nonce: `recovered-${seams.nonce}` }).staged;
  if (restore !== undefined) {
    const quit = await quitRunning({ home, seams });
    if (quit.isErr()) {
      return err(quit.error);
    }
    const restored = restoreWithGrants({ aside, backup: join(APPLICATIONS, restore), seams });
    if (restored.isErr()) {
      return err(restored.error);
    }
    permissions = restored.value;
  }
  const cleared = attempt({
    act: () => {
      for (const path of [...remove.map((name) => join(APPLICATIONS, name)), aside]) {
        seams.remove({ path });
      }
    },
    what: "could not delete what an earlier interrupted install left behind",
  });
  if (cleared.isErr()) {
    return err(cleared.error);
  }
  if (restore === undefined) {
    return ok([]);
  }
  const line = `recovered: an interrupted install never saw its new build run, so the previous app is back (${restore})`;
  if (permissions === undefined) {
    return ok([line]);
  }
  return ok([line, permissions]);
}

/**
 * Stage the build beside the install, quit every running copy, and swap it in, restoring the previous install if
 * the swap fails. The quit comes after the copy, so nothing slow sits between the last look at running copies and
 * the renames. The previous install stays at its hidden backup name until the new one has been seen running.
 *
 * @param built the new Slopweaver.app, in its temporary build folder
 * @param home the state home whose console call leases the quit reads
 * @returns the line to print, and the backup's path when there was a previous app
 */
export async function swapIn({
  seams,
  built,
  home,
}: {
  seams: InstallSeams;
  built: string;
  home: string;
}): Promise<Result<{ line: string; backup: string | undefined }, DesktopInstallError>> {
  const paths = swapPaths({ applications: APPLICATIONS, nonce: seams.nonce });
  const staged = seams.run({ args: [built, paths.staged], command: "/usr/bin/ditto" });
  if (staged.isErr()) {
    return err(staged.error);
  }
  const quit = await quitRunning({ home, seams });
  if (quit.isErr()) {
    attempt({
      act: () => {
        seams.remove({ path: paths.staged });
      },
      what: "could not delete the staged build",
    });
    return err(quit.error);
  }
  seams.out({ line: quit.value });
  const hadPrevious = seams.exists({ path: paths.installed });
  const swapped = attempt({
    act: () => {
      if (hadPrevious) {
        seams.move({ from: paths.installed, to: paths.backup });
      }
      seams.move({ from: paths.staged, to: paths.installed });
    },
    what: "could not put the new app in place",
  });
  if (swapped.isErr()) {
    const restored = attempt({
      act: () => {
        if (hadPrevious && !seams.exists({ path: paths.installed }) && seams.exists({ path: paths.backup })) {
          seams.move({ from: paths.backup, to: paths.installed });
        }
        seams.remove({ path: paths.staged });
      },
      what: `${swapped.error.message}, and could not put the previous app back`,
    });
    return err(restored.isErr() ? restored.error : swapped.error);
  }
  if (!hadPrevious) {
    return ok({ backup: undefined, line: `installed: ${paths.installed}` });
  }
  return ok({ backup: paths.backup, line: `installed: replaced ${paths.installed}` });
}

/**
 * Put the previous install back after the new one never ran: the new build is moved to the hidden staging name
 * and deleted, the backup moved back, registered again and opened. A new build that will not quit, or a backup
 * that will not move back, leaves the new build installed with the backup beside it, which the next run restores
 * before anything else — never an empty /Applications.
 *
 * @param backup the previous app's hidden backup
 * @param home the state home whose console call leases the quit reads
 * @returns nothing once the previous app is back, else why not
 */
export async function rollBack({
  seams,
  backup,
  home,
}: {
  seams: InstallSeams;
  backup: string;
  home: string;
}): Promise<Result<void, DesktopInstallError>> {
  const paths = swapPaths({ applications: APPLICATIONS, nonce: seams.nonce });
  const quit = await quitRunning({ home, seams });
  if (quit.isErr()) {
    return err(quit.error);
  }
  const restored = restoreWithGrants({ aside: paths.staged, backup, seams });
  if (restored.isErr()) {
    return err(restored.error);
  }
  if (restored.value !== undefined) {
    seams.out({ line: restored.value });
  }
  // A staged copy left behind is a hidden folder the next install's recovery deletes.
  attempt({
    act: () => {
      seams.remove({ path: paths.staged });
    },
    what: "could not delete the new build after putting the previous app back",
  });
  return seams
    .run({ args: ["-f", paths.installed], command: LSREGISTER })
    .andThen(() => seams.run({ args: [paths.installed], command: "/usr/bin/open" }))
    .map(() => undefined);
}

/**
 * Delete the previous app once the new one is trusted. It is moved out of the backup name first, in one step, so
 * a deletion that stops part way leaves a folder the next install deletes, never a damaged backup it would
 * restore over the build just trusted.
 *
 * @param backup the previous app's hidden backup
 * @returns nothing once it is gone, else REPLACE_FAILED naming it
 */
export function discardBackup({
  seams,
  backup,
}: {
  seams: InstallSeams;
  backup: string;
}): Result<void, DesktopInstallError> {
  const { discard } = swapPaths({ applications: APPLICATIONS, nonce: seams.nonce });
  return attempt({
    act: () => {
      seams.move({ from: backup, to: discard });
      seams.remove({ path: discard });
    },
    what: `the app is installed, but its previous copy at ${backup} could not be deleted`,
  });
}

/** What one build and swap produced. */
export interface BuiltAndSwapped {
  readonly line: string;
  readonly backup: string | undefined;
  readonly resetFor: string | undefined;
}

/**
 * What the swap left for the steps after it: the previous app's backup, the lines still to print, and the new
 * build's requirement when macOS's grants are owed a clear before it opens.
 */
export interface Swapped {
  readonly backup: string | undefined;
  readonly pending: readonly string[];
  readonly resetFor: string | undefined;
}

/**
 * Swap in what `swap` produces from `folder`, then delete the folder whatever happened. A failure to delete it is
 * reported, never thrown past the rollback: before the swap it is printed at once, after it handed on to be printed
 * with the swap's own line inside the guarded steps, since printing can throw too.
 *
 * @param seams every effect on this Mac
 * @param folder the build's own folder — a fresh build's temporary one, or the claimed stage
 * @param swap the swap itself, run before the folder is deleted
 * @returns the swap's backup and lines still to print, or the step that stopped it
 */
export async function swapThenDelete({
  seams,
  folder,
  swap,
}: {
  seams: InstallSeams;
  folder: string;
  swap: () => Promise<Result<BuiltAndSwapped, DesktopInstallError>>;
}): Promise<Result<Swapped, DesktopInstallError>> {
  const pending: string[] = [];
  let swapped: Result<BuiltAndSwapped, DesktopInstallError> | undefined;
  try {
    swapped = await swap();
  } finally {
    const cleaned = attempt({
      act: () => {
        seams.remove({ path: folder });
      },
      what: `could not delete the build folder at ${folder}`,
    });
    if (cleaned.isErr()) {
      pending.push(`cleanup: ${cleaned.error.message}`);
    }
  }
  if (swapped.isErr()) {
    for (const line of pending) {
      seams.out({ line });
    }
    return err(swapped.error);
  }
  return ok({
    backup: swapped.value.backup,
    pending: [swapped.value.line, ...pending],
    resetFor: swapped.value.resetFor,
  });
}
