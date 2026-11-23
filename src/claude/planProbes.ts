/**
 * Where each Claude plan's last probe is kept: the `claude-plan-probes` row of the store's `singleton_register`
 * (`src/store/singletonRegister.ts`), one document holding every plan's {@link ClaudePlanProbeRecord}.
 *
 * One row rather than a table of its own: there are a handful of plans, each record is a few fields, and the writers —
 * `claude gauge` on a supervisor tick, `claude watch` on a keep-alive tick, and the pre-spawn routing gate on every
 * spawn and `claude route` — write the whole fleet at once. A
 * compare-and-set conflict is re-judged against the register as it now stands, a bounded number of times
 * (`./planProbesStore.ts`): a lost ok would keep a recovered plan's card up, and re-merging is safe because a stale
 * probe is kept out ({@link withClaudePlanProbes}).
 *
 * ## Why this module never imports the store
 *
 * The monitor sources and `claude watch` load it on every pass; the register's client lives in `./planProbesStore.ts`,
 * which {@link claudePlanProbesPort} imports only on the first read or write.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import type { SingletonRegisterSeams } from "../store/singletonRegister.js";

import {
  type ClaudePlanProbeObserved,
  type ClaudePlanProbeRecord,
  type ClaudePlanProbesDocument,
  decodeClaudePlanProbesDocument,
} from "./planProbeRecord.js";

/**
 * The stored document is not the declared shape.
 *
 * @internal
 */
export interface ClaudePlanProbesMalformedError {
  readonly code: "CLAUDE_PLAN_PROBES_MALFORMED";
  readonly message: string;
}

/**
 * The store could not be selected, reached or queried. Nothing was read or written.
 *
 * @internal
 */
export interface ClaudePlanProbesStoreUnavailableError {
  readonly code: "CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE";
  readonly message: string;
}

/**
 * Another writer recorded probes between this one's read and its compare-and-set. Nothing was written.
 *
 * @internal
 */
export interface ClaudePlanProbesRevisionConflictError {
  readonly code: "CLAUDE_PLAN_PROBES_REVISION_CONFLICT";
  readonly message: string;
  /** The revision this writer read and pinned to; `0` when it expected no row at all. */
  readonly expectedRevision: number;
}

/** Why the plans' probes could not be read or recorded. */
export type ClaudePlanProbesError =
  ClaudePlanProbesMalformedError | ClaudePlanProbesStoreUnavailableError | ClaudePlanProbesRevisionConflictError;

/**
 * The factory every refusal in this module goes through.
 *
 * @internal
 */
export const ClaudePlanProbesErrors = {
  malformed: ({ detail }: { detail: string }): ClaudePlanProbesMalformedError => ({
    code: "CLAUDE_PLAN_PROBES_MALFORMED",
    message: `the store's claude-plan-probes row is not a plan probes document (${detail})`,
  }),
  revisionConflict: ({ expectedRevision }: { expectedRevision: number }): ClaudePlanProbesRevisionConflictError => ({
    code: "CLAUDE_PLAN_PROBES_REVISION_CONFLICT",
    expectedRevision,
    message:
      `another verb recorded Claude plan probes while this one was (read at revision ${String(expectedRevision)}), ` +
      "so nothing was written — the next probe records again",
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): ClaudePlanProbesStoreUnavailableError => ({
    code: "CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE",
    message:
      `this install keeps each Claude plan's last probe in the store, and the store could not ${doing} ` +
      `(\`slopweaver store status\` says what it is doing). The store said: ${reason}`,
  }),
} as const;

/**
 * What a record call did: how many plans it wrote, and each probe kept out as stale.
 *
 * @internal
 */
export interface ClaudePlanProbesRecorded {
  readonly written: number;
  readonly kept: readonly string[];
}

/** The one door every reader and writer of the plans' probes goes through. */
export interface ClaudePlanProbesPort {
  /** Every plan's record; none when no probe was ever recorded. */
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<readonly ClaudePlanProbeRecord[], ClaudePlanProbesError>>;
  /** Record probes over the document as read, pinned to its revision; a conflict re-reads and re-merges, bounded. */
  readonly record: (request: {
    readonly home: string;
    readonly observed: readonly ClaudePlanProbeObserved[];
  }) => Promise<Result<ClaudePlanProbesRecorded, ClaudePlanProbesError>>;
}

/** The seams the port is built over. */
export type ClaudePlanProbesSeams = SingletonRegisterSeams<ClaudePlanProbesDocument, ClaudePlanProbesError>;

/**
 * The register seams every port shares bar the connection. There is no retired file: the register is where the
 * probes were first kept.
 *
 * @returns the import read, decoder and error factories
 */
export function claudePlanProbesDomainSeams(): Omit<ClaudePlanProbesSeams, "connect"> {
  return {
    decodeStored: ({ value }) =>
      decodeClaudePlanProbesDocument({ value }).mapErr((undecodable) =>
        ClaudePlanProbesErrors.malformed({ detail: undecodable.message }),
      ),
    errors: {
      revisionConflict: ClaudePlanProbesErrors.revisionConflict,
      storeUnavailable: ClaudePlanProbesErrors.storeUnavailable,
    },
    readImport: () => ok(undefined),
  };
}

/** The production loader: the store half of this port, imported on first use. */
async function loadStorePort(): Promise<ClaudePlanProbesPort> {
  const module = await import("./planProbesStore.js");
  return module.productionClaudePlanProbesPort();
}

/**
 * The port the plans' probes are reached through: the store, its module loaded on the first read or write. Only
 * composition roots call this.
 *
 * It never REJECTS. A probe's verb must not fall over because its record could not be kept, so a module that fails to
 * load or an operation that throws is answered as `CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE`.
 *
 * @param load where the store half comes from — the lazy import in production, a plain function in a test
 * @returns the port every production reader and writer uses
 */
export function claudePlanProbesPort({
  load = loadStorePort,
}: { load?: () => Promise<ClaudePlanProbesPort> } = {}): ClaudePlanProbesPort {
  let loaded: Promise<ClaudePlanProbesPort> | undefined;
  const loadOnce = (): Promise<ClaudePlanProbesPort> => {
    if (loaded !== undefined) {
      return loaded;
    }
    // Published BEFORE the loader runs, which it then does on a microtask: a loader that throws before its first await
    // is one remembered rejection, and one that re-enters this port waits on its own load.
    const loading = Promise.resolve().then(load);
    loaded = loading;
    return loading;
  };
  const settled = async <T>({
    doing,
    operation,
  }: {
    doing: string;
    operation: (port: ClaudePlanProbesPort) => Promise<Result<T, ClaudePlanProbesError>>;
  }): Promise<Result<T, ClaudePlanProbesError>> => {
    try {
      return await operation(await loadOnce());
    } catch (cause) {
      return err(ClaudePlanProbesErrors.storeUnavailable({ doing, reason: errorMessage({ error: cause }) }));
    }
  };
  return {
    read: (request) => settled({ doing: "be read", operation: (port) => port.read(request) }),
    record: (request) => settled({ doing: "be written", operation: (port) => port.record(request) }),
  };
}
