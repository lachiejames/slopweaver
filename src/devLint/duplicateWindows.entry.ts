/**
 * The duplicate-windows gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `duplicateWindows.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runDuplicateWindows } from "./duplicateWindows.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runDuplicateWindows });
