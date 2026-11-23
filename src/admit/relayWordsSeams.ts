/**
 * The relay-words guard's real readers — the effectful shell `./relayWordsGuardRunner.ts` is handed by the registry.
 *
 * The two that read the talk records load their modules on first use, so a hook process that never gets past the
 * runner's target test never loads them: the registry builds these readers for EVERY `Edit|Write` call, and the
 * dispatcher's own cost is the budget a loaded machine cannot spare.
 */
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { slopweaverHomeOf } from "../homeDir.js";
import { stateHomePaths } from "../stateHome.js";
import type { RelayWordsReaders } from "./relayWordsGuardRunner.js";

/**
 * The real readers for the home this hook guards.
 *
 * @param env the process environment, which names the home
 * @returns the readers
 */
export function relayWordsSeams({ env }: { env: Readonly<Record<string, string | undefined>> }): RelayWordsReaders {
  const home = slopweaverHomeOf({ env });
  return {
    handoversDir: stateHomePaths({ home }).handovers,
    readPrior: ({ path }) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    readTurn: async ({ turnId }) => {
      const { readTurn } = await import("../talk/relayStore.js");
      const turn = readTurn({ home, turnId });
      return turn.isOk() ? turn.value : undefined;
    },
    realDir: ({ dir }) => {
      try {
        return realpathSync(dir);
      } catch {
        return undefined;
      }
    },
    resolveRecord: async ({ anchor }) => {
      const [{ resolveHisWords }, { recordOfRead }] = await Promise.all([
        import("../handover/hisWordsResolve.js"),
        import("../handover/hisWordsRecord.js"),
      ]);
      const projectsDir = join(homedir(), ".claude", "projects");
      return recordOfRead({ anchor, read: resolveHisWords({ anchor, home, projectsDir }) });
    },
  };
}
