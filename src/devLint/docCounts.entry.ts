/**
 * The doc-counts gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `docCounts.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runDocCounts } from "./docCounts.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runDocCounts });
