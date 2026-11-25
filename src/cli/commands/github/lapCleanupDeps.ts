/**
 * The lap's deps with every throwaway resource registered in one cleanup registry (`./lapCleanup.ts`) as it comes
 * up: the machine lock, each tree, the lane home and the store. The phases keep disposing what they brought up in
 * their own `finally` blocks, unchanged — the handle each now receives is the registry's idempotent one, so a signal
 * that drained it first leaves that `finally` nothing to do twice.
 *
 * Decorating the deps, rather than threading a registry through every phase, keeps one place that knows a resource
 * must be registered: a new phase that checks a tree out through `deps.checkout` is covered without knowing this
 * file exists.
 *
 * A lane runs synchronously (`./lapStepProcess.ts`), so a signal that arrived during one is still waiting when it
 * ends, and the steps between are chained by promises alone — which never hand the loop back to deliver it. So every
 * step first yields TWO macrotask turns: one `setImmediate` can land in the same loop turn before the poll phase that
 * delivers the signal, two always span one, and the handler's drain has begun before the step checks for it.
 */
import { err, ok } from "../../../lib/result.js";
import type { LapCleanupRegistry } from "./lapCleanup.js";
import type { GithubLapDeps, LapResource } from "./lapDeps.js";
import { LapErrors } from "./lapErrors.js";

/** The exit a step the lap never started answers once a signal is tearing it down: a red step, never a green one. */
const STOPPED_STEP_EXIT = 128;

/** One trip round the event loop's check phase. */
async function nextTurn(): Promise<void> {
  await new Promise<void>((done) => {
    setImmediate(done);
  });
}

/**
 * Register a resource that is already up, answering it with the registry's idempotent handle as its dispose.
 *
 * @param label how a failed teardown names it
 * @returns the same value, disposed through the registry
 */
function registered<T>({
  cleanup,
  label,
  resource,
}: {
  cleanup: LapCleanupRegistry;
  label: string;
  resource: LapResource<T>;
}): LapResource<T> {
  const handle = cleanup.register({ dispose: resource.dispose, label });
  return { dispose: handle.dispose, value: resource.value };
}

/**
 * The lap's deps over `cleanup`.
 *
 * Once the registry is stopping, nothing new starts: a tree checked out then is refused, and a step is answered red
 * without being run, so a phase the signal interrupted cannot mint a fresh tree behind the drain.
 *
 * @param deps the lap's own seams
 * @param cleanup the invocation's registry, which a stop signal drains
 * @returns the same seams, each resource registered as it comes up
 */
export function withLapCleanup({ deps, cleanup }: { deps: GithubLapDeps; cleanup: LapCleanupRegistry }): GithubLapDeps {
  const stopped = LapErrors.refused({ reason: "the lap is stopping on a signal, so it brings nothing new up" });
  return {
    ...deps,
    acquireLock: (input) =>
      deps.acquireLock(input).map((resource) => registered({ cleanup, label: "the machine's lap lock", resource })),
    checkout: async (input) => {
      if (cleanup.stopping()) {
        return err(stopped);
      }
      const tree = await deps.checkout(input);
      if (tree.isErr()) {
        return err(tree.error);
      }
      return ok(registered({ cleanup, label: `the lap tree ${tree.value.value}`, resource: tree.value }));
    },
    laneHome: () => registered({ cleanup, label: "the lane home", resource: deps.laneHome() }),
    runStep: async (input) => {
      await nextTurn();
      await nextTurn();
      if (cleanup.stopping()) {
        return { context: input.step.context, exitCode: STOPPED_STEP_EXIT, id: input.step.id, wallMs: 0 };
      }
      return deps.runStep(input);
    },
    startStore: ({ register }) => {
      if (cleanup.stopping()) {
        return Promise.resolve(err(stopped));
      }
      return deps.startStore({
        register: ({ dispose }) =>
          register({ dispose: cleanup.register({ dispose, label: "the lap's proof store" }).dispose }),
      });
    },
  };
}
