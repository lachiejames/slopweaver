/**
 * `slopweaver desktop install` — the desktop app as a real Mac app the owner finds again after closing it, installed with no
 * hand step needed.
 *
 * One straight line, each step printed: build this checkout's `desktop/` into a temporary folder (never a
 * `desktop/dist` LaunchServices would list as a second app), check the bundle is the one app, quit every running
 * copy, stage the build beside `/Applications/Slopweaver.app` and swap it in (the old install kept until the new
 * one stands, restored if it cannot), register it and unregister every other copy by the same identifier, ask
 * Spotlight to index it, and open it once on the declared MAIN checkout — never this worktree, which is deleted
 * after landing — waiting until the app has saved that checkout, so a launch from Applications serves the
 * console with no arguments. The decisions are pure in `../../../desktop/installPlan.ts`; every effect goes
 * through `installSeams.ts`.
 *
 * When `desktop prebuild` has already built and signed exactly HEAD (`prebuildRun.ts`, run on every move of main),
 * that build is swapped in instead and nothing is built — so the owner's Update now waits on no build of its own. Anything
 * short of exactly HEAD, signed with the app's identity and verifying, is built fresh (`installStage.ts`) — from an
 * export of HEAD's commit when the checkout carries no local `desktop/` edits (`buildFresh`).
 *
 * Every build is signed with the app's one self-signed identity (`installSigning.ts`), so a grant the owner gives macOS
 * survives the next rebuild; when the signature changes, the old grants are cleared before the new build opens. A
 * locally built app carries no quarantine attribute, so no Gatekeeper prompt is expected; if one ever appears,
 * that is one step on the owner's Queue, never something this verb clears.
 */
import { join } from "node:path";

import { err, type Result } from "#lib/result.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { type ShellStamp, stampArgs } from "../../../desktop/buildStamp.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import {
  BUNDLE_ID,
  BUNDLE_NAME,
  desktopInstallArgs,
  hostSupported,
  INSTALLED_BUNDLE,
} from "../../../desktop/installPlan.js";
import { grantsNeedReset, identityRequirement } from "../../../desktop/signing.js";
import { type StagePaths, stagedBundle, stagePaths } from "../../../desktop/stagedBuild.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { BUILD_LOCK_KEY, holdBuildLock } from "./buildLock.js";
import { DESKTOP_INSTALL_USAGE } from "./desktopUsage.js";
import { afterSwap, settle } from "./installAfterSwap.js";
import { APP_SUPPORT, attempt, checkBundle, GRANTED_REQUIREMENT, SIGNING_KEYCHAIN } from "./installProcess.js";
import { type InstallSeams, machineSeams } from "./installSeams.js";
import { bundleRequirement, grantedRequirement, signBundle, signingIdentity } from "./installSigning.js";
import { takeStage } from "./installStage.js";
import { readHeadStamp, refuseDuringCall, sameHead, verifyStamp } from "./installStamp.js";
import { type BuiltAndSwapped, recoverLeftovers, type Swapped, swapIn, swapThenDelete } from "./installSwap.js";
import { exportCommit } from "./prebuildHeld.js";

/** argv[0..3] are node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/**
 * Build into `output`, check the bundle, sign it with the app's identity, decide whether the grants are owed a
 * clear, and swap the build in, which quits every running copy first. HEAD is read again once the build is done, and
 * a commit, checkout or edit landing meanwhile refuses the install rather than put in a build HEAD has left behind.
 */
async function buildAndSwap({
  seams,
  desktop,
  root,
  count,
  home,
  output,
  sha1,
  stamp,
}: {
  seams: InstallSeams;
  desktop: string;
  root: string;
  count: string;
  home: string;
  output: string;
  sha1: string;
  stamp: ShellStamp;
}): Promise<Result<BuiltAndSwapped, DesktopInstallError>> {
  const built = seams.run({
    args: ["app", `--config.directories.output=${output}`, `--config.buildVersion=${count}`, ...stampArgs({ stamp })],
    command: "yarn",
    cwd: desktop,
  });
  if (built.isErr()) {
    return err(built.error);
  }
  const bundle = join(output, "mac-arm64", BUNDLE_NAME);
  const checked = checkBundle({ path: bundle, seams })
    .andThen(() => verifyStamp({ bundle, seams, stamp }))
    .andThen(() => sameHead({ root, seams, stamp }));
  if (checked.isErr()) {
    return err(checked.error);
  }
  seams.out({ line: `stamp: built from ${stamp.sha.slice(0, 9)} (${stamp.tree})` });
  const signed = signBundle({ bundle, keychain: SIGNING_KEYCHAIN, seams, sha1 });
  if (signed.isErr()) {
    return err(signed.error);
  }
  seams.out({ line: `built: ${BUNDLE_ID} build ${count}, signed ${signed.value}` });
  return swapSigned({ bundle, home, requirement: signed.value, seams });
}

