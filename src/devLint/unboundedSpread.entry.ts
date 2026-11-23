/**
 * The unbounded-spread gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `unboundedSpread.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runUnboundedSpread } from "./unboundedSpread.js";

await runGateEntry({ run: runUnboundedSpread });
