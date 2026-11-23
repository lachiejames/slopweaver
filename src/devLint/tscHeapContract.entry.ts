/**
 * The tsc-heap-contract gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * criterion and its exports live in `tscHeapContract.ts`, the file read and the printing in
 * `tscHeapContractRun.ts`; this file existing IS the invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTscHeapContract } from "./tscHeapContractRun.js";

await runGateEntry({ run: runTscHeapContract });