/**
 * Decide whether the grants are owed a clear, then swap a signed build in, which quits every running copy first.
 *
 * @returns the swap's line and backup, and the requirement the grants are owed a clear for
 */
async function swapSigned({
  seams,
  bundle,
  home,
  requirement,
}: {
  seams: InstallSeams;
  bundle: string;
  home: string;
  requirement: string;
}): Promise<Result<BuiltAndSwapped, DesktopInstallError>> {
  const recorded = grantedRequirement({ record: GRANTED_REQUIREMENT, seams });
  const replaced = bundleRequirement({ bundle: INSTALLED_BUNDLE, seams });
  const owed = grantsNeedReset({ next: requirement, recorded, replaced });
  const swapped = await swapIn({ built: bundle, home, seams });
  return swapped.map(({ line, backup }) => ({ backup, line, resetFor: owed ? requirement : undefined }));
}

/**
 * Every step in order, printing each line as it lands. A live voice call refuses the run first, because every later
 * step can quit the app and end it; recovery comes next, before anything else that can fail, so an interrupted
 * install is put right on the next run whatever that run later refuses.
 *
 * @param seams every effect on this Mac
 * @param home the state home the main checkout is resolved from
 * @returns nothing once the new build is installed and trusted, else the step that stopped it
 */
export async function installHeld({
  seams,
  home,
}: {
  seams: InstallSeams;
  home: string;
}): Promise<Result<void, DesktopInstallError>> {
  // Before recovery too: putting back an interrupted install's app quits the running one.
  const calm = refuseDuringCall({ home, seams });
  if (calm.isErr()) {
    return err(calm.error);
  }
  const recovered = await recoverLeftovers({ home, seams });
  if (recovered.isErr()) {
    return err(recovered.error);
  }
  for (const line of recovered.value) {
    seams.out({ line });
  }
  const checkout = seams.mainCheckout({ home });
  if (checkout.isErr()) {
    return err(checkout.error);
  }
  // Before the slow build, so a keychain that cannot sign stops the run while nothing is touched.
  const sha1 = signingIdentity({ keychain: SIGNING_KEYCHAIN, seams });
  if (sha1.isErr()) {
    return err(sha1.error);
  }
  const root = seams.runningRoot();
  const stamp = readHeadStamp({ root, seams });
  if (stamp.isErr()) {
    return err(stamp.error);
  }
  const paths = stagePaths({ appSupport: APP_SUPPORT, nonce: seams.nonce });
  const taken = takeStage({ head: stamp.value, paths, root, seams, sha1: sha1.value });
  if (taken.isErr()) {
    return err(taken.error);
  }
  const { claimed, head } = taken.value;
  let swapped: Result<Swapped, DesktopInstallError>;
  if (claimed === undefined) {
    swapped = await buildFresh({ home, paths, root, seams, sha1: sha1.value, stamp: head });
  } else {
    const bundle = stagedBundle({ folder: claimed });
    const requirement = identityRequirement({ sha1: sha1.value });
    swapped = await swapThenDelete({
      folder: claimed,
      seams,
      // `takeStage` checked this claimed bundle's shape, signature and stamp, and nothing else can reach its folder.
      swap: () => swapSigned({ bundle, home, requirement, seams }),
    });
  }
  if (swapped.isErr()) {
    return err(swapped.error);
  }
  return openAndSettle({ checkout: checkout.value, home, seams, swapped: swapped.value });
}

/**
 * Build in a temporary folder and swap it in — the install with nothing staged. A clean HEAD is built from an export
 * of its commit, exactly as the prebuild builds it, so nothing the checkout holds outside the commit — ignored
 * compiler output under `desktop/build/`, an edit made mid-build — goes in under a clean stamp.
 * Only a checkout with local edits is built in place, and its stamp says dirty, claiming no particular bytes.
 */
