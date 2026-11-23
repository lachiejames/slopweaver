/**
 * The home-safety gate entry point — nothing but the top-level invocation (run by `dev lint`). The
 * scanner logic + its exports live in `homeSafety.ts`; this file existing IS the invocation, so there is no
 * `isDirectInvocation` guard.
 */
import { runGateEntry } from "./gateEntry.js";
import { runHomeSafety } from "./homeSafety.js";

await runGateEntry({ run: runHomeSafety });
