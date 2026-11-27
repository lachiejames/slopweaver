/**
 * `machine free-disk`'s read seams: what each target's paths are on this machine, measured without following a
 * single link (`observePath.ts`), plus the two git probes over the pre-setup copy, the process table for a running
 * bundle, and the Docker VM's own `df` and `fstrim -n`. Nothing here writes: the two acts live in the command
 * (`cli/commands/machine/freeDisk.ts`), each behind a fresh run of these reads through the pure planner.
 *
 * Every subprocess is a bounded `execFileSync` over a fixed argv, never a shell string.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { isNotFoundError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { observeBeforeSetupCopy } from "./beforeSetupRead.js";
import { type FreeDiskError, FreeDiskErrors } from "./errors.js";
import { observeAll, observePath, pidsInsideBundle } from "./observePath.js";
import { parseVmDataMount } from "./plan.js";
import {
  APPLICATIONS_ROOT,
  CLEARABLE_PACKAGE_CACHES,
  dockerTrimArgv,
  dockerVmDfArgv,
  type FreeDiskTarget,
  freeDiskPaths,
} from "./registry.js";
import type { AppObservation, DockerDataObservation, FreeDiskObservation, PackageCachesObservation } from "./types.js";

/** A local read's bound. */
const READ_TIMEOUT_MS = 60_000;

/** A Docker command's bound: a container start plus an `fstrim` of the VM's data disk. */
const DOCKER_TIMEOUT_MS = 10 * 60_000;

/** The most output any read here keeps. */
const MAX_BUFFER = 8 * 1024 * 1024;

/** The immediate children of Slopweaver's cache root, by name, or none when the root is not there. */
function slopweaverChildren({
  root,
}: {
  root: string;
}): Result<readonly { label: string; path: string }[], FreeDiskError> {
  try {
    return ok(
      readdirSync(root)
        .toSorted()
        .map((name) => ({ label: name, path: join(root, name) })),
    );
  } catch (cause: unknown) {
    if (isNotFoundError({ error: cause })) {
      return ok([]);
    }
    return err(FreeDiskErrors.readFailed({ cause, path: root }));
  }
}

/**
 * `package-caches`: the four clearable caches, and — unless `actedOnly` — npm's, Yarn's and every child of
 * Slopweaver's own cache beside them. A recheck before an act reads only the clearable four, so it never walks
 * the lap worktrees again.
 */
function observePackageCaches({
  userHome,
  actedOnly,
}: {
  userHome: string;
  actedOnly: boolean;
}): Result<PackageCachesObservation, FreeDiskError> {
  const paths = freeDiskPaths({ userHome });
  const clearable = observeAll({
    entries: CLEARABLE_PACKAGE_CACHES.map((cache) => ({
      label: cache.label,
      path: join(paths.libraryCaches, cache.cacheDir),
    })),
    walk: true,
  });
  if (clearable.isErr()) {
    return err(clearable.error);
  }
  if (actedOnly) {
    return ok({ clearable: clearable.value, kept: [], kind: "package-caches", slopweaverChildren: [] });
  }
  const kept = observeAll({
    entries: [
      { label: "npm", path: paths.npmCache },
      { label: "Yarn", path: paths.yarnCache },
    ],
    walk: true,
  });
  if (kept.isErr()) {
    return err(kept.error);
  }
  const children = slopweaverChildren({ root: paths.slopweaverCacheRoot });
  if (children.isErr()) {
    return err(children.error);
  }
  const slopweaver = observeAll({ entries: children.value, walk: true });
  if (slopweaver.isErr()) {
    return err(slopweaver.error);
  }
  return ok({
    clearable: clearable.value,
    kept: kept.value,
    kind: "package-caches",
    slopweaverChildren: slopweaver.value,
  });
}

/** The only `docker` argvs this verb runs: the VM's `df`, the trim's dry run, and the trim. */
const ALLOWED_DOCKER_ARGVS: readonly (readonly string[])[] = [
  dockerVmDfArgv(),
  dockerTrimArgv({ dryRun: true }),
  dockerTrimArgv({ dryRun: false }),
];

/**
 * Run one fixed `docker` argv, bounded, and return its stdout. Any argv that is not exactly one of the registry's
 * three commands is refused before `docker` starts, so no caller can reach a prune, a pull or a restart through it.
 *
 * @param argv the arguments after `docker`, which must equal one of the registry's fixed commands
 * @returns stdout, or the refusal or failure carrying the argv
 */
