/**
 * The ci-trigger-contract gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * contract logic + its exports live in `ciTriggerContract.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runCiTriggerContract } from "./ciTriggerContract.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runCiTriggerContract });
