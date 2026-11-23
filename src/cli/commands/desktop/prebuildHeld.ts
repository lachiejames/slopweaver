/**
 * One prebuild under the build lock: decide again, compile an export of HEAD's commit into a folder of its own, and
 * make it the ready build only while HEAD still names that commit. The verb around it — the hook's two halves, the
 * lock, the log — is `prebuildRun.ts`; the decisions are pure in `../../../desktop/stagedBuild.ts`.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { type ShellStamp, stampArgs } from "../../../desktop/buildStamp.js";
import { desktopScriptArchivePaths } from "../../../desktop/desktopScriptArchivePaths.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import { INSTALLED_BUNDLE } from "../../../desktop/installPlan.js";
import {
  caseCollidingPaths,
  type PrebuildDecision,
  prebuildDecision,
  type StagePaths,
  stagedBundle,
  trackedSymlinks,
} from "../../../desktop/stagedBuild.js";
import { attempt, checkBundle, SIGNING_KEYCHAIN } from "./installProcess.js";
import type { InstallSeams } from "./installSeams.js";
import { signBundle, signingIdentity } from "./installSigning.js";
import { appSourceDiffers, bundleStamp, readHeadStamp, verifyStamp } from "./installStamp.js";

/** What one prebuild did, which is the one line the hook prints or the log records. */
export type PrebuildOutcome =
  | { readonly did: "skipped"; readonly why: string }
  | { readonly did: "due"; readonly why: string; readonly log: string }
  | { readonly did: "built"; readonly sha: string }
  | { readonly did: "moved"; readonly from: string; readonly to: string }
  | { readonly did: "failed"; readonly error: DesktopInstallError };

/**
 * Read everything the decision needs and decide. A checkout with no declared main checkout is simply not one.
 *
 * @param seams every effect on this Mac
 * @param home the state home the main checkout is resolved from
 * @param paths the stage's folders
 * @returns the decision and HEAD's stamp, or the step that could not be read
 */
export function decidePrebuild({
  seams,
  home,
  paths,
}: {
  seams: InstallSeams;
  home: string;
  paths: StagePaths;
}): Result<{ decision: PrebuildDecision; root: string; head: ShellStamp }, DesktopInstallError> {
  const root = seams.runningRoot();
  const main = seams.mainCheckout({ home });
  const head = readHeadStamp({ root, seams });
  if (head.isErr()) {
    return err(head.error);
  }
  const installed = bundleStamp({ bundle: INSTALLED_BUNDLE, seams });
  let installedDiffers = true;
  if (installed !== undefined) {
    installedDiffers = appSourceDiffers({ from: installed.sha, root, seams });
  }
  const decision = prebuildDecision({
    facts: {
      head: head.value,
      installed,
      installedDiffers,
      isMain: main.isOk() && main.value === root,
      keychain: seams.exists({ path: SIGNING_KEYCHAIN }),
      ready: bundleStamp({ bundle: stagedBundle({ folder: paths.ready }), seams }),
    },
  });
  return ok({ decision, head: head.value, root });
}

/** Delete what a killed build or install left in the stage. Only ever run under the build lock. */
function clearLeftovers({ seams, paths }: { seams: InstallSeams; paths: StagePaths }): void {
  if (!seams.exists({ path: paths.root })) {
    return;
  }
  for (const name of seams.names({ path: paths.root })) {
    if (name.startsWith("building-") || name.startsWith("claimed-") || name.startsWith("source-")) {
      seams.remove({ path: join(paths.root, name) });
    }
  }
}

/**
 * What one commit's export carries: `desktop/`, plus every repository path its committed `desktop/package.json`
 * scripts name through `..` (`desktopScriptArchivePaths`), the compiler owner `scripts/tsc-owner.sh` among them.
 */
function exportPathspecs({
  seams,
  root,
  sha,
}: {
  seams: InstallSeams;
  root: string;
  sha: string;
}): Result<readonly string[], DesktopInstallError> {
  const manifest = `${sha}:desktop/package.json`;
  return seams.run({ args: ["show", manifest], command: "git", cwd: root }).andThen((text) => {
    const extra = desktopScriptArchivePaths({ text });
    if (extra.isErr()) {
      const command = `git show ${sha.slice(0, 9)}:desktop/package.json`;
      return err(DesktopInstallErrors.stepFailed({ command, detail: extra.error.message }));
    }
    return ok(["desktop", ...extra.value]);
  });
}

/**
 * Why the tree an export would carry cannot be extracted faithfully: a tracked symlink reaches outside the copy
 * (`trackedSymlinks`), and two paths differing only in case extract onto one file on this Mac (`caseCollidingPaths`).
 */
