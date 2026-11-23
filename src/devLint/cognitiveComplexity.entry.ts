/**
 * The cognitive-complexity gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `cognitiveComplexity.ts`; this file existing IS the invocation, so
 * there is no `isDirectInvocation` guard.
 */
import { runCognitiveComplexity } from "./cognitiveComplexity.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runCognitiveComplexity });
