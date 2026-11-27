/**
 * `machine free-disk`'s pure planner: an observation in, the plan out, or the one safety check it failed.
 * Every refusal a read of the machine can trigger is decided HERE, so the shell's recheck immediately before an
 * act is simply this planner run again over a fresh observation — there is no second copy of the checks to
 * drift. Pure: no filesystem, no subprocess, no clock.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type FreeDiskError, FreeDiskErrors } from "./errors.js";
import {
  APPLICATIONS_ROOT,
  beforeSetupCopyPath,
  DOCKER_VM_DATA_MOUNT,
  dockerTrimArgv,
  PROTECTED_TARGETS,
  SLOPWEAVER_CACHE_KEPT,
  UNKNOWN_SLOPWEAVER_CACHE_CHILD,
} from "./registry.js";
import type {
  AppObservation,
  BeforeSetupCopyObservation,
  DockerDataObservation,
  FreeDiskObservation,
  FreeDiskPlan,
  FreeDiskPlanItem,
  LabelledPath,
  PackageCachesObservation,
  PathObservation,
  VmDataMount,
} from "./types.js";

/** A present path, narrowed. */
type PresentPath = Extract<PathObservation, { state: "present" }>;

/**
 * Check a present path is exactly what the registry named: not a link, the expected kind, and resolving to itself.
 *
 * @param expected the kind the registry names for this path
 * @returns the path, narrowed, or the check it failed
 */
function exactly({
  observed,
  expected,
}: {
  observed: PresentPath;
  expected: "directory" | "regular file";
}): Result<PresentPath, FreeDiskError> {
  if (observed.kind === "symlink") {
    return err(FreeDiskErrors.symlinkRefused({ path: observed.path }));
  }
  if (observed.kind !== expected) {
    return err(FreeDiskErrors.wrongKind({ expected, path: observed.path }));
  }
  if (observed.realPath !== observed.path) {
    return err(FreeDiskErrors.pathOutsideExpectedRoot({ path: observed.path, realPath: observed.realPath }));
  }
  return ok(observed);
}

/** The row for a path that is not there: nothing to do and nothing to free. */
function absentItem({ label, path }: { label: string; path: string }): FreeDiskPlanItem {
  return {
    action: undefined,
    allocatedBytes: 0,
    disposition: "absent",
    expectedFreedBytes: 0,
    label,
    path,
    reason: "not on this machine",
  };
}

/** The row for a path the verb reports and never touches. */
function keptItem({ entry, reason }: { entry: LabelledPath; reason: string }): FreeDiskPlanItem {
  if (entry.observed.state === "absent") {
    return absentItem({ label: entry.label, path: entry.observed.path });
  }
  return {
    action: undefined,
    allocatedBytes: entry.observed.usage.allocatedBytes,
    disposition: "keep",
    expectedFreedBytes: 0,
    label: entry.label,
    path: entry.observed.path,
    reason,
  };
}

/** The reason one child of Slopweaver's cache root stays, by its directory name. */
function slopweaverChildReason({ label }: { label: string }): string {
  if (Object.hasOwn(SLOPWEAVER_CACHE_KEPT, label)) {
    return SLOPWEAVER_CACHE_KEPT[label]!;
  }
  return UNKNOWN_SLOPWEAVER_CACHE_CHILD;
}

/** The reason a kept package cache stays: npm's and Yarn's own protected-target reasons. */
function keptCacheReason({ label }: { label: string }): string {
  const key = label.toLowerCase();
  if (Object.hasOwn(PROTECTED_TARGETS, key)) {
    return PROTECTED_TARGETS[key]!;
  }
  return "the owner ruled it kept";
}

/** `package-caches`: remove each of the four clearable caches present, and report every kept one beside them. */
function planPackageCaches({
  observation,
}: {
  observation: PackageCachesObservation;
}): Result<FreeDiskPlan, FreeDiskError> {
  const items: FreeDiskPlanItem[] = [];
  for (const entry of observation.clearable) {
    if (entry.observed.state === "absent") {
      items.push(absentItem({ label: entry.label, path: entry.observed.path }));
      continue;
    }
    const checked = exactly({ expected: "directory", observed: entry.observed });
    if (checked.isErr()) {
      return err(checked.error);
    }
    items.push({
      action: { identity: checked.value.identity, kind: "remove-tree", path: checked.value.path },
      allocatedBytes: checked.value.usage.allocatedBytes,
      disposition: "remove",
      expectedFreedBytes: checked.value.usage.freeableBytes,
      label: entry.label,
      path: checked.value.path,
      reason: "a rebuildable cache the owner ruled clearable; the tool refills it on its next install",
    });
  }
  for (const entry of observation.kept) {
    items.push(keptItem({ entry, reason: keptCacheReason({ label: entry.label }) }));
  }
  for (const entry of observation.slopweaverChildren) {
    items.push(keptItem({ entry, reason: slopweaverChildReason({ label: entry.label }) }));
  }
  return ok({ items, target: { kind: "package-caches" } });
}

