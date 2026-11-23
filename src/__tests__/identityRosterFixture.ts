/**
 * The identity roster over an in-memory store, for unit tests: the REAL port and register orchestration with the
 * real retired-file read and strict decoder, the database alone swapped (`./singletonRegisterFixture.ts`). A seam,
 * not a mock (`.claude/rules/testing.md`).
 */
import type { IdentityRecord } from "../silver/identity.js";
import {
  type IdentityRosterPort,
  identityRosterDomainSeams,
  identityRosterPortOver,
} from "../silver/identityRoster.js";
import { singletonRegister } from "../store/singletonRegister.js";
import {
  type MemorySingletonStore,
  memorySingletonRegisterSeams,
  memorySingletonStore,
  unavailableSingletonRegisterSeams,
} from "./singletonRegisterFixture.js";

/** The store a test handed in, else a fresh empty one. */
function storeOrFresh({ store }: { store: MemorySingletonStore | undefined }): MemorySingletonStore {
  if (store !== undefined) {
    return store;
  }
  return memorySingletonStore();
}

/**
 * The port over an in-memory store, optionally holding a roster for whichever home asks first.
 *
 * @param records a roster every home reads as already stored (revision 1); omitted, no row exists until a test
 *   replaces one or a retired file is imported
 * @param store the in-memory store, so a test can seed a row or read the counts back; omitted, a fresh one
 * @returns the port
 */
export function memoryIdentityRosterPort({
  records,
  store,
}: {
  records?: readonly IdentityRecord[];
  store?: MemorySingletonStore;
} = {}): IdentityRosterPort {
  const rows = storeOrFresh({ store });
  const port = identityRosterPortOver({
    register: singletonRegister({
      seams: memorySingletonRegisterSeams({ ...identityRosterDomainSeams(), store: rows }),
    }),
  });
  if (records === undefined) {
    return port;
  }
  const seed = ({ home }: { home: string }): void => {
    if (!rows.rows.has(home)) {
      rows.rows.set(home, { document: structuredClone(records), revision: 1 });
    }
  };
  return {
    peek: ({ home }) => {
      seed({ home });
      return port.peek({ home });
    },
    read: ({ home }) => {
      seed({ home });
      return port.read({ home });
    },
    replace: (request) => {
      seed({ home: request.home });
      return port.replace(request);
    },
  };
}

/**
 * The port over a store that cannot be opened.
 *
 * @returns the port, every operation of which answers `IDENTITY_ROSTER_STORE_UNAVAILABLE`
 */
export function unavailableIdentityRosterPort(): IdentityRosterPort {
  return identityRosterPortOver({
    register: singletonRegister({ seams: unavailableSingletonRegisterSeams(identityRosterDomainSeams()) }),
  });
}
