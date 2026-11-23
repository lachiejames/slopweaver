/**
 * The escape-hatch gate entry point — nothing but the top-level invocation (run by `dev lint`). The scanner
 * logic + its exports live in `escapeHatch.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runEscapeHatch } from "./escapeHatch.js";
import { runGateEntry } from "./gateEntry.js";

await runGateEntry({ run: runEscapeHatch });
