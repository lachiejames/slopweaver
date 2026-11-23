/**
 * The ReDoS gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner logic
 * + its exports live in `redosCheck.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runRedosCheck } from "./redosCheck.js";

await runGateEntry({ run: runRedosCheck });
