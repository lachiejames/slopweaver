/**
 * The console-loading-prose gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `consoleLoadingProse.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { runConsoleLoadingProse } from "./consoleLoadingProse.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runConsoleLoadingProse });
