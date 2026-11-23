/**
 * The torn-tail-append gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `tornTailAppend.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTornTailAppend } from "./tornTailAppend.js";

await runGateEntry({ run: runTornTailAppend });