async function buildFresh({
  seams,
  home,
  root,
  sha1,
  stamp,
  paths,
}: {
  seams: InstallSeams;
  home: string;
  root: string;
  sha1: string;
  stamp: ShellStamp;
  paths: StagePaths;
}): Promise<Result<Swapped, DesktopInstallError>> {
  try {
    let desktop = join(root, "desktop");
    if (stamp.tree === "clean") {
      const exported = exportCommit({ root, seams, sha: stamp.sha, source: paths.source });
      if (exported.isErr()) {
        return err(exported.error);
      }
      desktop = exported.value;
    }
    seams.out({ line: `building: ${desktop}` });
    const count = seams
      .run({ args: ["install", "--immutable"], command: "yarn", cwd: desktop })
      .andThen(() => seams.run({ args: ["rev-list", "--count", stamp.sha], command: "git", cwd: root }));
    if (count.isErr()) {
      return err(count.error);
    }
    const output = attempt({ act: () => seams.tempFolder(), what: "could not make a temporary build folder" });
    if (output.isErr()) {
      return err(output.error);
    }
    return await swapThenDelete({
      folder: output.value,
      seams,
      swap: () =>
        buildAndSwap({ count: count.value.trim(), desktop, home, output: output.value, root, seams, sha1, stamp }),
    });
  } finally {
    seams.remove({ path: paths.source });
  }
}

/**
 * Every step after the swap, then keep or undo it. A throw after the swap is a failure like any other — printing
 * included — so it reaches the rollback rather than escaping past it.
 */
async function openAndSettle({
  seams,
  home,
  checkout,
  swapped,
}: {
  seams: InstallSeams;
  home: string;
  checkout: string;
  swapped: Swapped;
}): Promise<Result<void, DesktopInstallError>> {
  let clearedFor: string | undefined;
  const opened = await afterSwap({
    checkout,
    home,
    installed: INSTALLED_BUNDLE,
    pending: swapped.pending,
    onGrantsCleared: () => {
      clearedFor = swapped.resetFor;
    },
    resetFor: swapped.resetFor,
    seams,
  }).catch((cause: unknown): Result<{ opened: string; kept: readonly string[] }, DesktopInstallError> =>
    err(
      DesktopInstallErrors.replaceFailed({
        detail: `after the swap: ${cause instanceof Error ? cause.message : "an unexpected throw"}`,
        path: INSTALLED_BUNDLE,
      }),
    ),
  );
  return settle({ backup: swapped.backup, clearedFor, home, opened, seams });
}

/**
 * One install at a time: two overlapping ones would each back up the other's unvalidated build and race their
 * moves, so a second is refused while the first is alive. A killed holder's lock is taken over at once, provided
 * `ps` gives this process its own start stamp: a never-stale lease cannot be judged without one, so the lock
 * refuses instead, and every refusal is reported as INSTALL_IN_PROGRESS carrying the lock's own reason. The lock
 * lives in the app's own folder rather than the state home, so installs from two homes still take turns.
 *
 * A prebuild (`prebuildRun.ts`) holds the separate build lock while it builds; the install WAITS for that one
 * rather than refusing, because the build it is waiting on is usually the one it is about to install.
 *
 * @param home the state home the main checkout and the call leases are read from
 * @returns nothing once the new build is installed and trusted, else the step that stopped it
 */
export async function install({ home }: { home: string }): Promise<Result<void, DesktopInstallError>> {
  const host = hostSupported({ arch: process.arch, platform: process.platform });
  if (host.isErr()) {
    return err(host.error);
  }
  const lockAt = ({ key }: { key: string }): ReturnType<typeof acquireOperationLock> =>
    acquireOperationLock({
      home: APP_SUPPORT,
      key,
      nowIso: new Date().toISOString(),
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
  const lock = lockAt({ key: "desktop-install" });
  if (lock.isErr()) {
    return err(DesktopInstallErrors.installInProgress({ detail: lock.error }));
  }
  const seams = machineSeams();
  try {
    const build = await holdBuildLock({
      acquire: () => lockAt({ key: BUILD_LOCK_KEY }),
      nowMs: seams.nowMs,
      pause: seams.pause,
      waiting: () => {
        seams.out({ line: "waiting: the app is being prebuilt; installing once that build is done" });
      },
    });
    if (build.isErr()) {
      return err(DesktopInstallErrors.installInProgress({ detail: build.error }));
    }
    try {
      return await installHeld({ home, seams });
    } finally {
      build.value.release();
    }
  } finally {
    lock.value.release();
  }
}

/**
 * `desktop install` — build, install and open the desktop app.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runDesktopInstall(argv: readonly string[]): Promise<number> {
  const parsed = desktopInstallArgs({ args: argv.slice(VERB_ARG_OFFSET) });
  if (parsed === undefined) {
    logger.error({ msg: DESKTOP_INSTALL_USAGE });
    return EXIT_USAGE;
  }
  if (parsed.help) {
    logger.out({ line: DESKTOP_INSTALL_USAGE });
    return EXIT_OK;
  }
  let home = slopweaverHome();
  if (parsed.home !== undefined) {
    home = parsed.home;
  }
  const done = await install({ home });
  if (done.isErr()) {
    logger.error({ msg: `desktop install: ${done.error.message}` });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const desktopInstallCommand = defineCommand({ run: runDesktopInstall });
