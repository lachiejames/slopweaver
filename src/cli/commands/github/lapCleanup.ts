/**
 * One `github lap` invocation's cleanup registry: every throwaway resource it brings up — the machine lock, a lap
 * tree, a lane home, a store, a running lane's process group — registers here as it comes up, and leaves when its
 * own `finally` disposes it. A signal that ends the lap early drains whatever is still registered
 * (`./lapSignals.ts`), so a killed lap removes its own tree instead of leaving it registered with git for good.
 *
 * It is a value one invocation owns, never module state: a test builds one per case, and two laps in one process
 * (a test file) cannot drain each other's resources.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** One registered resource: disposing it runs its cleanup once and takes it off the registry. */
interface LapCleanupHandle {
  readonly dispose: () => Promise<void>;
}

/** The registry one lap invocation carries. */
export interface LapCleanupRegistry {
  /**
   * Register a resource that is already up. While the registry is stopping, the resource is disposed at once
   * instead, and the handle answers that same disposal.
   */
  readonly register: (input: { readonly label: string; readonly dispose: () => Promise<void> }) => LapCleanupHandle;
  /**
   * Stop admitting resources and dispose every registered one, newest first, continuing past a failure.
   *
   * @returns one line per disposal that threw, naming its label and why
   */
  readonly drain: () => Promise<readonly string[]>;
  /** Whether a drain has begun: nothing new should start once it has. */
  readonly stopping: () => boolean;
}

/** A registered entry: its label, its cleanup, and the disposal once one has started. */
interface Entry {
  readonly label: string;
  readonly run: () => Promise<void>;
  started: Promise<void> | null;
}

/**
 * A fresh, empty registry.
 *
 * A handle is idempotent: its owner's `finally` and a signal's drain may both call it, and the cleanup runs once,
 * the second caller awaiting the first. Drain order is newest first because a later resource lives INSIDE an earlier
 * one — a lane's process group writes in the tree registered before it, so the group is killed before the tree goes.
 *
 * @returns the registry
 */
export function createLapCleanupRegistry(): LapCleanupRegistry {
  const active: Entry[] = [];
  let draining = false;
  const disposeEntry = (entry: Entry): Promise<void> => {
    if (entry.started !== null) {
      return entry.started;
    }
    const at = active.indexOf(entry);
    if (at !== -1) {
      active.splice(at, 1);
    }
    entry.started = entry.run();
    return entry.started;
  };
  return {
    drain: async () => {
      draining = true;
      const failures: string[] = [];
      for (const entry of active.toReversed()) {
        try {
          await disposeEntry(entry);
        } catch (error: unknown) {
          failures.push(`${entry.label}: ${errorMessage({ error })}`);
        }
      }
      return failures;
    },
    register: ({ label, dispose }) => {
      const entry: Entry = { label, run: dispose, started: null };
      if (draining) {
        const late = disposeEntry(entry);
        return { dispose: () => late };
      }
      active.push(entry);
      return { dispose: () => disposeEntry(entry) };
    },
    stopping: () => draining,
  };
}
