/**
 * The recorded Chrome work profile over an in-memory store, for unit tests: the REAL port and register orchestration
 * with the real retired-file read and decoder, the database alone swapped (`./singletonRegisterFixture.ts`).
 */
import {
  type RecordedProfilePort,
  recordedProfileDomainSeams,
  recordedProfilePortOver,
} from "../browser/recordedProfile.js";
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
 * The port over an in-memory store, optionally holding a recorded directory for whichever home asks first.
 *
 * @param directory a directory every home reads as already recorded (revision 1); omitted, no row exists until a
 *   test records one or the retired file is imported
 * @param store the in-memory store, so a test can seed a row or read the counts back; omitted, a fresh one
 * @returns the port
 */
export function memoryRecordedProfilePort({
  directory,
  store,
}: {
  directory?: string;
  store?: MemorySingletonStore;
} = {}): RecordedProfilePort {
  const rows = storeOrFresh({ store });
  const port = recordedProfilePortOver({
    register: singletonRegister({
      seams: memorySingletonRegisterSeams({ ...recordedProfileDomainSeams(), store: rows }),
    }),
  });
  if (directory === undefined) {
    return port;
  }
  const seed = ({ home }: { home: string }): void => {
    if (!rows.rows.has(home)) {
      rows.rows.set(home, { document: { profileDirectory: directory }, revision: 1 });
    }
  };
  return {
    read: ({ home }) => {
      seed({ home });
      return port.read({ home });
    },
    record: (request) => {
      seed({ home: request.home });
      return port.record(request);
    },
  };
}

/**
 * The port over a store that cannot be opened.
 *
 * @returns the port, every operation of which answers `PROFILE_STORE_UNAVAILABLE`
 */
export function unavailableRecordedProfilePort(): RecordedProfilePort {
  return recordedProfilePortOver({
    register: singletonRegister({ seams: unavailableSingletonRegisterSeams(recordedProfileDomainSeams()) }),
  });
}
