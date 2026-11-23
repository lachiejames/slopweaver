/**
 * One bulk delete, governed from inside by fseventsd's CPU.
 *
 * A brake between trees cannot stop the first tree: one paced `rm` of one reclaim-trash tree
 * drove fseventsd to 23-47% by itself. So the tree is deleted in quanta, each
 * one `rm` of at most {@link QUANTUM_ENTRIES} entries COUNTED TO THE LAST FILE, and fseventsd is read before every
 * quantum. A count, not a number of paths, because one path can name a subtree of any size.
 * At the upper bar the delete holds, re-reading every {@link HOLD_POLL_MS}, and resumes under the lower one
 * (`./fseventsdGauge.ts`) — so the delete runs at the rate fseventsd drains, never faster. A deadline bounds the
 * whole of it, the holds included; what is left is a smaller directory for the next pass. One lease serialises every
 * governed delete on the machine, read and `rm` together, so a prune, a `close-done` and a mirror prune running at
 * once release one quantum per quiet read between them, never one each. Without the lease each
 * delete is held to {@link UNLEASED_GAP_MS} per quantum instead (`./deleteLease.ts`).
 *
 * The walk is lazy: a subtree is counted, capped one past the quantum, only when the walk reaches it, and a quantum
 * is removed as soon as it fills, so a tree of millions is never listed whole before the first `rm`.
 *
 * Pure orchestration over seams, so a test drives the exact sequence of reads, holds and removes with plain fakes.
 */
import type { DeleteLease } from "./deleteLease.js";
import { type FseventsdCpu, governorHolds } from "./fseventsdGauge.js";

/** Entries a tree may hold in all and still go in one `rm -rf`, counted without the lazy walk. */
const SMALL_TREE_ENTRIES = 64;

/**
 * The most entries one `rm` removes, counted to the last file. The live proof's quanta averaged about 940 entries
 * and fseventsd peaked at 7.8% over 30,000 files (32 reads, no hold), so a quantum this size
 * is measured not to storm by itself.
 */
export const QUANTUM_ENTRIES = 1_000;

/** The most paths one `rm` is handed, so a quantum of single files never meets the argument-length limit. */
const MAX_QUANTUM_PATHS = 512;

/** How long a held delete waits before it reads fseventsd again. */
export const HOLD_POLL_MS = 2_000;

/**
 * The whole pause before each quantum removed WITHOUT the lease, so a delete nothing serialises starts at most one
 * quantum of at most 1,000 COUNTED entries per this interval, never sooner — its first included — and so averages at
 * most 500 counted entries a second over any run. Counted, because a writer adding to a subtree between its count and
 * its `rm -rf` is deleted with it; every tree governed here is one nothing should still be writing. That is a bound
 * on each cleanup, not on several together: N at once can each release one quantum in the same instant. The live proof ran one leased delete at about 1,550 a second (62,500 files
 * in 40.3s, fseventsd peaking at 16.8%).
 */
const UNLEASED_GAP_MS = 2_000;

/** One directory entry, as the walk needs it. */
interface DeleteEntry {
  readonly path: string;
  readonly isDirectory: boolean;
}

/** What one directory listing found: its entries, or that it could not be read at all. */
export type DirListing =
  { readonly kind: "listed"; readonly entries: readonly DeleteEntry[] } | { readonly kind: "unlistable" };

/**
 * One path a quantum removes, how many entries removing it deletes, itself included, and whether it is a counted
 * subtree removed whole or a single entry: a file, or a directory the walk opened and so expects to find empty.
 */
interface DeleteUnit {
  readonly path: string;
  readonly entries: number;
  readonly whole: boolean;
}

/** The effects one governed delete makes, each a plain function a test fakes. */
export interface DeleteSeams {
  /** The entries directly inside a directory, or that it could not be read. */
  readonly list: (input: { dir: string }) => DirListing;
  /** Give a directory its owner's read, write and search bits, so its entries can be listed and removed. */
  readonly unlock: (input: { dir: string }) => void;
  /**
   * Remove one quantum at background priority, cut short at the deadline: each counted subtree in `trees`
   * recursively, then each of `leaves` only if it is a file or an EMPTY directory, so an opened directory something
   * earlier failed to empty is left rather than removed with whatever it still holds. Answers
   * `deadline` when the deadline stopped any `rm` it needed from starting.
   */
  readonly remove: (input: {
    trees: readonly string[];
    leaves: readonly string[];
    deadline: number;
  }) => "go" | "deadline";
  /**
   * Try once for the one lease every bulk delete on this machine shares (`./deleteLease.ts`). Held from the fseventsd
   * read through the `rm`, so two cleanups can never both act on one quiet read.
   */
  readonly claim: () => DeleteLease;
  /** fseventsd's CPU now, read within the time the delete has left. */
  readonly gauge: (input: { remainingMs: number }) => FseventsdCpu;
  /** Block for this long. */
  readonly sleep: (input: { ms: number }) => void;
  /** The clock, in epoch milliseconds. */
  readonly now: () => number;
}

