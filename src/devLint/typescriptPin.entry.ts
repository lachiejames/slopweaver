/**
 * The typescript-pin gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * criterion lives in `typescriptPin.ts`, the tracked-tree read and the printing in `typescriptPinRun.ts`;
 * this file existing IS the invocation, so there is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTypescriptPin } from "./typescriptPinRun.js";

await runGateEntry({ run: runTypescriptPin });
