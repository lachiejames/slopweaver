/**
 * `machine free-disk --apply`'s loop over injected seams: for each item that carries an act, read the target
 * again and re-plan it, act only when the fresh plan names the same act on the same device and inode, then read
 * what the item's path holds after. The first item that changed or failed stops the loop, carrying every outcome
 * that already happened. The seams are bound in `freeDisk.ts`; the two file system acts carry the plan's inode
 * down to `boundAct.ts`, which checks it again on the very object it moves.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { VolumeReading } from "../../../live/machine/diskFootprint.js";
import type { BundleRuling } from "../../../live/machine/freeDisk/bundleRuling.js";
import { type FreeDiskError, FreeDiskErrors } from "../../../live/machine/freeDisk/errors.js";
import { parseTrimmedBytes, planFreeDisk } from "../../../live/machine/freeDisk/plan.js";
import type { FreeDiskTarget } from "../../../live/machine/freeDisk/registry.js";
import type {
  FreeDiskAction,
  FreeDiskItemOutcome,
  FreeDiskObservation,
  FreeDiskPlan,
  FreeDiskPlanItem,
  PathIdentity,
} from "../../../live/machine/freeDisk/types.js";

/** Everything `machine free-disk` touches outside itself, injected so a test drives the whole verb. */
export interface MachineFreeDiskDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** Read one target; `actedOnly` is a recheck's read, which skips the kept rows' walks. */
  readonly observe: (input: {
    target: FreeDiskTarget;
    actedOnly: boolean;
  }) => Result<FreeDiskObservation, FreeDiskError>;
  /** The state home's ruling over which application bundles may go to the Trash. */
  readonly bundleRuling: () => Result<BundleRuling, FreeDiskError>;
  /** The state home volume's `df -k`, or `undefined` when it could not be read. */
  readonly volume: () => VolumeReading | undefined;
  /** Remove a tree only while it is still the object whose device and inode the plan captured. */
  readonly removeTree: (input: { path: string; identity: PathIdentity }) => Result<true, FreeDiskError>;
  /** Move a bundle into the Trash only while it is still the planned object. */
  readonly moveToTrash: (input: {
    source: string;
    destination: string;
    identity: PathIdentity;
  }) => Result<true, FreeDiskError>;
  readonly runDocker: (input: { argv: readonly string[] }) => Result<string, FreeDiskError>;
}

/** A failure part-way through an apply, carrying what already happened. */
interface ApplyStopped {
  readonly error: FreeDiskError;
  readonly outcomes: readonly FreeDiskItemOutcome[];
}

/**
 * Read the target and plan it, in one step, so a recheck is exactly the first read run again.
 *
 * @param actedOnly a recheck's read, which skips the kept rows' walks
 * @returns the plan, or the read or refusal that stopped it
 */
export function readPlan({
  deps,
  target,
  actedOnly,
}: {
  deps: MachineFreeDiskDeps;
  target: FreeDiskTarget;
  actedOnly: boolean;
}): Result<FreeDiskPlan, FreeDiskError> {
  const observed = deps.observe({ actedOnly, target });
  if (observed.isErr()) {
    return err(observed.error);
  }
  return planFreeDisk({ observation: observed.value });
}

/** Whether a fresh plan's action is the one the first plan captured: same kind, same path, same inode. */
function sameAction({ planned, fresh }: { planned: FreeDiskAction; fresh: FreeDiskAction | undefined }): boolean {
  if (fresh === undefined || fresh.kind !== planned.kind) {
    return false;
  }
  if (planned.kind === "docker-trim" && fresh.kind === "docker-trim") {
    return (
      planned.file === fresh.file &&
      planned.identity.dev === fresh.identity.dev &&
      planned.identity.ino === fresh.identity.ino &&
      planned.argv.join("\0") === fresh.argv.join("\0")
    );
  }
  if (planned.kind === "remove-tree" && fresh.kind === "remove-tree") {
    return (
      planned.path === fresh.path &&
      planned.identity.dev === fresh.identity.dev &&
      planned.identity.ino === fresh.identity.ino
    );
  }
  if (planned.kind === "move-to-trash" && fresh.kind === "move-to-trash") {
    return (
      planned.source === fresh.source &&
      planned.destination === fresh.destination &&
      planned.identity.dev === fresh.identity.dev &&
      planned.identity.ino === fresh.identity.ino
    );
  }
  return false;
}

/**
 * Re-read the target immediately before an act and refuse unless the item's action is unchanged. The fresh
 * item is what the outcome reports, so a file that gained a hard link since the plan is not counted as freed.
 */
function recheck({
  deps,
  target,
  item,
  action,
}: {
  deps: MachineFreeDiskDeps;
  target: FreeDiskTarget;
  item: FreeDiskPlanItem;
  action: FreeDiskAction;
}): Result<FreeDiskPlanItem, FreeDiskError> {
  const fresh = readPlan({ actedOnly: true, deps, target });
  if (fresh.isErr()) {
    return err(fresh.error);
  }
  const freshItem = fresh.value.items.find((candidate) => candidate.path === item.path);
  if (freshItem === undefined || !sameAction({ fresh: freshItem.action, planned: action })) {
    return err(FreeDiskErrors.planChanged({ path: item.path, what: "its fresh read no longer plans the same act" }));
  }
  return ok(freshItem);
}