/** How a governed delete ended. */
export type GovernedEnd = "deleted" | "incomplete" | "deadline" | "unreadable";

/**
 * List one directory, unlocking it first on a retry.
 *
 * @param dir the directory to list
 * @param seams the listing and the unlock
 * @param unlocking whether to unlock it before listing it
 * @returns its listing
 */
function listDir({
  dir,
  seams,
  unlocking,
}: {
  dir: string;
  seams: Pick<DeleteSeams, "list" | "unlock">;
  unlocking: boolean;
}): DirListing {
  if (unlocking) {
    seams.unlock({ dir });
  }
  return seams.list({ dir });
}

/**
 * How many entries a directory holds below it, or `over` once that passes `cap` or a directory in it cannot be
 * listed — an unreadable directory says nothing about how much it holds.
 *
 * @param dir the directory to count
 * @param cap the count past which the exact number no longer matters
 * @param seams the listing, and the unlock a retry makes before each listing
 * @param unlocking whether to unlock every directory before listing it
 * @returns the count, or `over`
 */
export function countEntriesUpTo({
  dir,
  cap,
  seams,
  unlocking,
}: {
  dir: string;
  cap: number;
  seams: Pick<DeleteSeams, "list" | "unlock">;
  unlocking: boolean;
}): number | "over" {
  let count = 0;
  const pending = [dir];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const listing = listDir({ dir: next, seams, unlocking });
    if (listing.kind === "unlistable") {
      return "over";
    }
    for (const entry of listing.entries) {
      count += 1;
      if (count > cap) {
        return "over";
      }
      if (entry.isDirectory) {
        pending.push(entry.path);
      }
    }
  }
  return count;
}

/**
 * The units a directory's CONTENTS are removed by, deepest first: a file is one entry, a subtree that fits in a
 * quantum, itself included, is one unit of its whole count, and a bigger one is opened and followed by itself, by
 * then empty. A directory that cannot be listed is never a unit, and neither is any directory above it: its size is
 * unknown, and an `rm -rf` of it could remove any number of entries in one go.
 *
 * @param dir the directory whose contents to walk
 * @param seams the listing and the unlock
 * @param unlocking whether to unlock every directory before listing it
 * @yields each unit, in the order they must be removed
 * @returns `incomplete` when anything beneath `dir`, or `dir` itself, could not be listed, so `dir` must stay
 */
function* contentUnits({
  dir,
  seams,
  unlocking,
}: {
  dir: string;
  seams: Pick<DeleteSeams, "list" | "unlock">;
  unlocking: boolean;
}): Generator<DeleteUnit, "complete" | "incomplete"> {
  const listing = listDir({ dir, seams, unlocking });
  if (listing.kind === "unlistable") {
    return "incomplete";
  }
  let complete = true;
  for (const entry of listing.entries) {
    if (!entry.isDirectory) {
      yield { entries: 1, path: entry.path, whole: false };
      continue;
    }
    const size = countEntriesUpTo({ cap: QUANTUM_ENTRIES - 1, dir: entry.path, seams, unlocking });
    if (size !== "over") {
      yield { entries: size + 1, path: entry.path, whole: true };
      continue;
    }
    if ((yield* contentUnits({ dir: entry.path, seams, unlocking })) === "incomplete") {
      complete = false;
      continue;
    }
    yield { entries: 1, path: entry.path, whole: false };
  }
  return complete ? "complete" : "incomplete";
}

/** Whether a hold is in force, carried from one quantum to the next. */
interface Governor {
  holding: boolean;
}

/**
 * Wait until fseventsd lets the next quantum go, or the deadline passes, or it cannot be read.
 *
 * @param seams the gauge, the sleep and the clock
 * @param deadline the epoch millisecond the whole delete must end by
 * @param governor the hold state, carried across quanta
 * @returns `go`, or why the delete must end here
 */
