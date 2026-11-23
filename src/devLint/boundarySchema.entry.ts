/**
 * The boundary-schema gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `boundarySchema.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runBoundarySchema } from "./boundarySchema.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runBoundarySchema });