function checkExportTree({
  tree,
  sha,
  pathspecs,
}: {
  tree: string;
  sha: string;
  pathspecs: readonly string[];
}): Result<void, DesktopInstallError> {
  const command = `git ls-tree -r ${sha.slice(0, 9)} -- ${pathspecs.join(" ")}`;
  const links = trackedSymlinks({ tree });
  if (links.length > 0) {
    const detail = `it tracks symlinks (${links.join(", ")}), which can reach outside the exported commit`;
    return err(DesktopInstallErrors.stepFailed({ command, detail }));
  }
  const colliding = caseCollidingPaths({ tree });
  if (colliding.length > 0) {
    const detail = `it tracks paths that differ only in case (${colliding.join(", ")}), which extract onto one file on this Mac`;
    return err(DesktopInstallErrors.stepFailed({ command, detail }));
  }
  return ok(undefined);
}

/**
 * Whether the extracted copy holds every exported path. `git archive` can leave a listed path out on its own terms — a
 * committed `export-ignore` attribute is one — so the copy is checked rather than the archive's selection
 * trusted. Residue: this checks PRESENCE, not bytes. A committed `export-subst` attribute still has the archive expand
 * `$Format:…$` placeholders in a file it carries. This repository tracks no `.gitattributes`
 * (`git ls-files -- '*.gitattributes'` prints nothing); comparing each extracted file to its `ls-tree` blob is what
 * would close it.
 */
function checkExtracted({
  seams,
  source,
  sha,
  paths,
  pathspecs,
}: {
  seams: InstallSeams;
  source: string;
  sha: string;
  paths: readonly string[];
  pathspecs: readonly string[];
}): Result<void, DesktopInstallError> {
  const missing = paths.filter((path) => !seams.exists({ path: join(source, path) }));
  if (missing.length > 0) {
    const detail = `the export left out ${missing.join(", ")}, which the desktop scripts reach`;
    const command = `git archive ${sha.slice(0, 9)} -- ${pathspecs.join(" ")}`;
    return err(DesktopInstallErrors.stepFailed({ command, detail }));
  }
  return ok(undefined);
}

/**
 * Export exactly one commit's `desktop/`, and the repository files its build scripts reach outside it, into the
 * source folder. The build compiles this copy, never the checkout: a checkout that moves while the build runs — even
 * away and back, A→B→A, which no read of HEAD can see — would otherwise put another commit's code under this commit's
 * stamp. A commit tracking a symlink in any exported path is refused before anything is exported,
 * since a link reaches outside the copy (`trackedSymlinks`). A fresh `desktop install` of a clean HEAD builds the same
 * export (`installRun.ts`).
 *
 * @param root the checkout whose object store holds the commit
 * @param source the folder the export is written into, which the caller removes
 * @returns the exported `desktop/`, or the step that failed
 */
export function exportCommit({
  seams,
  root,
  sha,
  source,
}: {
  seams: InstallSeams;
  root: string;
  sha: string;
  source: string;
}): Result<string, DesktopInstallError> {
  const archive = join(source, "desktop.tar");
  return exportPathspecs({ root, seams, sha }).andThen((paths) => {
    // Each path is passed as a LITERAL pathspec: a raw `:/foo` is git's top-level magic and selects `foo`, so a script
    // naming `../:/foo` would export the wrong file to both the symlink scan and the archive. MEASURED in a
    // throwaway repo tracking `foo` and `:/foo`: `git ls-tree -r HEAD -- ":/foo"` lists `foo`, and
    // `-- ":(literal):/foo"` lists `:/foo`, for `git archive` too.
    const pathspecs = paths.map((path) => `:(literal)${path}`);
    return seams
      .run({ args: ["ls-tree", "-r", sha, "--", ...pathspecs], command: "git", cwd: root })
      .andThen((tree) => checkExportTree({ pathspecs, sha, tree }))
      .andThen(() => {
        // Emptied first: a killed run under a reused pid leaves this very folder, and a file another commit tracked
        // would otherwise survive the extraction into the build.
        seams.remove({ path: source });
        return seams.run({ args: ["-p", source], command: "/bin/mkdir" });
      })
      .andThen(() =>
        seams.run({
          args: ["archive", "--format=tar", "-o", archive, sha, "--", ...pathspecs],
          command: "git",
          cwd: root,
        }),
      )
      .andThen(() => seams.run({ args: ["-x", "-f", archive, "-C", source], command: "/usr/bin/tar" }))
      .andThen(() => checkExtracted({ paths, pathspecs, seams, sha, source }))
      .map(() => join(source, "desktop"));
  });
}