function awaitGovernor({
  seams,
  deadline,
  governor,
}: {
  seams: DeleteSeams;
  deadline: number;
  governor: Governor;
}): "go" | "deadline" | "unreadable" {
  for (;;) {
    if (seams.now() >= deadline) {
      return "deadline";
    }
    const reading = seams.gauge({ remainingMs: deadline - seams.now() });
    if (reading.kind === "unreadable") {
      return "unreadable";
    }
    const cpu = reading.kind === "read" ? reading.cpu : 0;
    governor.holding = governorHolds({ cpu, holding: governor.holding });
    if (!governor.holding) {
      return "go";
    }
    seams.sleep({ ms: Math.min(HOLD_POLL_MS, deadline - seams.now()) });
  }
}

/**
 * Wait for the machine's delete lease inside the deadline. An `unavailable` lease — a full disk, say — must not stop
 * the delete that would free it: fseventsd still governs, and a WHOLE pause before each quantum caps the rate no other
 * delete is serialised against (`./deleteLease.ts`). One that no longer fits before the deadline ends the delete
 * rather than shortening the pause.
 *
 * @param seams the claim, the sleep and the clock
 * @param deadline the epoch millisecond the whole delete must end by
 * @returns the release to call once the quantum is done (a no-op when the lease could not be taken), or `deadline`
 */
function takeLease({ seams, deadline }: { seams: DeleteSeams; deadline: number }): (() => void) | "deadline" {
  for (;;) {
    if (seams.now() >= deadline) {
      return "deadline";
    }
    const lease = seams.claim();
    if (lease.kind === "held") {
      return lease.release;
    }
    if (lease.kind === "busy") {
      seams.sleep({ ms: Math.min(HOLD_POLL_MS, deadline - seams.now()) });
      continue;
    }
    if (deadline - seams.now() < UNLEASED_GAP_MS) {
      return "deadline";
    }
    seams.sleep({ ms: UNLEASED_GAP_MS });
    return (): void => {};
  }
}

/**
 * Remove one quantum under the machine's delete lease: wait for the lease, then for fseventsd, then `rm`, all inside
 * the deadline. The lease is held through the read and the `rm` together, so no other governed delete reads the
 * same quiet fseventsd and releases a quantum beside this one.
 *
 * @param quantum the units to remove
 * @param seams the effects
 * @param deadline the epoch millisecond the whole delete must end by
 * @param governor the hold state, carried across quanta
 * @returns `go` once every `rm` of the quantum ran, or why the delete must end here
 */
function leasedRemove({
  quantum,
  seams,
  deadline,
  governor,
}: {
  quantum: readonly DeleteUnit[];
  seams: DeleteSeams;
  deadline: number;
  governor: Governor;
}): "go" | "deadline" | "unreadable" {
  const release = takeLease({ deadline, seams });
  if (release === "deadline") {
    return "deadline";
  }
  try {
    const gate = awaitGovernor({ deadline, governor, seams });
    if (gate !== "go") {
      return gate;
    }
    // The read itself takes time, so the deadline is asked again at the last instant before `rm`.
    if (seams.now() >= deadline) {
      return "deadline";
    }
    // A quantum the deadline cut short is not deleted, so the delete ends `deadline`.
    return seams.remove({
      deadline,
      leaves: quantum.filter((unit) => !unit.whole).map((unit) => unit.path),
      trees: quantum.filter((unit) => unit.whole).map((unit) => unit.path),
    });
  } finally {
    release();
  }
}

/**
 * Start one quantum's `rm`s, each only while the deadline has not passed: the counted subtrees whole, then the leaves
 * with `-d`, which removes a file or an EMPTY directory and refuses one still holding anything. The deadline is asked
 * again before the second, because the first may have spent it. Each `rm` is handed the time
 * left at the one clock read that admitted it, as its timeout, so the launcher never re-reads the clock and stretches
 * an expired budget into a positive one. That read is the last decision user space can make:
 * the child's own start is the OS's, after it. An `rm` its timeout killed left the quantum part-deleted, so it ends
 * the delete as `deadline` too.
 *
 * @param now the clock, in epoch milliseconds
 * @param run runs one `rm` with these arguments, killed after `timeoutMs`, and says whether that timeout killed it
 * @returns `go` when every `rm` the quantum needs ran to its end, `deadline` when one did not start or was killed
 */
