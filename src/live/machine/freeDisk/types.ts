/**
 * `machine free-disk`'s closed shapes: what the effectful shell read off the machine (an observation per
 * target), the plan the pure planner derives from it, and the outcome one apply reports. Three byte measures
 * stay separate on purpose: what a path HOLDS, what removing it would FREE (single-link files only — a
 * hardlinked file frees nothing when one link goes), and the whole volume's `df` before and after, which other
 * writers move too and is never attributed to one item.
 */
import type { VolumeReading } from "../diskFootprint.js";

import type { FreeDiskTarget } from "./registry.js";

/** The device and inode a plan captured, compared again immediately before its act. */
export interface PathIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** What `lstat` said one path is. */
export type EntryKind = "directory" | "regular file" | "symlink" | "other";

/** What a walk of one present tree measured, following no symlink. */
export interface TreeUsage {
  /** Every regular file's `st_blocks × 512`. */
  readonly allocatedBytes: number;
  /** Only the single-link files' allocation: what removing the tree frees. */
  readonly freeableBytes: number;
  readonly singleLinkFiles: number;
  readonly multiLinkFiles: number;
}

/** One path as the shell found it: absent, or present with its kind, real location, identity and usage. */
export type PathObservation =
  | { readonly state: "absent"; readonly path: string }
  | {
      readonly state: "present";
      readonly path: string;
      readonly kind: EntryKind;
      /** `realpath`, so a path that resolves elsewhere is visible; equal to `path` when nothing redirects it. */
      readonly realPath: string;
      readonly identity: PathIdentity;
      readonly usage: TreeUsage;
    };

/** One named path in an observation. */
export interface LabelledPath {
  readonly label: string;
  readonly observed: PathObservation;
}

/** `package-caches`: the four clearable caches, the two the owner kept, and every child of Slopweaver's cache. */
export interface PackageCachesObservation {
  readonly kind: "package-caches";
  readonly clearable: readonly LabelledPath[];
  readonly kept: readonly LabelledPath[];
  readonly slopweaverChildren: readonly LabelledPath[];
}

/** The VM data mount's own `df -k` numbers. */
export interface VmDataMount {
  readonly totalKib: number;
  readonly usedKib: number;
}

/** `docker-data`: the host data file, the VM's own usage, and what `fstrim -n` printed. */
export interface DockerDataObservation {
  readonly kind: "docker-data";
  readonly raw: PathObservation;
  readonly vm: VmDataMount;
  readonly trimDryRunOutput: string;
}

/**
 * `before-setup-copy`: whether the standing directory's main checkout is a declared one, and — only when it is —
 * the copy beside it and the git checks run over it.
 */
export type BeforeSetupCopyObservation =
  | { readonly kind: "before-setup-copy"; readonly checkout: "unproven" }
  | { readonly kind: "before-setup-copy"; readonly checkout: "undeclared"; readonly mainCheckout: string }
  | {
      readonly kind: "before-setup-copy";
      readonly checkout: "declared";
      readonly mainCheckout: string;
      readonly copy: PathObservation;
      /** How many `.git` entries, of any type, sit anywhere inside the copy. */
      readonly gitEntries: number;
      /** Whether `git rev-parse --show-toplevel` succeeded inside the copy. */
      readonly insideGitRepository: boolean;
    };

/** `app`: the bundle, the Trash, the destination it would land at, and any process running from it. */
export interface AppObservation {
  readonly kind: "app";
  readonly bundle: string;
  readonly source: PathObservation;
  readonly trash: PathObservation;
  readonly destination: PathObservation;
  readonly runningPids: readonly number[];
}

/** Everything the shell read for one target. */
export type FreeDiskObservation =
  PackageCachesObservation | DockerDataObservation | BeforeSetupCopyObservation | AppObservation;

/** The one act a plan item carries out. */
export type FreeDiskAction =
  | { readonly kind: "remove-tree"; readonly path: string; readonly identity: PathIdentity }
  | {
      readonly kind: "docker-trim";
      readonly file: string;
      readonly identity: PathIdentity;
      readonly argv: readonly string[];
    }
  | {
      readonly kind: "move-to-trash";
      readonly source: string;
      readonly destination: string;
      readonly identity: PathIdentity;
    };

/** What a plan does with one path. */
type FreeDiskDisposition = "remove" | "trim" | "trash" | "keep" | "absent";

/** One line of a plan. */
export interface FreeDiskPlanItem {
  readonly label: string;
  readonly path: string;
  readonly allocatedBytes: number;
  /** What the act is expected to free: single-link bytes for a removal, an upper bound for a trim, 0 for a move. */
  readonly expectedFreedBytes: number;
  readonly disposition: FreeDiskDisposition;
  readonly reason: string;
  readonly action: FreeDiskAction | undefined;
}

/** The whole plan for one target. */
export interface FreeDiskPlan {
  readonly target: FreeDiskTarget;
  readonly items: readonly FreeDiskPlanItem[];
}

/**
 * What one act did to its own object. Only a trim's figure is measured after the act; a removal's is counted
 * from the tree's single-link files at the recheck just before it, and a Trash move frees nothing yet.
 */
export interface FreeDiskItemOutcome {
  readonly label: string;
  readonly operation: FreeDiskAction["kind"];
  readonly allocatedBeforeBytes: number;
  /** What the path holds after the act; `null` when the read after it failed, which stops the run next. */
  readonly allocatedAfterBytes: number | null;
  /**
   * Blocks freed: counted at the recheck for a removal, measured after for a trim, 0 for a Trash move; `null`
   * for a trim whose after-read failed, since nothing was measured.
   */
  readonly freedBytes: number | null;
  /** How `freedBytes` was arrived at, so a reader never takes a count for a measurement. */
  readonly freedBasis: FreedBasis;
  /** Blocks moved rather than freed: a Trash move's allocation, which lands only once the Trash is emptied. */
  readonly movedBytes: number;
  /** What the act itself printed, when it printed anything (the trim's own line). */
  readonly detail: string | undefined;
}

/** How an outcome's freed figure was arrived at. */
export type FreedBasis = "counted-at-recheck" | "measured-after" | "none-until-trash-emptied" | "after-read-failed";

/** Why an apply stopped before its last item: the refusal's code and message. */
interface FreeDiskStop {
  readonly code: string;
  readonly message: string;
}

/** One run's document: the plan, whether it applied, every outcome, the volume either side, and any stop. */
export interface FreeDiskReport {
  readonly schemaVersion: 1;
  readonly plan: FreeDiskPlan;
  readonly applied: boolean;
  readonly volumeBefore: VolumeReading;
  readonly volumeAfter: VolumeReading | undefined;
  readonly outcomes: readonly FreeDiskItemOutcome[];
  /** The failure that stopped an apply partway; the outcomes before it still stand. */
  readonly stopped: FreeDiskStop | undefined;
}
