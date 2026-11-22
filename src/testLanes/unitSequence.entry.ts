/**
 * The unit step of `yarn validate` — nothing but the invocation. The shell is `unitSequence.ts`, the merge
 * `unitMerge.ts`, the decisions `unitShards.ts` and `unitWorkers.ts`.
 */
import { runUnitMerge } from "./unitMerge.js";
import { runUnitSequence, spawnInherited } from "./unitSequence.js";

const cwd = process.cwd();
const write: Parameters<typeof runUnitSequence>[0]["write"] = (line) => {
  process.stderr.write(`${line}\n`);
};

process.exit(
  runUnitSequence({
    cwd,
    merge: () => runUnitMerge({ cwd }),
    run: (argv) => spawnInherited({ argv, cwd, write }),
    write,
  }),
);
