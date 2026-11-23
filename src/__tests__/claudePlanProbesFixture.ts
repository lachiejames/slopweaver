/**
 * The Claude plan probes over an in-memory store, for unit tests: the REAL port and register orchestration with the
 * real decoder, the database alone swapped (`./singletonRegisterFixture.ts`).
 */
import { type ClaudePlanProbesPort, claudePlanProbesDomainSeams } from "../claude/planProbes.js";
import { claudePlanProbesPortOver } from "../claude/planProbesStore.js";
import type { CodexSignInPort } from "../codex/signInPort.js";
import { singletonRegister } from "../store/singletonRegister.js";
import { memoryCodexSignInPort } from "./codexSignInFixture.js";
import {
  type MemorySingletonStore,
  memorySingletonRegisterSeams,
  memorySingletonStore,
  unavailableSingletonRegisterSeams,
} from "./singletonRegisterFixture.js";

/**
 * The port over an in-memory store.
 *
 * @param store the in-memory store, so a test can seed a row or read the rows back; omitted, a fresh one
 * @returns the port
 */
export function memoryClaudePlanProbesPort({
  store = memorySingletonStore(),
}: { store?: MemorySingletonStore } = {}): ClaudePlanProbesPort {
  return claudePlanProbesPortOver({
    register: singletonRegister({ seams: memorySingletonRegisterSeams({ ...claudePlanProbesDomainSeams(), store }) }),
  });
}

/**
 * Both plan-health ports a monitor pass reads, each over a fresh in-memory store — for a fixture that spreads them
 * into its inputs and seeds neither.
 *
 * @returns the Claude probes port and the Codex sign-in port
 */
export function memoryPlanHealthPorts(): {
  readonly claudeProbesPort: ClaudePlanProbesPort;
  readonly signInPort: CodexSignInPort;
} {
  return { claudeProbesPort: memoryClaudePlanProbesPort(), signInPort: memoryCodexSignInPort() };
}

/**
 * The port over a store that cannot be opened.
 *
 * @returns the port, every operation of which answers `CLAUDE_PLAN_PROBES_STORE_UNAVAILABLE`
 */
export function unavailableClaudePlanProbesPort(): ClaudePlanProbesPort {
  return claudePlanProbesPortOver({
    register: singletonRegister({ seams: unavailableSingletonRegisterSeams(claudePlanProbesDomainSeams()) }),
  });
}
