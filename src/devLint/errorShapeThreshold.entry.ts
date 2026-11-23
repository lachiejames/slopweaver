/**
 * The error-shape-threshold gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic, the debt list and their exports live in `errorShapeThreshold.ts`; this file existing IS the
 * invocation, so there is no `isDirectInvocation` guard.
 */
import { runErrorShapeThreshold } from "./errorShapeThreshold.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runErrorShapeThreshold });