export function removeBeforeDeadline({
  trees,
  leaves,
  deadline,
  now,
  run,
}: {
  trees: readonly string[];
  leaves: readonly string[];
  deadline: number;
  now: () => number;
  run: (input: { argv: readonly string[]; timeoutMs: number }) => "finished" | "timed-out";
}): "go" | "deadline" {
  const halves = [
    { flag: "-rf", paths: trees },
    { flag: "-fd", paths: leaves },
  ].filter((half) => half.paths.length > 0);
  for (const { flag, paths } of halves) {
    const timeoutMs = deadline - now();
    if (timeoutMs <= 0 || run({ argv: ["rm", flag, ...paths], timeoutMs }) === "timed-out") {
      return "deadline";
    }
  }
  return "go";
}

/**
 * Delete a tree quantum by quantum, holding before each quantum while fseventsd is hot. A tree of at most
 * {@link SMALL_TREE_ENTRIES} entries in all goes in one `rm -rf` as a single quantum, under the lease and one read
 * like any other; one with a directory that cannot be listed is never taken for small.
 *
 * @param dir the tree to delete
 * @param deadline the epoch millisecond the whole delete must end by, holds included
 * @param seams the effects
 * @param unlocking whether to unlock every directory before listing it — the retry after a read-only directory
 *   refused `rm` its entries, governed like the first pass rather than a `chmod -R` of the whole residue
 * @returns `deleted` once every quantum and the tree itself were removed, `incomplete` when a directory that could
 *   not be listed kept the tree and every directory above it, else what ended it early
 */
export function governedDelete({
  dir,
  deadline,
  seams,
  unlocking,
}: {
  dir: string;
  deadline: number;
  seams: DeleteSeams;
  unlocking: boolean;
}): GovernedEnd {
  const small = countEntriesUpTo({ cap: SMALL_TREE_ENTRIES, dir, seams, unlocking });
  if (small !== "over") {
    // One quantum, still under the lease and one read: small is no licence to run beside a leased `git worktree
    // remove`, nor for many small deletes at once to skip the gauge.
    const gate = leasedRemove({
      deadline,
      governor: { holding: false },
      quantum: [{ entries: small, path: dir, whole: true }],
      seams,
    });
    return gate === "go" ? "deleted" : gate;
  }
  const batch = quantumBatcher({ deadline, seams });
  const walk = contentUnits({ dir, seams, unlocking });
  let step = walk.next();
  for (; step.done !== true; step = walk.next()) {
    const gate = batch.add({ unit: step.value });
    if (gate !== "go") {
      return gate;
    }
  }
  const complete = step.value === "complete";
  const gate = batch.finish({ last: complete ? [{ entries: 1, path: dir, whole: false }] : [] });
  if (gate !== "go") {
    return gate;
  }
  return complete ? "deleted" : "incomplete";
}

/**
 * Gathers units into quanta of at most {@link QUANTUM_ENTRIES} entries and {@link MAX_QUANTUM_PATHS} paths, removing
 * each under the lease as it fills, with one hold state carried across them all.
 *
 * @param deadline the epoch millisecond the whole delete must end by
 * @param seams the effects
 * @returns `add` for the next unit, and `finish` to add the last units and remove what is left
 */
function quantumBatcher({ deadline, seams }: { deadline: number; seams: DeleteSeams }): {
  add: (input: { unit: DeleteUnit }) => "go" | "deadline" | "unreadable";
  finish: (input: { last: readonly DeleteUnit[] }) => "go" | "deadline" | "unreadable";
} {
  const governor: Governor = { holding: false };
  let quantum: DeleteUnit[] = [];
  let weight = 0;
  const flush = (): "go" | "deadline" | "unreadable" => {
    if (quantum.length === 0) {
      return "go";
    }
    const gate = leasedRemove({ deadline, governor, quantum, seams });
    quantum = [];
    weight = 0;
    return gate;
  };
  const add = ({ unit }: { unit: DeleteUnit }): "go" | "deadline" | "unreadable" => {
    const full = quantum.length >= MAX_QUANTUM_PATHS || weight + unit.entries > QUANTUM_ENTRIES;
    const gate = full ? flush() : "go";
    if (gate === "go") {
      quantum.push(unit);
      weight += unit.entries;
    }
    return gate;
  };
  const finish = ({ last }: { last: readonly DeleteUnit[] }): "go" | "deadline" | "unreadable" => {
    for (const unit of last) {
      const gate = add({ unit });
      if (gate !== "go") {
        return gate;
      }
    }
    return flush();
  };
  return { add, finish };
}
