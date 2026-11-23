/**
 * The epoch-arithmetic gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `epochArithmetic.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runEpochArithmetic } from "./epochArithmetic.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runEpochArithmetic });
