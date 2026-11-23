/**
 * The max-function-lines gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `maxFunctionLines.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runMaxFunctionLines } from "./maxFunctionLines.js";

await runGateEntry({ run: runMaxFunctionLines });
