/**
 * The install's gmail triage rules over an in-memory store, for unit tests: the REAL port and register orchestration
 * with the real retired-file read and decoder, the database alone swapped (`./singletonRegisterFixture.ts`).
 */
import {
  type GmailTriageRulesPort,
  gmailTriageRulesDomainSeams,
  gmailTriageRulesPortOver,
} from "../live/gmail/triageRuleStore.js";
import { singletonRegister } from "../store/singletonRegister.js";
import {
  type MemorySingletonStore,
  memorySingletonRegisterSeams,
  unavailableSingletonRegisterSeams,
} from "./singletonRegisterFixture.js";

/**
 * The port over an in-memory store.
 *
 * @param store the in-memory store, so a test can seed a row or read the counts back
 * @returns the port
 */
export function memoryGmailTriageRulesPort({ store }: { store: MemorySingletonStore }): GmailTriageRulesPort {
  return gmailTriageRulesPortOver({
    register: singletonRegister({ seams: memorySingletonRegisterSeams({ ...gmailTriageRulesDomainSeams(), store }) }),
  });
}

/**
 * The port over a store that cannot be opened.
 *
 * @returns the port, every operation of which answers `TRIAGE_RULES_STORE_UNAVAILABLE`
 */
export function unavailableGmailTriageRulesPort(): GmailTriageRulesPort {
  return gmailTriageRulesPortOver({
    register: singletonRegister({ seams: unavailableSingletonRegisterSeams(gmailTriageRulesDomainSeams()) }),
  });
}
