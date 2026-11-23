/**
 * The ci-offload-contract gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * contract logic + its exports live in `ciOffloadContract.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runCiOffloadContract } from "./ciOffloadContract.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runCiOffloadContract });
