import { repoRootOf } from "#lib/gitRepo.js";
import { runGateEntry } from "./gateEntry.js";
import { runHeapCeilingRatchet } from "./heapCeilingRatchetRun.js";

await runGateEntry({
  run: () =>
    runHeapCeilingRatchet({
      env: process.env,
      root: repoRootOf({ importMetaUrl: import.meta.url }),
      writeErr: ({ text }) => process.stderr.write(text),
      writeOut: ({ text }) => process.stdout.write(text),
    }),
});
