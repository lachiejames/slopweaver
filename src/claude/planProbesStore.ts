/**
 * The plans' probe register over the store — the half of `./planProbes.ts` that imports the database, kept apart so
 * only a first read or write loads it (that module's header says why).
 */
import { err, ok } from "#lib/result.js";

import {
  productionSingletonRegisterSeams,
  type SingletonRegisterOperations,
  singletonRegister,
} from "../store/singletonRegister.js";

import { type ClaudePlanProbesDocument, withClaudePlanProbes } from "./planProbeRecord.js";
import { type ClaudePlanProbesError, type ClaudePlanProbesPort, claudePlanProbesDomainSeams } from "./planProbes.js";

/**
 * How many times one record call reads and compare-and-sets before it gives a conflict back. The writers are the two
 * ticks (`claude gauge`, `claude watch`) and the pre-spawn routing gate, which runs once per spawn — so several spawns
 * at once can race each other as well as a tick. A second attempt is what an ordinary race needs; the third covers a
 * racer that wrote twice. It is NOT raised for the gate's sake: no fixed count wins against arbitrarily many
 * concurrent spawns, and every attempt is latency on a spawn that is waiting to boot.
 *
 * What that leaves, stated rather than closed: a probe that loses all three is not recorded, so
 * an ok among them leaves the owner's card up until the next probe records. It delays the settle by a probe and never loses it,
 * and the caller prints the conflict. Unbounded retries would close it, at the price of a verb that can spin on the store.
 */
const RECORD_ATTEMPTS = 3;

/**
 * The port over whichever register operations it is handed — production's or a unit test's in-memory ones.
 *
 * @param register the register's read and compare-and-set
 * @returns the port
 */
export function claudePlanProbesPortOver({
  register,
}: {
  register: SingletonRegisterOperations<ClaudePlanProbesDocument, ClaudePlanProbesError>;
}): ClaudePlanProbesPort {
  return {
    read: async ({ home }) => {
      const read = await register.read({ home });
      if (read.isErr()) {
        return err(read.error);
      }
      return ok(read.value.document === undefined ? [] : read.value.document.plans);
    },
    record: async ({ home, observed }) => {
      // A conflict means another writer (a tick, or a concurrent spawn's gate) landed first. Dropping this probe
      // would lose an ok that settles the owner's card until some later probe writes, so it is
      // re-judged against the register as it now stands — safe, because the merge keeps out any probe no newer than
      // the one recorded — a bounded number of times.
      let conflict: ClaudePlanProbesError | undefined;
      for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt += 1) {
        const read = await register.read({ home });
        if (read.isErr()) {
          return err(read.error);
        }
        const next = withClaudePlanProbes({ document: read.value.document, observed });
        const written = observed.length - next.kept.length;
        if (written === 0) {
          return ok({ kept: next.kept, written });
        }
        const set = await register.compareAndSet({
          document: next.document,
          expectedRevision: read.value.revision,
          home,
        });
        if (set.isOk()) {
          return ok({ kept: next.kept, written });
        }
        if (set.error.code !== "CLAUDE_PLAN_PROBES_REVISION_CONFLICT") {
          return err(set.error);
        }
        conflict = set.error;
      }
      return err(conflict!);
    },
  };
}

/**
 * The production port: the store the home selects.
 *
 * @returns the port `./planProbes.ts`'s lazy port hands every call to
 */
export function productionClaudePlanProbesPort(): ClaudePlanProbesPort {
  return claudePlanProbesPortOver({
    register: singletonRegister({
      seams: productionSingletonRegisterSeams({ ...claudePlanProbesDomainSeams(), id: "claude-plan-probes" }),
    }),
  });
}
