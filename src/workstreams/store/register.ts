/**
 * The one way production opens the workstream register: the store, behind the retired file's tombstone.
 *
 * Workstreams live in the store as rows, not files. Every reader and writer takes its {@link WorkstreamStore} from here, and every operation of it
 * stands the tombstone first (`./retiredRegister.ts`), so a caller cannot reach the store without the fence that keeps
 * a build from before the move off `workstreams/register.json`. A refusal there opens no connection and writes nothing.
 *
 * ## An empty register
 *
 * A store holding no rows and no register document is the register nobody has started, and only that:
 * nothing imports the retired file, so a migration that stopped halfway cannot exist. {@link isEmptyRegister} names
 * that state so `workstreams list` and the console tell it from an outage, which is always a typed refusal.
 */
import { err, type Result } from "#lib/result.js";

import type { WorkstreamStoreError } from "./errors.js";
import type { WorkstreamStore } from "./port.js";
import { workstreamStore } from "./port.js";
import { fenceRetiredWorkstreamRegister } from "./retiredRegister.js";
import { productionRetiredRegisterSeams } from "./retiredRegisterSeams.js";
import { productionWorkstreamStoreSeams } from "./rows.js";
import type { WorkstreamRegisterSnapshot } from "./types.js";

/** What stands before every operation: the tombstone, made durable, or the refusal that keeps the store shut. */
export type WorkstreamRegisterFence = (request: { readonly home: string }) => Result<void, WorkstreamStoreError>;

/**
 * A store whose every operation passes the fence first, and opens nothing when the fence refuses.
 *
 * @param fence what stands before each operation
 * @param store the store behind it
 * @returns the fenced store
 */
export function fencedWorkstreamStore({
  fence,
  store,
}: {
  fence: WorkstreamRegisterFence;
  store: WorkstreamStore;
}): WorkstreamStore {
  /**
   * Run one operation once the fence stands.
   *
   * @returns the operation's answer, or the fence's refusal
   */
  const behind = async <Answer>({
    home,
    run,
  }: {
    home: string;
    run: () => Promise<Result<Answer, WorkstreamStoreError>>;
  }): Promise<Result<Answer, WorkstreamStoreError>> => {
    const fenced = fence({ home });
    if (fenced.isErr()) {
      return err(fenced.error);
    }
    return run();
  };
  return {
    applyBatch: (request) => behind({ home: request.home, run: () => store.applyBatch(request) }),
    put: (request) => behind({ home: request.home, run: () => store.put(request) }),
    putMeta: (request) => behind({ home: request.home, run: () => store.putMeta(request) }),
    read: (request) => behind({ home: request.home, run: () => store.read(request) }),
    remove: (request) => behind({ home: request.home, run: () => store.remove(request) }),
  };
}

/**
 * The register production reads and writes: the store a home selects, behind the real tombstone.
 *
 * @returns the fenced store
 */
export function productionWorkstreamRegister(): WorkstreamStore {
  const seams = productionRetiredRegisterSeams({ nowIso: () => new Date().toISOString() });
  return fencedWorkstreamStore({
    fence: ({ home }) => fenceRetiredWorkstreamRegister({ home, seams }),
    store: workstreamStore({ seams: productionWorkstreamStoreSeams() }),
  });
}

/**
 * Whether a read found the register nobody has started: no workstream and no register document.
 *
 * @returns true only for that state
 */
export function isEmptyRegister({ snapshot }: { snapshot: WorkstreamRegisterSnapshot }): boolean {
  return snapshot.meta === null && snapshot.workstreams.length === 0;
}
