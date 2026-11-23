/**
 * The command-trigger gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The scanner logic + its exports live in `commandTrigger.ts`; this file existing IS the invocation,
 * so there is no `isDirectInvocation` guard.
 */
import { runCommandTrigger } from "./commandTrigger.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runCommandTrigger });
