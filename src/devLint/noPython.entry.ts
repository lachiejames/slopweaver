/**
 * The no-python gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner logic
 * and its exports live in `noPython.ts` and its `noPython*.ts` siblings; this file existing IS the invocation,
 * so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runNoPython } from "./noPython.js";

await runGateEntry({ run: runNoPython });
