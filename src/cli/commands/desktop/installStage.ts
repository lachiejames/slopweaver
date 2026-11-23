/**
 * The install's half of the prebuilt update: take the build `desktop prebuild` staged (`prebuildHeld.ts`) when it
 * is exactly what this install would build, or put it back and say why the install builds fresh instead. The
 * verdict is pure in `../../../desktop/stagedBuild.ts`; the install around it is `installRun.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { ShellStamp } from "../../../desktop/buildStamp.js";
import type { DesktopInstallError } from "../../../desktop/errors.js";
import { identityRequirement } from "../../../desktop/signing.js";
import { type StagePaths, stagedBundle, stageVerdict } from "../../../desktop/stagedBuild.js";
import { attempt, checkBundle } from "./installProcess.js";
import type { InstallSeams } from "./installSeams.js";
import { bundleRequirement } from "./installSigning.js";
import { bundleStamp, readHeadStamp } from "./installStamp.js";

/**
 * Put a claimed build that cannot be used back in the stage, for the next prebuild to judge, or delete it when it
 * will not go back — never leave it claimed.
 */
function returnClaim({ seams, paths }: { seams: InstallSeams; paths: StagePaths }): void {
  const back = attempt({
    act: () => {
      seams.move({ from: paths.claimed, to: paths.ready });
    },
    what: `could not put the staged build back at ${paths.ready}`,
  });
  if (back.isOk()) {
    return;
  }
  const cleaned = attempt({
    act: () => {
      seams.remove({ path: paths.claimed });
    },
    what: `could not delete the build folder at ${paths.claimed}`,
  });
  if (cleaned.isErr()) {
    seams.out({ line: `cleanup: ${cleaned.error.message}` });
  }
}

/**
 * Take the prebuilt build of HEAD out of the stage, when it is exactly what this install would build. It is claimed
 * FIRST — moved to a folder of this run's own, so nothing can replace it under the checks or the swap — and every
 * check then reads what was claimed, never what the stage held a moment before, against HEAD read
 * after the claim. A build that fails a check goes back to the stage and the install builds fresh,
 * saying why.
 *
 * @param seams every effect on this Mac
 * @param head HEAD as the install first read it: the fresh build's stamp when nothing is staged or claimed
 * @param root the checkout HEAD is read again from
 * @param sha1 the app's signing identity, whose requirement the staged build must be signed with
 * @param paths the stage's folders
 * @returns the folder now holding it, or `undefined` to build instead, with HEAD as last read — the fresh build's
 *   stamp
 */
export function takeStage({
  seams,
  head,
  root,
  sha1,
  paths,
}: {
  seams: InstallSeams;
  head: ShellStamp;
  root: string;
  sha1: string;
  paths: StagePaths;
}): Result<{ claimed: string | undefined; head: ShellStamp }, DesktopInstallError> {
  if (!seams.exists({ path: stagedBundle({ folder: paths.ready }) })) {
    return ok({ claimed: undefined, head });
  }
  const claimed = attempt({
    act: () => {
      seams.move({ from: paths.ready, to: paths.claimed });
    },
    what: `could not take the staged build at ${paths.ready}`,
  });
  if (claimed.isErr()) {
    seams.out({ line: `staged: not used — ${claimed.error.message}; building instead` });
    return ok({ claimed: undefined, head });
  }
  const now = readHeadStamp({ root, seams });
  if (now.isErr()) {
    returnClaim({ paths, seams });
    return err(now.error);
  }
  const bundle = stagedBundle({ folder: paths.claimed });
  const verified = seams.run({ args: ["--verify", "--deep", "--strict", bundle], command: "/usr/bin/codesign" });
  const verdict = stageVerdict({
    facts: {
      expected: identityRequirement({ sha1 }),
      head: now.value,
      requirement: bundleRequirement({ bundle, seams }),
      stamp: bundleStamp({ bundle, seams }),
      verified: verified.isOk(),
    },
  });
  if (!verdict.usable) {
    returnClaim({ paths, seams });
    seams.out({ line: `staged: not used — ${verdict.why}; building instead` });
    return ok({ claimed: undefined, head: now.value });
  }
  // The bundle's own shape too, here rather than at the swap, so a staged app that is signed and stamped right but
  // is not this app goes back and is built over, never ends the install.
  const shaped = checkBundle({ path: bundle, seams });
  if (shaped.isErr()) {
    returnClaim({ paths, seams });
    seams.out({ line: `staged: not used — ${shaped.error.message}; building instead` });
    return ok({ claimed: undefined, head: now.value });
  }
  seams.out({ line: `staged: installing the build prebuilt at ${now.value.sha.slice(0, 9)}, so nothing is built now` });
  return ok({ claimed: paths.claimed, head: now.value });
}
