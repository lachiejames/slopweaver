/**
 * The hook-bounded gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * criterion + its exports live in `hookBounded.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runHookBounded } from "./hookBounded.js";

await runGateEntry({ run: runHookBounded });
