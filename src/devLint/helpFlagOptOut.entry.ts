/**
 * The help-flag-opt-out gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * audit logic + its exports live in `helpFlagOptOut.ts`; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runHelpFlagOptOut } from "./helpFlagOptOut.js";

await runGateEntry({ run: runHelpFlagOptOut });