/** Carry out one act. A trim returns the line `fstrim` printed; the other two return nothing to show. */
function act({
  deps,
  action,
}: {
  deps: MachineFreeDiskDeps;
  action: FreeDiskAction;
}): Result<string | undefined, FreeDiskError> {
  switch (action.kind) {
    case "remove-tree":
      return deps.removeTree({ identity: action.identity, path: action.path }).map(() => undefined);
    case "move-to-trash":
      return deps
        .moveToTrash({ destination: action.destination, identity: action.identity, source: action.source })
        .map(() => undefined);
    case "docker-trim":
      // A trim that ran is reported even when its line is unrecognised: `unrecognisedTrim` stops the run after.
      return deps.runDocker({ argv: action.argv }).map((printed) => printed.trim());
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/** A trim that ran but printed a line `fstrim` does not print, as the failure that stops the run after it. */
function unrecognisedTrim({
  action,
  detail,
}: {
  action: FreeDiskAction;
  detail: string | undefined;
}): FreeDiskError | undefined {
  if (action.kind !== "docker-trim") {
    return undefined;
  }
  // A trim that printed nothing at all is as unrecognised as one that printed something else.
  if (detail !== undefined && parseTrimmedBytes({ text: detail }) !== undefined) {
    return undefined;
  }
  return FreeDiskErrors.dockerCommandFailed({
    argv: action.argv,
    cause: new Error(`the trim ran but printed an unrecognised line: ${JSON.stringify(detail)}`),
  });
}

/** What the item's path holds after its act, read through the same planner: an absent path holds nothing. */
function allocatedAfter({
  deps,
  target,
  item,
}: {
  deps: MachineFreeDiskDeps;
  target: FreeDiskTarget;
  item: FreeDiskPlanItem;
}): Result<number, FreeDiskError> {
  const after = readPlan({ actedOnly: true, deps, target });
  if (after.isErr()) {
    return err(after.error);
  }
  const found = after.value.items.find((candidate) => candidate.path === item.path);
  if (found === undefined || found.disposition === "absent") {
    return ok(0);
  }
  return ok(found.allocatedBytes);
}

/**
 * One act's outcome on its own object; a Trash move frees nothing and moves its allocation. An after-read that
 * failed is `null`, never 0, so an act whose result was not read cannot pass for one that left nothing behind.
 */
function outcomeOf({
  item,
  action,
  allocatedAfterBytes,
  detail,
}: {
  item: FreeDiskPlanItem;
  action: FreeDiskAction;
  allocatedAfterBytes: number | null;
  detail: string | undefined;
}): FreeDiskItemOutcome {
  const base = { allocatedAfterBytes, allocatedBeforeBytes: item.allocatedBytes, detail, label: item.label };
  switch (action.kind) {
    case "remove-tree":
      // The plan's single-link bytes, never the tree's whole allocation: a hardlinked file frees nothing.
      return {
        ...base,
        freedBasis: "counted-at-recheck",
        freedBytes: item.expectedFreedBytes,
        movedBytes: 0,
        operation: action.kind,
      };
    case "move-to-trash":
      return {
        ...base,
        freedBasis: "none-until-trash-emptied",
        freedBytes: 0,
        movedBytes: item.allocatedBytes,
        operation: action.kind,
      };
    case "docker-trim":
      if (allocatedAfterBytes === null) {
        return { ...base, freedBasis: "after-read-failed", freedBytes: null, movedBytes: 0, operation: action.kind };
      }
      return {
        ...base,
        freedBasis: "measured-after",
        freedBytes: Math.max(0, item.allocatedBytes - allocatedAfterBytes),
        movedBytes: 0,
        operation: action.kind,
      };
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/**
 * Apply every item that carries an act, rechecking each first and stopping on the first failure.
 *
 * @returns every outcome, or the failure that stopped the loop with the outcomes before it
 */
export function applyPlan({
  deps,
  plan,
}: {
  deps: MachineFreeDiskDeps;
  plan: FreeDiskPlan;
}): Result<readonly FreeDiskItemOutcome[], ApplyStopped> {
  const outcomes: FreeDiskItemOutcome[] = [];
  for (const item of plan.items) {
    const action = item.action;
    if (action === undefined) {
      continue;
    }
    const checked = recheck({ action, deps, item, target: plan.target });
    if (checked.isErr()) {
      return err({ error: checked.error, outcomes });
    }
    const done = act({ action, deps });
    if (done.isErr()) {
      return err({ error: done.error, outcomes });
    }
    const stop = recordAct({ action, checked: checked.value, deps, detail: done.value, item, outcomes, plan });
    if (stop !== undefined) {
      return err({ error: stop, outcomes });
    }
  }
  return ok(outcomes);
}

/**
 * Record one act that has HAPPENED, before anything after it can stop the run: read what its object holds now,
 * push the outcome, then report a failed after-read or an unrecognised trim line as the stop.
 *
 * @param checked the item as its recheck read it, whose figures the outcome carries
 * @param outcomes the run's outcomes so far, appended to in place
 * @returns the failure that stops the run, or `undefined` to carry on
 */
function recordAct({
  action,
  checked,
  deps,
  detail,
  item,
  outcomes,
  plan,
}: {
  action: FreeDiskAction;
  checked: FreeDiskPlanItem;
  deps: MachineFreeDiskDeps;
  detail: string | undefined;
  item: FreeDiskPlanItem;
  outcomes: FreeDiskItemOutcome[];
  plan: FreeDiskPlan;
}): FreeDiskError | undefined {
  const after = allocatedAfter({ deps, item, target: plan.target });
  const allocatedAfterBytes = after.isOk() ? after.value : null;
  outcomes.push(outcomeOf({ action, allocatedAfterBytes, detail, item: checked }));
  if (after.isErr()) {
    return after.error;
  }
  return unrecognisedTrim({ action, detail });
}
