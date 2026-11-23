/**
 * The noticed sessions' register over the store — the half of `./staleSeatNotices.ts` that imports the database,
 * kept apart so only a first read or write loads it (that module's header says why).
 */
import { err, ok } from "../lib/result.js";
import {
  productionSingletonRegisterSeams,
  type SingletonRegisterOperations,
  singletonRegister,
} from "../store/singletonRegister.js";

import {
  type StaleSeatNoticesDocument,
  type StaleSeatNoticesError,
  type StaleSeatNoticesPort,
  type StaleSeatNoticesSnapshot,
  staleSeatNoticesDomainSeams,
} from "./staleSeatNotices.js";

/**
 * The port over whichever register operations it is handed — production's or a unit test's in-memory ones.
 *
 * @param register the register's read and compare-and-set
 * @returns the port
 */
export function staleSeatNoticesPortOver({
  register,
}: {
  register: SingletonRegisterOperations<StaleSeatNoticesDocument, StaleSeatNoticesError>;
}): StaleSeatNoticesPort {
  const snapshotOf = ({
    document,
    revision,
  }: {
    document: StaleSeatNoticesDocument | undefined;
    revision: number | null;
  }): StaleSeatNoticesSnapshot => ({
    noticedSessions: document === undefined ? [] : document.noticedSessions,
    revision,
  });
  return {
    read: async ({ home }) => {
      const read = await register.read({ home });
      if (read.isErr()) {
        return err(read.error);
      }
      return ok(snapshotOf({ document: read.value.document, revision: read.value.revision }));
    },
    replace: async ({ document, expectedRevision, home }) => {
      const written = await register.compareAndSet({ document, expectedRevision, home });
      if (written.isErr()) {
        return err(written.error);
      }
      return ok(snapshotOf({ document: written.value.document, revision: written.value.revision }));
    },
  };
}

/**
 * The production port: the store the home selects.
 *
 * @returns the port `./staleSeatNotices.ts`'s lazy port hands every call to
 */
export function productionStaleSeatNoticesPort(): StaleSeatNoticesPort {
  return staleSeatNoticesPortOver({
    register: singletonRegister({
      seams: productionSingletonRegisterSeams({ ...staleSeatNoticesDomainSeams(), id: "stale-seat-notices" }),
    }),
  });
}