/** Build, check, stamp-verify, sign and signature-verify the app of HEAD's commit into the building folder. */
function buildInto({
  seams,
  root,
  head,
  paths,
}: {
  seams: InstallSeams;
  root: string;
  head: ShellStamp;
  paths: StagePaths;
}): Result<void, DesktopInstallError> {
  const folder = paths.building;
  const exported = exportCommit({ root, seams, sha: head.sha, source: paths.source });
  if (exported.isErr()) {
    return err(exported.error);
  }
  const desktop = exported.value;
  const count = seams
    .run({ args: ["install", "--immutable"], command: "yarn", cwd: desktop })
    .andThen(() => seams.run({ args: ["rev-list", "--count", head.sha], command: "git", cwd: root }));
  if (count.isErr()) {
    return err(count.error);
  }
  const built = seams.run({
    args: [
      "app",
      `--config.directories.output=${folder}`,
      `--config.buildVersion=${count.value.trim()}`,
      ...stampArgs({ stamp: head }),
    ],
    command: "yarn",
    cwd: desktop,
  });
  if (built.isErr()) {
    return err(built.error);
  }
  const bundle = stagedBundle({ folder });
  const checked = checkBundle({ path: bundle, seams }).andThen(() => verifyStamp({ bundle, seams, stamp: head }));
  if (checked.isErr()) {
    return err(checked.error);
  }
  return signingIdentity({ keychain: SIGNING_KEYCHAIN, seams })
    .andThen((sha1) => signBundle({ bundle, keychain: SIGNING_KEYCHAIN, seams, sha1 }))
    .andThen(() =>
      seams
        .run({ args: ["--verify", "--deep", "--strict", bundle], command: "/usr/bin/codesign" })
        .map(() => undefined),
    );
}

/**
 * Decide again under the lock — a run that waited may find its build already made — then build into a folder of
 * its own and, only if HEAD has not moved meanwhile, make it the ready one. A build that fails is deleted and the
 * ready one left alone; one overtaken by a HEAD move is deleted with the ready one, which that move left stale too.
 *
 * @param seams every effect on this Mac
 * @param home the state home the main checkout is resolved from
 * @param paths the stage's folders
 * @returns what the run did
 */
export function prebuildHeld({
  seams,
  home,
  paths,
}: {
  seams: InstallSeams;
  home: string;
  paths: StagePaths;
}): PrebuildOutcome {
  const decided = decidePrebuild({ home, paths, seams });
  if (decided.isErr()) {
    return { did: "failed", error: decided.error };
  }
  const { decision, head, root } = decided.value;
  if (!decision.due) {
    return { did: "skipped", why: decision.why };
  }
  clearLeftovers({ paths, seams });
  let built: Result<void, DesktopInstallError>;
  try {
    built = buildInto({ head, paths, root, seams });
  } finally {
    seams.remove({ path: paths.source });
  }
  const after = built.andThen(() => readHeadStamp({ root, seams }));
  if (after.isErr()) {
    seams.remove({ path: paths.building });
    return { did: "failed", error: after.error };
  }
  if (after.value.sha !== head.sha || after.value.tree !== "clean") {
    // The ready one goes too: the decision found it was not this HEAD, the lock kept any other build out, and the
    // HEAD has moved on from both — so it can only be stale, and the stage never holds what HEAD is not.
    seams.remove({ path: paths.building });
    seams.remove({ path: paths.ready });
    return { did: "moved", from: head.sha, to: after.value.sha };
  }
  return placeBuild({ head, paths, root, seams });
}

/**
 * Make the finished build the ready one, then read HEAD once more, so a move that landed between the last check and
 * the placement does not leave it standing. A move after THIS read is the one window no read
 * closes; it is harmless, since `desktop install` takes only a build stamped with the HEAD it reads after claiming
 * one, and the move's own post-merge prebuild, waiting on this lock, replaces it.
 *
 * @returns what the run did
 */
function placeBuild({
  seams,
  root,
  head,
  paths,
}: {
  seams: InstallSeams;
  root: string;
  head: ShellStamp;
  paths: StagePaths;
}): PrebuildOutcome {
  const placed = attempt({
    act: () => {
      seams.remove({ path: paths.ready });
      seams.move({ from: paths.building, to: paths.ready });
    },
    what: `could not move the build into ${paths.ready}`,
  });
  if (placed.isErr()) {
    seams.remove({ path: paths.building });
    return { did: "failed", error: placed.error };
  }
  const placedHead = readHeadStamp({ root, seams });
  if (placedHead.isErr()) {
    seams.remove({ path: paths.ready });
    return { did: "failed", error: placedHead.error };
  }
  if (placedHead.value.sha !== head.sha || placedHead.value.tree !== "clean") {
    seams.remove({ path: paths.ready });
    return { did: "moved", from: head.sha, to: placedHead.value.sha };
  }
  return { did: "built", sha: head.sha };
}