export function runDocker({ argv }: { argv: readonly string[] }): Result<string, FreeDiskError> {
  const fixed = ALLOWED_DOCKER_ARGVS.find(
    (candidate) => candidate.length === argv.length && candidate.every((part, index) => part === argv[index]),
  );
  if (fixed === undefined) {
    return err(FreeDiskErrors.dockerArgvRefused({ argv }));
  }
  try {
    // The registry's own array runs, never the caller's: an argv read twice could answer differently each time.
    return ok(
      execFileSync("docker", [...fixed], {
        encoding: "utf8",
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: DOCKER_TIMEOUT_MS,
      }),
    );
  } catch (cause: unknown) {
    return err(FreeDiskErrors.dockerCommandFailed({ argv, cause }));
  }
}

/** `docker-data`: the host file, the VM data mount's `df -k`, and `fstrim -n`'s line. */
function observeDockerData({ userHome }: { userHome: string }): Result<DockerDataObservation, FreeDiskError> {
  const raw = observePath({ path: freeDiskPaths({ userHome }).dockerRaw, walk: false });
  if (raw.isErr()) {
    return err(raw.error);
  }
  const dfArgv = dockerVmDfArgv();
  const dfText = runDocker({ argv: dfArgv });
  if (dfText.isErr()) {
    return err(dfText.error);
  }
  const vm = parseVmDataMount({ text: dfText.value });
  if (vm === undefined) {
    return err(
      FreeDiskErrors.dockerCommandFailed({
        argv: dfArgv,
        cause: new Error(`unrecognised df output: ${JSON.stringify(dfText.value)}`),
      }),
    );
  }
  const dryRun = runDocker({ argv: dockerTrimArgv({ dryRun: true }) });
  if (dryRun.isErr()) {
    return err(dryRun.error);
  }
  return ok({ kind: "docker-data", raw: raw.value, trimDryRunOutput: dryRun.value, vm });
}

/** `app`: the bundle, the Trash, the destination it would land at, and any process running from it. */
function observeApp({
  userHome,
  bundle,
  walk,
}: {
  userHome: string;
  bundle: string;
  walk: boolean;
}): Result<AppObservation, FreeDiskError> {
  const sourcePath = join(APPLICATIONS_ROOT, bundle);
  const trashPath = freeDiskPaths({ userHome }).trash;
  const observed = observeAll({
    entries: [
      { label: "source", path: sourcePath },
      { label: "trash", path: trashPath },
      { label: "destination", path: join(trashPath, bundle) },
    ],
    walk: false,
  });
  if (observed.isErr()) {
    return err(observed.error);
  }
  const [source, trash, destination] = observed.value;
  let sourceObserved = source!.observed;
  if (walk && sourceObserved.state === "present") {
    const walked = observePath({ path: sourcePath, walk: true });
    if (walked.isErr()) {
      return err(walked.error);
    }
    sourceObserved = walked.value;
  }
  let psText: string;
  try {
    psText = execFileSync("ps", ["-axo", "pid=,comm="], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: READ_TIMEOUT_MS,
    });
  } catch (cause: unknown) {
    return err(FreeDiskErrors.readFailed({ cause, path: "ps -axo pid=,comm=" }));
  }
  return ok({
    bundle,
    destination: destination!.observed,
    kind: "app",
    runningPids: pidsInsideBundle({ bundlePath: sourcePath, text: psText }),
    source: sourceObserved,
    trash: trash!.observed,
  });
}

/**
 * Read everything one target's plan needs.
 *
 * @param userHome the absolute user home every registry path is derived under
 * @param cwd the directory the process stands in, which names the main checkout
 * @param declaredMainCheckouts the canonical main checkouts `profile.json` declares; a copy beside any other is refused
 * @param actedOnly read only what an act touches — a recheck's read, which skips the kept rows' walks
 * @returns the observation, or the read that failed
 */
export function observeFreeDiskTarget({
  target,
  userHome,
  cwd,
  declaredMainCheckouts,
  actedOnly,
}: {
  target: FreeDiskTarget;
  userHome: string;
  cwd: string;
  declaredMainCheckouts: readonly string[];
  actedOnly: boolean;
}): Result<FreeDiskObservation, FreeDiskError> {
  switch (target.kind) {
    case "package-caches":
      return observePackageCaches({ actedOnly, userHome });
    case "docker-data":
      return observeDockerData({ userHome });
    case "before-setup-copy":
      return observeBeforeSetupCopy({ cwd, declaredMainCheckouts });
    case "app":
      // Walked on a recheck too: the outcome reports the recheck's figure, so an unwalked read would report 0.
      return observeApp({ bundle: target.bundle, userHome, walk: true });
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}