/** `fstrim -n -v <mount>`'s one line: `/var/lib: 0 B (dry run) trimmed`. */
const TRIM_DRY_RUN_LINE = new RegExp(`^${DOCKER_VM_DATA_MOUNT}: .+ \\(dry run\\) trimmed`, "u");

/** `fstrim -v <mount>`'s one line: `/var/lib: 1.7 GiB (1825361920 bytes) trimmed [on /dev/vda1]`. */
const TRIM_APPLIED_LINE = new RegExp(`^${DOCKER_VM_DATA_MOUNT}: .+ \\((\\d+) bytes\\) trimmed`, "u");

/**
 * The byte count an applied `fstrim -v` reported, or `undefined` when its output is not that line.
 *
 * @param text the trim's stdout
 * @returns the bytes it trimmed
 */
export function parseTrimmedBytes({ text }: { text: string }): number | undefined {
  const match = TRIM_APPLIED_LINE.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  return Number(match[1]);
}

/**
 * Parse the VM data mount's `df -k` (Linux columns: filesystem, 1K-blocks, used, available, use%, mount),
 * reading the row whose mount is {@link DOCKER_VM_DATA_MOUNT} and refusing anything else.
 *
 * @param text the in-VM `df -k` stdout
 * @returns the mount's total and used KiB, or `undefined` when the row is not there
 */
export function parseVmDataMount({ text }: { text: string }): VmDataMount | undefined {
  const row = text
    .split("\n")
    .map((line) => line.trim().split(/\s+/u))
    .find((columns) => columns.at(-1) === DOCKER_VM_DATA_MOUNT);
  if (row === undefined) {
    return undefined;
  }
  const totalKib = Number(row[1]);
  const usedKib = Number(row[2]);
  if (!Number.isInteger(totalKib) || !Number.isInteger(usedKib) || totalKib <= 0 || usedKib < 0) {
    return undefined;
  }
  return { totalKib, usedKib };
}

/**
 * `docker-data`: trim the VM's data mount. What it can free is at most the host file's allocation less what the
 * VM's filesystem really uses — an upper bound, since the VM's own metadata is not in `df`'s used figure.
 */
function planDockerData({ observation }: { observation: DockerDataObservation }): Result<FreeDiskPlan, FreeDiskError> {
  if (observation.raw.state === "absent") {
    return ok({
      items: [absentItem({ label: "Docker.raw", path: observation.raw.path })],
      target: { kind: "docker-data" },
    });
  }
  const checked = exactly({ expected: "regular file", observed: observation.raw });
  if (checked.isErr()) {
    return err(checked.error);
  }
  if (checked.value.usage.multiLinkFiles > 0) {
    return err(FreeDiskErrors.hardlinkedFile({ path: checked.value.path }));
  }
  const dryArgv = dockerTrimArgv({ dryRun: true });
  if (!TRIM_DRY_RUN_LINE.test(observation.trimDryRunOutput.trim())) {
    return err(
      FreeDiskErrors.dockerCommandFailed({
        argv: dryArgv,
        cause: new Error(`unrecognised dry-run output: ${JSON.stringify(observation.trimDryRunOutput)}`),
      }),
    );
  }
  const allocatedBytes = checked.value.usage.allocatedBytes;
  const vmUsedBytes = observation.vm.usedKib * 1024;
  return ok({
    items: [
      {
        action: {
          argv: dockerTrimArgv({ dryRun: false }),
          file: checked.value.path,
          identity: checked.value.identity,
          kind: "docker-trim",
        },
        allocatedBytes,
        disposition: "trim",
        expectedFreedBytes: Math.max(0, allocatedBytes - vmUsedBytes),
        label: "Docker.raw",
        path: checked.value.path,
        reason: `the VM's ${DOCKER_VM_DATA_MOUNT} uses ${String(vmUsedBytes)} bytes of it; TRIM hands the rest back, deleting nothing`,
      },
    ],
    target: { kind: "docker-data" },
  });
}

