/**
 * The transient-references gate entry point, nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic and its exports live in `transientReferences.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runTransientReferences } from "./transientReferences.js";

await runGateEntry({ run: runTransientReferences });
