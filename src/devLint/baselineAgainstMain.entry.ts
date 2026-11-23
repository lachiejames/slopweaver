/**
 * The baseline-against-main gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The comparison and its exports live in `baselineAgainstMain.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runBaselineAgainstMain } from "./baselineAgainstMain.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runBaselineAgainstMain });
