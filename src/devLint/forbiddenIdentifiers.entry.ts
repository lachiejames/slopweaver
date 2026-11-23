/**
 * The forbidden-identifier gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scan lives in `../hygiene/identifierScanRun.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard. `--list` prints every (file, kind) finding, which runs past one pipe buffer, so
 * it drains before exiting (`../lib/drainStdio.ts`).
 */
import { identifierOutputMode, runForbiddenIdentifierScan } from "../hygiene/identifierScanRun.js";
import { drainStdio } from "../lib/drainStdio.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({
  run: async () => {
    const output = identifierOutputMode({ argv: process.argv.slice(2) });
    if (output === undefined) {
      // devlint: not-a-refusal -- a usage error: the argv names no mode this gate has, so nothing was scanned
      process.stderr.write("forbidden-identifiers: usage: forbiddenIdentifiers.entry.ts [--list]\n");
      return 2;
    }
    const code = runForbiddenIdentifierScan({ output });
    await drainStdio();
    return code;
  },
});
