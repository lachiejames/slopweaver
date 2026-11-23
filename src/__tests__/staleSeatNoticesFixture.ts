/**
 * The stale-seat notices over an in-memory store, for unit tests: the REAL port and register orchestration with the
 * real retired-file read and decoder, the database alone swapped (`./singletonRegisterFixture.ts`).
 */
import { type StaleSeatNoticesPort, staleSeatNoticesDomainSeams } from "../cli/staleSeatNotices.js";
import { staleSeatNoticesPortOver } from "../cli/staleSeatNoticesStore.js";
import { singletonRegister } from "../store/singletonRegister.js";
import {
  type MemorySingletonStore,
  memorySingletonRegisterSeams,
  memorySingletonStore,
  unavailableSingletonRegisterSeams,
} from "./singletonRegisterFixture.js";

/**
 * The port over an in-memory store.
 *
 * @param store the in-memory store, so a test can seed a row or read the rows and counts back; omitted, a fresh one
 * @returns the port
 */
export function memoryStaleSeatNoticesPort({
  store = memorySingletonStore(),
}: { store?: MemorySingletonStore } = {}): StaleSeatNoticesPort {
  return staleSeatNoticesPortOver({
    register: singletonRegister({ seams: memorySingletonRegisterSeams({ ...staleSeatNoticesDomainSeams(), store }) }),
  });
}

/**
 * The port over a store that cannot be opened.
 *
 * @returns the port, every operation of which answers `STALE_SEAT_NOTICES_STORE_UNAVAILABLE`
 */
export function unavailableStaleSeatNoticesPort(): StaleSeatNoticesPort {
  return staleSeatNoticesPortOver({
    register: singletonRegister({ seams: unavailableSingletonRegisterSeams(staleSeatNoticesDomainSeams()) }),
  });
}
