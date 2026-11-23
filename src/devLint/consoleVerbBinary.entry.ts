/**
 * The console-verb-binary gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `consoleVerbBinary.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runConsoleVerbBinary } from "./consoleVerbBinary.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runConsoleVerbBinary });