/** `before-setup-copy`: remove the main checkout's `.before-setup` sibling, once it is proven not a repository. */
function planBeforeSetupCopy({
  observation,
}: {
  observation: BeforeSetupCopyObservation;
}): Result<FreeDiskPlan, FreeDiskError> {
  if (observation.checkout === "unproven") {
    return err(FreeDiskErrors.mainCheckoutUnproven());
  }
  if (observation.checkout === "undeclared") {
    return err(FreeDiskErrors.mainCheckoutUndeclared({ mainCheckout: observation.mainCheckout }));
  }
  const expectedPath = beforeSetupCopyPath({ mainCheckout: observation.mainCheckout });
  if (observation.copy.path !== expectedPath) {
    return err(FreeDiskErrors.pathOutsideExpectedRoot({ path: expectedPath, realPath: observation.copy.path }));
  }
  const target = { kind: "before-setup-copy" } as const;
  if (observation.copy.state === "absent") {
    return ok({ items: [absentItem({ label: "pre-setup copy", path: expectedPath })], target });
  }
  const checked = exactly({ expected: "directory", observed: observation.copy });
  if (checked.isErr()) {
    return err(checked.error);
  }
  if (observation.gitEntries > 0 || observation.insideGitRepository) {
    return err(FreeDiskErrors.gitRepositoryRefused({ path: expectedPath }));
  }
  return ok({
    items: [
      {
        action: { identity: checked.value.identity, kind: "remove-tree", path: expectedPath },
        allocatedBytes: checked.value.usage.allocatedBytes,
        disposition: "remove",
        expectedFreedBytes: checked.value.usage.freeableBytes,
        label: "pre-setup copy",
        path: expectedPath,
        reason:
          "the old copy of the checkout from before setup; not a git repository, and the owner ruled it deletable",
      },
    ],
    target,
  });
}

/** `app`: move the bundle to the Trash on its own volume — recoverable, and freeing nothing until it is emptied. */
function planApp({ observation }: { observation: AppObservation }): Result<FreeDiskPlan, FreeDiskError> {
  const target = { bundle: observation.bundle, kind: "app" } as const;
  const expectedSource = join(APPLICATIONS_ROOT, observation.bundle);
  if (observation.source.path !== expectedSource) {
    return err(FreeDiskErrors.pathOutsideExpectedRoot({ path: expectedSource, realPath: observation.source.path }));
  }
  if (observation.source.state === "absent") {
    return ok({ items: [absentItem({ label: observation.bundle, path: expectedSource })], target });
  }
  const source = exactly({ expected: "directory", observed: observation.source });
  if (source.isErr()) {
    return err(source.error);
  }
  if (observation.runningPids.length > 0) {
    return err(FreeDiskErrors.appRunning({ bundle: observation.bundle, pids: observation.runningPids }));
  }
  if (observation.trash.state === "absent") {
    return err(FreeDiskErrors.wrongKind({ expected: "directory", path: observation.trash.path }));
  }
  const trash = exactly({ expected: "directory", observed: observation.trash });
  if (trash.isErr()) {
    return err(trash.error);
  }
  const destination = join(trash.value.path, observation.bundle);
  if (observation.destination.path !== destination) {
    return err(FreeDiskErrors.pathOutsideExpectedRoot({ path: destination, realPath: observation.destination.path }));
  }
  if (observation.destination.state === "present") {
    return err(FreeDiskErrors.trashCollision({ destination }));
  }
  if (source.value.identity.dev !== trash.value.identity.dev) {
    return err(FreeDiskErrors.trashVolumeMismatch({ source: expectedSource }));
  }
  return ok({
    items: [
      {
        action: { destination, identity: source.value.identity, kind: "move-to-trash", source: expectedSource },
        allocatedBytes: source.value.usage.allocatedBytes,
        disposition: "trash",
        expectedFreedBytes: 0,
        label: observation.bundle,
        path: expectedSource,
        reason:
          "the owner does not use it at the moment; moved, not deleted, so it frees its space once the Trash is emptied",
      },
    ],
    target,
  });
}

/**
 * Derive the plan for one observation, or the safety check it failed.
 *
 * @param observation what the shell read off the machine for one target
 * @returns the plan, or the typed refusal
 */
export function planFreeDisk({
  observation,
}: {
  observation: FreeDiskObservation;
}): Result<FreeDiskPlan, FreeDiskError> {
  switch (observation.kind) {
    case "package-caches":
      return planPackageCaches({ observation });
    case "docker-data":
      return planDockerData({ observation });
    case "before-setup-copy":
      return planBeforeSetupCopy({ observation });
    case "app":
      return planApp({ observation });
    default: {
      const unreachable: never = observation;
      return unreachable;
    }
  }
}
