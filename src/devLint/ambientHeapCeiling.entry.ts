/**
 * The ambient-heap-ceiling gate entry point — nothing but the top-level invocation (run by `dev lint`).
 * The criterion + its exports live in `ambientHeapCeiling.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runAmbientHeapCeiling } from "./ambientHeapCeiling.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runAmbientHeapCeiling });
