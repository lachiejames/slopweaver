/**
 * The untested-modules gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `untestedModules.ts`; this file existing IS the invocation, so there
 * is no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runUntestedModules } from "./untestedModules.js";

await runGateEntry({ run: runUntestedModules });
